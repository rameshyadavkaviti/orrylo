import { NextRequest, NextResponse } from "next/server";

import { createExpiredSessionCookiePolicy } from "../../../../lib/auth/cookies";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/constants";
import { getWalletAuthService } from "../../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = getWalletAuthService().getSession(token);

  const response = NextResponse.json(
    session
      ? {
          authenticated: true,
          publicKey: session.publicKey,
          expiresAt: session.expiresAt,
        }
      : {
          authenticated: false,
        },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

  if (token && !session) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      "",
      createExpiredSessionCookiePolicy(),
    );
  }

  return response;
}
