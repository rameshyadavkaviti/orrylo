import { NextRequest, NextResponse } from "next/server";

import {
  createExpiredSessionCookiePolicy,
} from "../../../../lib/auth/cookies";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/constants";
import { getWalletAuthService } from "../../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  getWalletAuthService().logout(token);

  const response = NextResponse.json(
    { authenticated: false },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

  response.cookies.set(
    SESSION_COOKIE_NAME,
    "",
    createExpiredSessionCookiePolicy(),
  );

  return response;
}
