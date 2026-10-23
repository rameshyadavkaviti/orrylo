import type postgres from "postgres";

import type {
  BuiltMainnetTransaction,
  MainnetIssuanceVerification,
} from "../../stellar/mainnet-creation";
import type { DatabaseClient } from "../persistence/database";
import type {
  MainnetCreationServiceStore,
  MainnetIssuanceAttemptState,
} from "./mainnet-creation-service";

const HASH = /^[0-9a-f]{64}$/;

export type MainnetOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "trustline_pending"
  | "trustline_confirmed"
  | "issuance_pending"
  | "issuance_reconciliation_required"
  | "issued";

export class MainnetCreationStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MainnetCreationStoreError";
  }
}

export interface MainnetOrderRecord {
  orderId: string;
  projectId: string;
  ownerPublicKey: string;
  issuerPublicKey: string;
  treasuryPublicKey: string;
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
  priceStroops: string;
  paymentMemo: string;
  status: MainnetOrderStatus;
  publicationStatus: "pending" | "verified" | "failed";
  publicationErrorCode: string | null;
  paymentTransactionHash: string | null;
  trustlineTransactionHash: string | null;
  issuanceTransactionHash: string | null;
}

interface OrderRow {
  order_id: string;
  project_id: string;
  owner_public_key: string;
  issuer_public_key: string;
  treasury_public_key: string;
  destination_public_key: string;
  asset_code: string;
  initial_supply: string;
  price_stroops: string;
  memo: string;
  state: string;
  publication_status: "pending" | "verified" | "failed";
  publication_error_code: string | null;
  payment_transaction_hash: string | null;
  trustline_transaction_hash: string | null;
  issuance_transaction_hash: string | null;
}

function publicStatus(state: string): MainnetOrderStatus {
  if (state === "pending") return "awaiting_payment";
  if (state === "reconciling") return "issuance_reconciliation_required";
  if (["paid", "trustline_pending", "trustline_confirmed", "issuance_pending", "issued"].includes(state)) {
    return state as MainnetOrderStatus;
  }
  throw new MainnetCreationStoreError("invalid_state_transition");
}

function mapOrder(row: OrderRow): MainnetOrderRecord {
  return {
    orderId: row.order_id,
    projectId: row.project_id,
    ownerPublicKey: row.owner_public_key.trim(),
    issuerPublicKey: row.issuer_public_key.trim(),
    treasuryPublicKey: row.treasury_public_key.trim(),
    destinationPublicKey: row.destination_public_key.trim(),
    assetCode: row.asset_code,
    amount: row.initial_supply,
    priceStroops: row.price_stroops,
    paymentMemo: row.memo,
    status: publicStatus(row.state),
    publicationStatus: row.publication_status,
    publicationErrorCode: row.publication_error_code,
    paymentTransactionHash: row.payment_transaction_hash,
    trustlineTransactionHash: row.trustline_transaction_hash,
    issuanceTransactionHash: row.issuance_transaction_hash,
  };
}

export class PostgresMainnetCreationStore implements MainnetCreationServiceStore {
  constructor(private readonly sql: DatabaseClient) {}

  private async read(
    sql: DatabaseClient | postgres.TransactionSql,
    projectId: string,
    owner: string,
  ) {
    const [row] = await sql<OrderRow[]>`
      SELECT orders.*,
        trustline.transaction_hash AS trustline_transaction_hash,
        issuance.transaction_hash AS issuance_transaction_hash
      FROM mainnet_token_orders AS orders
      LEFT JOIN mainnet_trustline_attempts AS trustline USING (order_id)
      LEFT JOIN mainnet_issuance_attempts AS issuance USING (order_id)
      WHERE orders.project_id = ${projectId}
        AND orders.owner_public_key = ${owner}
      LIMIT 1
    `;
    return row ? mapOrder(row) : null;
  }

  getOwned(projectId: string, ownerPublicKey: string) {
    return this.read(this.sql, projectId, ownerPublicKey);
  }

