import { NextResponse } from "next/server";

import { getWalletAuthService } from "../../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function POST() {
  const challenge = getWalletAuthService().createChallenge();

  return NextResponse.json(challenge, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
