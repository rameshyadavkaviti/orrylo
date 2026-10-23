import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../../../../lib/server/persistence/database";
import {
  MainnetOrderError,
  settleMainnetTokenOrder,
} from "../../../../../../lib/server/projects/mainnet-token-orders";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const config = readServerAuthConfig();
  if (config.network !== "public" ||
      process.env.ORRYLO_MAINNET_ORDERS_ENABLED !== "true") {
    return fail("mainnet_orders_disabled", 503);
  }
  if (!isTrustedAuthOrigin(request.headers.get("origin"), config.domain)) {
    return fail("untrusted_origin", 403);
  }
  const session = await getWalletAuthService().getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return fail("unauthenticated", 401);
  const { orderId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,28}$/i.test(orderId)) {
    return fail("invalid_request", 400);
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return fail("invalid_request", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("invalid_request", 400);
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).join(",") !== "transactionHash" ||
      typeof fields.transactionHash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(fields.transactionHash)) {
    return fail("invalid_request", 400);
  }
  try {
    const result = await settleMainnetTokenOrder(getDatabaseClient(), {
      orderId, ownerPublicKey: session.publicKey,
      transactionHash: fields.transactionHash,
    });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof MainnetOrderError) {
      return fail(error.code,
        error.code === "order_not_found" ? 404 :
        error.code === "payment_outside_order_window" ? 409 : 409);
    }
    return fail("payment_verification_unavailable", 503);
  }
}

function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}
