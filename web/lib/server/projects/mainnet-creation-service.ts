import type {
  BuiltMainnetTransaction,
  MainnetIssuanceVerification,
} from "../../stellar/mainnet-creation";
import type {
  MainnetOrderRecord,
} from "./mainnet-creation-store";

export type MainnetIssuanceAttemptStatus =
  | "prepared"
  | "signing"
  | "submitted"
  | "reconciliation_required"
  | "confirmed";

export interface MainnetIssuanceAttemptState {
  attemptId: string;
  transactionHash: string;
  unsignedXdr: string;
  signedEnvelopeXdrSha256: string | null;
  status: MainnetIssuanceAttemptStatus;
}

export interface MainnetCreationServiceStore {
  getOwned(projectId: string, ownerPublicKey: string): Promise<MainnetOrderRecord | null>;
  getIssuanceAttempt(orderId: string): Promise<MainnetIssuanceAttemptState | null>;
  getTrustlineAttempt(orderId: string): Promise<{
    transactionHash: string;
    unsignedXdr: string;
    status: "pending" | "confirmed" | "failed";
  } | null>;
  reserveTrustline(input: {
    order: MainnetOrderRecord;
    transaction: BuiltMainnetTransaction;
    now: number;
  }): Promise<MainnetOrderRecord>;
  markExistingTrustline(input: {
    order: MainnetOrderRecord;
    now: number;
  }): Promise<MainnetOrderRecord>;
  confirmTrustline(input: {
    order: MainnetOrderRecord;
    transactionHash: string;
    ledgerSequence: number;
    now: number;
  }): Promise<MainnetOrderRecord>;
  reserveIssuance(input: {
    order: MainnetOrderRecord;
    attemptId: string;
    transaction: BuiltMainnetTransaction;
    now: number;
  }): Promise<MainnetOrderRecord>;
  claimIssuanceForSigning(input: {
    orderId: string;
    transactionHash: string;
    now: number;
  }): Promise<boolean>;
  markIssuanceSubmitted(input: {
    orderId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
    now: number;
  }): Promise<void>;
  confirmIssuance(input: {
    confirmationId: string;
    order: MainnetOrderRecord;
    attemptId: string;
    signedEnvelopeXdrSha256: string;
    verification: Extract<MainnetIssuanceVerification, { status: "confirmed" }>;
    now: number;
  }): Promise<MainnetOrderRecord>;
}

export interface MainnetSignerClient {
  checkReady(): Promise<void>;
  signAndSubmit(input: {
    unsignedEnvelopeXdr: string;
    transactionHash: string;
    issuerPublicKey: string;
    destinationPublicKey: string;
    assetCode: string;
    amount: string;
    maxFeeStroops: string;
  }): Promise<{ transactionHash: string; signedEnvelopeXdrSha256: string }>;
}

export class MainnetCreationServiceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MainnetCreationServiceError";
  }
}

export class MainnetCreationService {
  constructor(
    private readonly dependencies: {
      store: MainnetCreationServiceStore;
      now: () => number;
      createId: () => string;
      prepareIssuance(order: MainnetOrderRecord): Promise<BuiltMainnetTransaction>;
      signer: MainnetSignerClient;
      verifyIssuance(
        order: MainnetOrderRecord,
        transactionHash: string,
      ): Promise<MainnetIssuanceVerification>;
      publish(order: MainnetOrderRecord): Promise<void>;
      maxIssuerFeeStroops?: string;
      prepareTrustline?(order: MainnetOrderRecord): Promise<
        | { status: "ready"; ledgerSequence: number }
        | {
            status: "signature_required";
            ledgerSequence: number;
            transaction: BuiltMainnetTransaction;
          }
      >;
      confirmTrustline?(order: MainnetOrderRecord, hash: string): Promise<{
        transactionHash: string;
        ledgerSequence: number;
      }>;
    },
  ) {}

  getState(projectId: string, ownerPublicKey: string) {
    return this.dependencies.store.getOwned(projectId, ownerPublicKey);
  }

  async prepareTrustline(projectId: string, ownerPublicKey: string) {
    let order = await this.requireOrder(projectId, ownerPublicKey);
    if (["trustline_confirmed", "issuance_pending", "issuance_reconciliation_required", "issued"].includes(order.status)) {
      return { order, trustline: { status: "ready" as const } };
    }
    if (order.status === "trustline_pending") {
      const attempt = await this.dependencies.store.getTrustlineAttempt(order.orderId);
      if (!attempt) throw new MainnetCreationServiceError("trustline_evidence_missing");
      return {
        order,
        trustline: {
          status: "signature_required" as const,
          unsignedXdr: attempt.unsignedXdr,
          transactionHash: attempt.transactionHash,
        },
      };
    }
    if (order.status !== "paid" || !this.dependencies.prepareTrustline) {
      throw new MainnetCreationServiceError("trustline_not_ready");
    }
    const prepared = await this.dependencies.prepareTrustline(order);
    if (prepared.status === "ready") {
      order = await this.dependencies.store.markExistingTrustline({
        order,
        now: this.dependencies.now(),
      });
      return { order, trustline: { status: "ready" as const } };
    }
    order = await this.dependencies.store.reserveTrustline({
      order,
      transaction: prepared.transaction,
      now: this.dependencies.now(),
    });
    const attempt = await this.dependencies.store.getTrustlineAttempt(
      order.orderId,
    );
    if (!attempt) {
      throw new MainnetCreationServiceError("trustline_evidence_missing");
    }
    return {
      order,
      trustline: {
        status: "signature_required" as const,
        unsignedXdr: attempt.unsignedXdr,
        transactionHash: attempt.transactionHash,
      },
    };
  }

