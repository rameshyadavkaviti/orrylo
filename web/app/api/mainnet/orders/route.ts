import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../lib/auth/origin";
import { getWalletAuthService, readServerAuthConfig } from "../../../../lib/auth/runtime";
import { getDatabaseClient } from "../../../../lib/server/persistence/database";
import {
  createMainnetTokenOrder,
  MainnetOrderError,
} from "../../../../lib/server/projects/mainnet-token-orders";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try { body = await request.json(); }
  catch { return fail("invalid_request", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("invalid_request", 400);
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== "initialSupply,projectId" ||
      typeof fields.projectId !== "string" ||
      typeof fields.initialSupply !== "string") {
    return fail("invalid_request", 400);
  }
  try {
    const order = await createMainnetTokenOrder(getDatabaseClient(), {
      projectId: fields.projectId,
      initialSupply: fields.initialSupply,
      ownerPublicKey: session.publicKey,
    });
    return NextResponse.json({
      ok: true, orderId: order.order_id, projectId: order.project_id,
      network: "public", issuer: order.issuer_public_key,
      treasury: order.treasury_public_key, memo: order.memo,
      priceXlm: "10.0000000", initialSupply: order.initial_supply,
      status: order.state, expiresAt: order.expires_at.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MainnetOrderError) {
      return fail(error.code,
        error.code === "invalid_order" ? 400 :
        error.code === "project_not_found" ? 404 : 409);
    }
    return fail("order_unavailable", 503);
  }
}

function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}
