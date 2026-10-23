import { randomBytes, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../persistence/database";
import { normalizeWalletPublicKey } from "../persistence/wallet";
import { isValidProjectId } from "../../projects/project-profile";
import {
  verifyMainnetPayment,
  type MainnetPaymentResult,
} from "../../stellar/mainnet-payment-verification";

export const MAINNET_ISSUER =
  "GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS";
export const MAINNET_TREASURY =
  "GAABHXPQQB3EBT6FZJKGR6C6DT7XJEUEBGVPK2G2AQDKBIVXCBKXDBR7";

interface OrderRow {
  order_id: string;
  project_id: string;
  owner_public_key: string;
  issuer_public_key: string;
  treasury_public_key: string;
  asset_code: string;
  destination_public_key: string;
  initial_supply: string;
  memo: string;
  state: string;
  payment_transaction_hash: string | null;
  payment_ledger: string | null;
  expires_at: Date;
}

export class MainnetOrderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MainnetOrderError";
  }
}

/** An authenticated, project-owner-bound order. No funds are moved here. */
export async function createMainnetTokenOrder(
  sql: DatabaseClient,
  input: { projectId: string; ownerPublicKey: string; initialSupply: string },
): Promise<OrderRow> {
  if (!isValidProjectId(input.projectId) ||
      !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/.test(input.initialSupply) ||
      input.initialSupply === "0") {
    throw new MainnetOrderError("invalid_order");
  }
  const owner = normalizeWalletPublicKey(input.ownerPublicKey);
  return sql.begin(async (tx) => {
    // Serialized on the project row, so concurrent requests cannot create
    // different orders while racing for the same asset.
    const [project] = await tx<{ asset_code: string }[]>`
      SELECT p.asset_code FROM project_profiles p
      JOIN project_profile_owners o ON o.project_id = p.project_id
      WHERE p.project_id = ${input.projectId}
        AND o.owner_public_key = ${owner}
        AND p.network = 'public'
        AND p.issuer_model = 'shared'
        AND p.public_status = 'draft'
        AND p.deleted_at IS NULL
      FOR UPDATE OF p
    `;
    if (!project) throw new MainnetOrderError("project_not_found");
    // The first order permanently binds the initial supply and wallet.
    const [existing] = await tx<OrderRow[]>`
      SELECT * FROM mainnet_token_orders WHERE project_id = ${input.projectId}
    `;
    if (existing) {
      if (existing.owner_public_key !== owner ||
          existing.initial_supply !== input.initialSupply) {
        throw new MainnetOrderError("order_conflict");
      }
      return existing;
    }
    const [order] = await tx<OrderRow[]>`
      INSERT INTO mainnet_token_orders (
        order_id, project_id, owner_public_key, issuer_public_key,
        treasury_public_key, asset_code, destination_public_key,
        initial_supply, memo, expires_at
      ) VALUES (
        ${randomUUID()}, ${input.projectId}, ${owner},
        ${MAINNET_ISSUER}, ${MAINNET_TREASURY}, ${project.asset_code},
        ${owner}, ${input.initialSupply},
        ${"o" + randomBytes(14).toString("hex").slice(0, 27)},
        now() + interval '30 minutes'
      )
      RETURNING *
    `;
    if (!order) throw new MainnetOrderError("order_creation_failed");
    return order;
  });
}

/**
 * Read-only network lookup followed by a single conditional DB state change.
 * Unknown Horizon outcomes do not consume or release the order.
 */
export async function settleMainnetTokenOrder(
  sql: DatabaseClient,
  input: { orderId: string; ownerPublicKey: string; transactionHash: string },
  verify: typeof verifyMainnetPayment = verifyMainnetPayment,
): Promise<{ status: "paid" | "already_paid" | "not_found" | "rejected"; orderId: string }> {
  const owner = normalizeWalletPublicKey(input.ownerPublicKey);
  const [order] = await sql<OrderRow[]>`
    SELECT * FROM mainnet_token_orders
    WHERE order_id = ${input.orderId} AND owner_public_key = ${owner}
  `;
  if (!order) throw new MainnetOrderError("order_not_found");
  if (order.state !== "pending") {
    if (order.payment_transaction_hash === input.transactionHash.toLowerCase()) {
      return { status: "already_paid", orderId: order.order_id };
    }
    throw new MainnetOrderError("order_already_consumed");
  }
  // Payment after expiry must be reconciled/refunded, not auto-accepted.
  // The order's expiry is checked again atomically below.
  const outcome: MainnetPaymentResult = await verify({
    transactionHash: input.transactionHash,
    sender: order.owner_public_key,
    treasury: order.treasury_public_key,
    memo: order.memo,
  });
  if (outcome.status !== "confirmed") {
    return { status: outcome.status, orderId: order.order_id };
  }

  try {
    const [updated] = await sql<OrderRow[]>`
      UPDATE mainnet_token_orders SET
        state = 'paid',
        payment_transaction_hash = ${outcome.hash},
        payment_ledger = ${outcome.ledger},
        paid_at = now()
      WHERE order_id = ${input.orderId}
        AND owner_public_key = ${owner}
        AND state = 'pending'
        AND expires_at > now()
        AND payment_transaction_hash IS NULL
      RETURNING *
    `;
    if (updated) return { status: "paid", orderId: updated.order_id };
  } catch (error) {
    // Unique transaction-hash violations must never be converted into success.
    if ((error as { code?: string }).code === "23505") {
      throw new MainnetOrderError("payment_already_used");
    }
    throw error;
  }
  const [latest] = await sql<OrderRow[]>`
    SELECT * FROM mainnet_token_orders
    WHERE order_id = ${input.orderId} AND owner_public_key = ${owner}
  `;
  if (latest?.payment_transaction_hash === outcome.hash) {
    return { status: "already_paid", orderId: latest.order_id };
  }
  throw new MainnetOrderError("order_expired_or_conflicted");
}