  async getIssuanceAttempt(orderId: string): Promise<MainnetIssuanceAttemptState | null> {
    const [row] = await this.sql<{
      attempt_id: string;
      transaction_hash: string;
      unsigned_xdr: string;
      signed_envelope_xdr_sha256: string | null;
      status: MainnetIssuanceAttemptState["status"];
    }[]>`
      SELECT attempt_id, transaction_hash, unsigned_xdr,
        signed_envelope_xdr_sha256, status
      FROM mainnet_issuance_attempts WHERE order_id = ${orderId}
    `;
    return row ? {
      attemptId: row.attempt_id,
      transactionHash: row.transaction_hash,
      unsignedXdr: row.unsigned_xdr,
      signedEnvelopeXdrSha256: row.signed_envelope_xdr_sha256,
      status: row.status,
    } : null;
  }

  async getTrustlineAttempt(orderId: string) {
    const [row] = await this.sql<{
      transaction_hash: string;
      unsigned_xdr: string;
      status: "pending" | "confirmed" | "failed";
    }[]>`
      SELECT transaction_hash, unsigned_xdr, status
      FROM mainnet_trustline_attempts WHERE order_id = ${orderId}
    `;
    return row ? {
      transactionHash: row.transaction_hash,
      unsignedXdr: row.unsigned_xdr,
      status: row.status,
    } : null;
  }

  async reserveTrustline(input: {
    order: MainnetOrderRecord;
    transaction: BuiltMainnetTransaction;
    now: number;
  }) {
    await this.sql.begin(async (tx) => {
      await tx`SELECT order_id FROM mainnet_token_orders WHERE order_id = ${input.order.orderId} FOR UPDATE`;
      await tx`
        INSERT INTO mainnet_trustline_attempts (
          order_id, transaction_hash, unsigned_xdr, unsigned_xdr_sha256,
          source_sequence, fee_stroops, valid_from, valid_until, status, created_at
        ) VALUES (
          ${input.order.orderId}, ${input.transaction.transactionHash},
          ${input.transaction.unsignedXdr}, ${input.transaction.unsignedXdrSha256},
          ${input.transaction.sourceSequence}, ${input.transaction.feeStroops},
          ${input.transaction.validFrom}, ${input.transaction.validUntil}, 'pending',
          ${new Date(input.now)}
        ) ON CONFLICT (order_id) DO NOTHING
      `;
      await tx`
        UPDATE mainnet_token_orders SET state = 'trustline_pending', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId} AND state = 'paid'
      `;
    });
    return this.requireOwned(input.order);
  }

  async markExistingTrustline(input: { order: MainnetOrderRecord; now: number }) {
    const rows = await this.sql`
      UPDATE mainnet_token_orders
      SET state = 'trustline_confirmed', updated_at = ${new Date(input.now)}
      WHERE order_id = ${input.order.orderId} AND state = 'paid'
    `;
    if (rows.count !== 1) throw new MainnetCreationStoreError("invalid_state_transition");
    return this.requireOwned(input.order);
  }

  async confirmTrustline(input: {
    order: MainnetOrderRecord;
    transactionHash: string;
    ledgerSequence: number;
    now: number;
  }) {
    await this.sql.begin(async (tx) => {
      const attempt = await tx`
        UPDATE mainnet_trustline_attempts
        SET status = 'confirmed', ledger_sequence = ${input.ledgerSequence},
            resolved_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId}
          AND transaction_hash = ${input.transactionHash} AND status = 'pending'
      `;
      if (attempt.count !== 1) throw new MainnetCreationStoreError("invalid_state_transition");
      const order = await tx`
        UPDATE mainnet_token_orders
        SET state = 'trustline_confirmed', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId} AND state = 'trustline_pending'
      `;
      if (order.count !== 1) throw new MainnetCreationStoreError("invalid_state_transition");
    });
    return this.requireOwned(input.order);
  }

  async reserveIssuance(input: {
    order: MainnetOrderRecord;
    attemptId: string;
    transaction: BuiltMainnetTransaction;
    now: number;
  }) {
    await this.sql.begin(async (tx) => {
      await tx`SELECT order_id FROM mainnet_token_orders WHERE order_id = ${input.order.orderId} FOR UPDATE`;
      await tx`
        INSERT INTO mainnet_issuance_attempts (
          order_id, attempt_id, transaction_hash, unsigned_xdr, unsigned_xdr_sha256,
          source_sequence, fee_stroops, valid_from, valid_until, status,
          created_at, updated_at
        ) VALUES (
          ${input.order.orderId}, ${input.attemptId}, ${input.transaction.transactionHash},
          ${input.transaction.unsignedXdr}, ${input.transaction.unsignedXdrSha256},
          ${input.transaction.sourceSequence}, ${input.transaction.feeStroops},
          ${input.transaction.validFrom}, ${input.transaction.validUntil}, 'prepared',
          ${new Date(input.now)}, ${new Date(input.now)}
        ) ON CONFLICT (order_id) DO NOTHING
      `;
      await tx`
        UPDATE mainnet_token_orders SET state = 'issuance_pending', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId} AND state = 'trustline_confirmed'
      `;
    });
    return this.requireOwned(input.order);
  }

