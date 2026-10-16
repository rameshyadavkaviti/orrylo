import { randomUUID } from "node:crypto";

import {
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { DatabaseClient } from "../persistence/database";
import type { CustomerTrustlinePlan } from "./customer-testnet-trustline";
import { CustomerTrustlineError } from "./customer-testnet-trustline";
import { validateInitialSupply } from "../../validation/initial-supply";

type Resolution = "failed" | "expired_not_found";

interface HandoffRow {
  handoff_id: string;
  project_id: string;
  owner_public_key: string;
  asset_code: string;
  issuer_public_key: string;
  destination_public_key: string;
  amount: string;
  transaction_hash: string;
  unsigned_envelope_xdr: string;
  source_sequence: string;
  valid_until: Date;
  resolution: Resolution | null;
}

export class CustomerTrustlineGuardError extends Error {
  readonly code = "trustline_guard_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "CustomerTrustlineGuardError";
  }
}

export interface CustomerTrustlineHandoff {
  handoffId: string;
  projectId: string;
  ownerPublicKey: string;
  assetCode: string;
  issuerPublicKey: string;
  destinationPublicKey: string;
  amount: string;
  transactionHash: string;
  unsignedXdr: string;
  sourceSequence: string;
  validUntil: number;
  resolution: Resolution | null;
}

/** Browser amount is not authority for an already persisted handoff. */
export function bindPersistedCustomerTrustline(
  prior: CustomerTrustlineHandoff | null,
  input: {
    projectId: string;
    ownerPublicKey: string;
    assetCode: string;
    transactionHash: string;
    unsignedXdr?: string;
  },
) {
  if (
    !prior ||
    prior.projectId !== input.projectId ||
    prior.ownerPublicKey !== input.ownerPublicKey ||
    prior.destinationPublicKey !== input.ownerPublicKey ||
    prior.assetCode !== input.assetCode ||
    prior.transactionHash !== input.transactionHash ||
    (input.unsignedXdr !== undefined && input.unsignedXdr !== prior.unsignedXdr)
  ) {
    throw new CustomerTrustlineError("trustline_transaction_mismatch");
  }
  return {
    destinationPublicKey: prior.destinationPublicKey,
    assetCode: prior.assetCode,
    initialSupply: prior.amount,
    transactionHash: prior.transactionHash,
    unsignedXdr: prior.unsignedXdr,
  };
}

function mapHandoff(row: HandoffRow): CustomerTrustlineHandoff {
  return {
    handoffId: row.handoff_id,
    projectId: row.project_id,
    ownerPublicKey: row.owner_public_key.trim(),
    assetCode: row.asset_code,
    issuerPublicKey: row.issuer_public_key.trim(),
    destinationPublicKey: row.destination_public_key.trim(),
    amount: (() => {
      const value = validateInitialSupply(row.amount);
      if (!value.valid)
        throw new CustomerTrustlineGuardError(
          "Corrupt persisted trustline amount.",
        );
      return value.normalized;
    })(),
    transactionHash: row.transaction_hash.trim(),
    unsignedXdr: row.unsigned_envelope_xdr,
    sourceSequence: row.source_sequence,
    validUntil: Math.floor(row.valid_until.getTime() / 1000),
    resolution: row.resolution,
  };
}

export class PostgresCustomerTrustlineGuard {
  constructor(private readonly sql: DatabaseClient) {}

  async latest(
    projectId: string,
    owner: string,
  ): Promise<CustomerTrustlineHandoff | null> {
    const [row] = await this.sql<HandoffRow[]>`
      SELECT h.*, resolution.resolution
      FROM public.project_customer_change_trust_handoffs AS h
      JOIN public.project_profile_owners AS o
        ON o.project_id = h.project_id
      LEFT JOIN public.project_customer_change_trust_resolutions AS resolution
        ON resolution.handoff_id = h.handoff_id
      WHERE h.project_id = ${projectId}
        AND h.owner_public_key = ${owner}
        AND o.owner_public_key = ${owner}
      ORDER BY h.created_at DESC, h.handoff_id DESC
      LIMIT 1
    `;
    return row ? mapHandoff(row) : null;
  }

