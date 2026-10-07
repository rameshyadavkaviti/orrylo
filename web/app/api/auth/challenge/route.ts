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

  const challenge = getWalletAuthService().createChallenge();

  return NextResponse.json(challenge, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