  async claimIssuanceForSigning(input: { orderId: string; transactionHash: string; now: number }) {
    return this.sql.begin(async (tx) => {
      const attempt = await tx`
        UPDATE mainnet_issuance_attempts SET status = 'signing', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.orderId} AND transaction_hash = ${input.transactionHash}
          AND status = 'prepared'
      `;
      if (attempt.count !== 1) return false;
      const order = await tx`
        UPDATE mainnet_token_orders SET state = 'reconciling', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.orderId} AND state = 'issuance_pending'
      `;
      if (order.count !== 1) throw new MainnetCreationStoreError("invalid_state_transition");
      return true;
    });
  }

  async markIssuanceSubmitted(input: {
    orderId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
    now: number;
  }) {
    if (!HASH.test(input.signedEnvelopeXdrSha256)) throw new MainnetCreationStoreError("invalid_request");
    const rows = await this.sql`
      UPDATE mainnet_issuance_attempts
      SET signed_envelope_xdr_sha256 = ${input.signedEnvelopeXdrSha256},
          status = 'submitted', updated_at = ${new Date(input.now)}
      WHERE order_id = ${input.orderId} AND transaction_hash = ${input.transactionHash}
        AND status = 'signing'
    `;
    if (rows.count !== 1) throw new MainnetCreationStoreError("invalid_state_transition");
  }

  async confirmIssuance(input: {
    confirmationId: string;
    order: MainnetOrderRecord;
    attemptId: string;
    signedEnvelopeXdrSha256: string;
    verification: Extract<MainnetIssuanceVerification, { status: "confirmed" }>;
    now: number;
  }) {
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO mainnet_issuance_confirmations (
          confirmation_id, order_id, attempt_id, project_id, owner_public_key,
          network, transaction_hash, signed_envelope_xdr_sha256,
          envelope_xdr_sha256, result_xdr_sha256, ledger_sequence,
          ledger_closed_at, source_sequence, issuer_public_key,
          destination_public_key, asset_code, amount, verifier_identity, verified_at
        ) VALUES (
          ${input.confirmationId}, ${input.order.orderId}, ${input.attemptId},
          ${input.order.projectId}, ${input.order.ownerPublicKey}, 'public',
          ${input.verification.transactionHash}, ${input.signedEnvelopeXdrSha256},
          ${input.verification.envelopeXdrSha256}, ${input.verification.resultXdrSha256},
          ${input.verification.ledgerSequence}, ${new Date(input.verification.ledgerClosedAt)},
          ${input.verification.sourceSequence}, ${input.order.issuerPublicKey},
          ${input.order.destinationPublicKey}, ${input.order.assetCode},
          ${input.order.amount}, 'official-mainnet-horizon-v1', ${new Date(input.now)}
        ) ON CONFLICT (order_id) DO NOTHING
      `;
      await tx`
        UPDATE mainnet_issuance_attempts
        SET status = 'confirmed',
            signed_envelope_xdr_sha256 = COALESCE(signed_envelope_xdr_sha256, ${input.signedEnvelopeXdrSha256}),
            updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId}
          AND transaction_hash = ${input.verification.transactionHash}
          AND status IN ('signing', 'submitted', 'reconciliation_required')
      `;
      await tx`
        UPDATE mainnet_token_orders SET state = 'issued', updated_at = ${new Date(input.now)}
        WHERE order_id = ${input.order.orderId} AND state IN ('issuance_pending', 'reconciling')
      `;
    });
    return this.requireOwned(input.order);
  }

  private async requireOwned(order: MainnetOrderRecord) {
    const result = await this.getOwned(order.projectId, order.ownerPublicKey);
    if (!result) throw new MainnetCreationStoreError("database_invariant");
    return result;
  }
}