  async reserve(input: {
    projectId: string;
    ownerPublicKey: string;
    plan: CustomerTrustlinePlan;
  }): Promise<
    | { status: "claimed"; plan: CustomerTrustlinePlan }
    | { status: "pending"; transactionHash: string }
  > {
    if (
      input.plan.status !== "signature_required" ||
      !input.plan.unsignedXdr ||
      !input.plan.transactionHash ||
      !input.plan.validUntil ||
      input.plan.destinationPublicKey !== input.ownerPublicKey
    ) {
      throw new CustomerTrustlineGuardError(
        "Only exact customer ChangeTrust plans can be reserved.",
      );
    }
    let transaction: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(
        input.plan.unsignedXdr,
        Networks.TESTNET,
      );
      if (!(parsed instanceof Transaction)) throw new Error("fee bump");
      transaction = parsed;
    } catch {
      throw new CustomerTrustlineGuardError(
        "Invalid signable ChangeTrust plan.",
      );
    }
    const [outcome] = await this.sql<
      { result_handoff_id: string; result_claimed: boolean }[]
    >`
      SELECT * FROM public.reserve_customer_change_trust_handoff(
        ${randomUUID()}::uuid,
        ${input.projectId}::uuid,
        ${input.ownerPublicKey}::char(56),
        ${input.plan.assetCode}::varchar(12),
        ${input.plan.issuerPublicKey}::char(56),
        ${input.plan.destinationPublicKey}::char(56),
        ${input.plan.amount}::numeric,
        ${input.plan.transactionHash}::char(64),
        ${input.plan.unsignedXdr}::text,
        ${(BigInt(transaction.sequence) - 1n).toString()}::numeric,
        ${new Date(input.plan.validUntil * 1000)}::timestamptz
      )
    `;
    if (!outcome)
      throw new CustomerTrustlineGuardError(
        "Durable ChangeTrust reservation unavailable.",
      );
    if (!outcome.result_claimed) {
      const prior = await this.latest(input.projectId, input.ownerPublicKey);
      if (
        !prior ||
        prior.handoffId !== outcome.result_handoff_id ||
        prior.resolution
      ) {
        throw new CustomerTrustlineGuardError(
          "Concurrent pending ChangeTrust state changed.",
        );
      }
      return { status: "pending", transactionHash: prior.transactionHash };
    }
    return { status: "claimed", plan: input.plan };
  }
}

export class PostgresCustomerTrustlineResolutionWriter {
  constructor(private readonly sql: DatabaseClient) {}

  async terminal(input: {
    handoff: CustomerTrustlineHandoff;
    kind: Resolution;
    observedLedger: number;
    observedLedgerClosedAt: string;
    observedSourceSequence?: string;
  }): Promise<void> {
    const { handoff, kind } = input;
    if (
      !Number.isSafeInteger(input.observedLedger) ||
      input.observedLedger <= 0 ||
      !Number.isFinite(Date.parse(input.observedLedgerClosedAt)) ||
      (kind === "expired_not_found" &&
        (!input.observedSourceSequence ||
          input.observedSourceSequence !== handoff.sourceSequence ||
          Date.parse(input.observedLedgerClosedAt) <=
            handoff.validUntil * 1000))
    ) {
      throw new CustomerTrustlineGuardError(
        "Missing authoritative terminal reconciliation evidence.",
      );
    }
    await this.sql`
      INSERT INTO public.project_customer_change_trust_resolutions(
        handoff_id, transaction_hash, resolution, observed_ledger,
        observed_ledger_closed_at, observed_source_sequence
      ) VALUES (
        ${handoff.handoffId}::uuid, ${handoff.transactionHash}::char(64),
        ${kind}, ${input.observedLedger},
        ${new Date(input.observedLedgerClosedAt)}::timestamptz,
        ${input.observedSourceSequence ?? null}::numeric
      )
      ON CONFLICT (handoff_id) DO NOTHING
    `;
  }
}
