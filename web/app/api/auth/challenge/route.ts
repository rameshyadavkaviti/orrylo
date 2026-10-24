import { NextRequest, NextResponse } from "next/server";

import { isTrustedAuthOrigin } from "../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const config = readServerAuthConfig();

  if (!isTrustedAuthOrigin(request.headers.get("origin"), config.domain)) {
    return NextResponse.json(
      { code: "untrusted_origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requested = request.nextUrl.searchParams.getAll("network");
  if (requested.length > 1 || (requested[0] !== undefined &&
    requested[0] !== "testnet" && requested[0] !== "public")) {
    return NextResponse.json({ code: "invalid_request" }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
  const challenge = await getWalletAuthService().createChallenge(
    Date.now(), undefined, requested[0] ?? config.network,
  );

  return NextResponse.json(challenge, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