  async confirmTrustline(
    projectId: string,
    ownerPublicKey: string,
    transactionHash: string,
  ) {
    const order = await this.requireOrder(projectId, ownerPublicKey);
    if (order.status === "trustline_confirmed") return order;
    if (order.status !== "trustline_pending" || !this.dependencies.confirmTrustline) {
      throw new MainnetCreationServiceError("trustline_not_ready");
    }
    const verification = await this.dependencies.confirmTrustline(order, transactionHash);
    return this.dependencies.store.confirmTrustline({
      order,
      transactionHash: verification.transactionHash,
      ledgerSequence: verification.ledgerSequence,
      now: this.dependencies.now(),
    });
  }

  async issueOrReconcile(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<MainnetOrderRecord> {
    let order = await this.dependencies.store.getOwned(projectId, ownerPublicKey);
    if (!order) throw new MainnetCreationServiceError("order_not_found");
    if (order.status === "issued") {
      await this.publishBestEffort(order);
      return order;
    }
    if (![
      "trustline_confirmed",
      "issuance_pending",
      "issuance_reconciliation_required",
    ].includes(order.status)) {
      throw new MainnetCreationServiceError("issuance_not_ready");
    }

    let attempt = await this.dependencies.store.getIssuanceAttempt(order.orderId);
    if (!attempt) {
      if (order.status !== "trustline_confirmed") {
        throw new MainnetCreationServiceError("issuance_evidence_missing");
      }
      const transaction = await this.dependencies.prepareIssuance(order);
      order = await this.dependencies.store.reserveIssuance({
        order,
        attemptId: this.dependencies.createId(),
        transaction,
        now: this.dependencies.now(),
      });
      attempt = await this.dependencies.store.getIssuanceAttempt(order.orderId);
      if (!attempt) throw new MainnetCreationServiceError("issuance_evidence_missing");
    }

    if (attempt.status === "prepared") {
      await this.dependencies.signer.checkReady();
      const claimed = await this.dependencies.store.claimIssuanceForSigning({
        orderId: order.orderId,
        transactionHash: attempt.transactionHash,
        now: this.dependencies.now(),
      });
      if (claimed) {
        try {
          const submitted = await this.dependencies.signer.signAndSubmit({
            unsignedEnvelopeXdr: attempt.unsignedXdr,
            transactionHash: attempt.transactionHash,
            issuerPublicKey: order.issuerPublicKey,
            destinationPublicKey: order.destinationPublicKey,
            assetCode: order.assetCode,
            amount: order.amount,
            maxFeeStroops: this.dependencies.maxIssuerFeeStroops ?? "1000",
          });
          if (submitted.transactionHash !== attempt.transactionHash) {
            throw new MainnetCreationServiceError("signer_response_mismatch");
          }
          await this.dependencies.store.markIssuanceSubmitted({
            orderId: order.orderId,
            transactionHash: attempt.transactionHash,
            signedEnvelopeXdrSha256: submitted.signedEnvelopeXdrSha256,
            now: this.dependencies.now(),
          });
        } catch {
          const pending = await this.dependencies.store.getOwned(projectId, ownerPublicKey);
          if (!pending) throw new MainnetCreationServiceError("order_not_found");
          return pending;
        }
      }
      order = await this.dependencies.store.getOwned(projectId, ownerPublicKey) ?? order;
      attempt = await this.dependencies.store.getIssuanceAttempt(order.orderId);
      if (!attempt) throw new MainnetCreationServiceError("issuance_evidence_missing");
    }

    const verification = await this.dependencies.verifyIssuance(
      order,
      attempt.transactionHash,
    );
    if (verification.status !== "confirmed") return order;
    const confirmed = await this.dependencies.store.confirmIssuance({
      confirmationId: this.dependencies.createId(),
      order,
      attemptId: attempt.attemptId,
      signedEnvelopeXdrSha256:
        attempt.signedEnvelopeXdrSha256 ?? verification.envelopeXdrSha256,
      verification,
      now: this.dependencies.now(),
    });
    await this.publishBestEffort(confirmed);
    return confirmed;
  }

  private async publishBestEffort(order: MainnetOrderRecord): Promise<void> {
    try {
      await this.dependencies.publish(order);
    } catch {
      // Issuance is immutable ledger fact. Publication has its own retry status.
    }
  }

  private async requireOrder(projectId: string, ownerPublicKey: string) {
    const order = await this.dependencies.store.getOwned(projectId, ownerPublicKey);
    if (!order) throw new MainnetCreationServiceError("order_not_found");
    return order;
  }
}
