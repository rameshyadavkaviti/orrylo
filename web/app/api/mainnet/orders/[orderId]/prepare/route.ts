import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../../../../lib/server/persistence/database";
import {
  MainnetOrderError,
  prepareMainnetOrderPayment,
} from "../../../../../../lib/server/projects/mainnet-token-orders";

export const runtime = "nodejs";

/**
 * Deliberately unavailable until explicit activation and tests.
 * This handler only returns an unsigned XDR: it never signs or submits.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const config = readServerAuthConfig();
  if (process.env.ORRYLO_MAINNET_ORDERS_ENABLED !== "true" ||
      process.env.ORRYLO_MAINNET_PAYMENT_PREPARE_ENABLED !== "true") {
    return fail("mainnet_payment_preparation_disabled", 503);
  }
  if (!isTrustedAuthOrigin(request.headers.get("origin"), config.domain)) {
    return fail("untrusted_origin", 403);
  }
  const session = await getWalletAuthService().getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return fail("unauthenticated", 401);
  const { orderId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return fail("invalid_order_id", 400);
  }
  try {
    const result = await prepareMainnetOrderPayment(getDatabaseClient(), {
      orderId, ownerPublicKey: session.publicKey,
    });
    return NextResponse.json({
      ok: true, ...result,
      warning: "Unsigned plan only. Wallet submission is not enabled.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MainnetOrderError) {
      return fail(error.code, error.code === "order_not_found" ? 404 : 409);
    }
    return fail("payment_preparation_unavailable", 503);
  }
}
function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}
