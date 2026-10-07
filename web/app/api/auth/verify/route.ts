import { NextRequest, NextResponse } from "next/server";

import {
  createSessionCookiePolicy,
} from "../../../../lib/auth/cookies";
import { parseVerifyWalletRequest } from "../../../../lib/auth/http";
import { getWalletAuthService } from "../../../../lib/auth/runtime";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/constants";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }

  const verificationRequest = parseVerifyWalletRequest(body);

  if (!verificationRequest) {
    return errorResponse("invalid_request", 400);
  }

  const result = getWalletAuthService().verifyWallet(verificationRequest);

  if (!result.ok) {
    if (result.code === "challenge_expired") {
      return errorResponse(result.code, 410);
    }

    if (result.code === "challenge_missing_or_used") {
      return errorResponse(result.code, 409);
    }

    return errorResponse(result.code, 401);
  }

  const response = NextResponse.json(
    {
      authenticated: true,
      publicKey: result.session.publicKey,
      expiresAt: result.session.expiresAt,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

  const cookie = createSessionCookiePolicy(result.session.expiresAt);
  response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, cookie);

  return response;
}

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { authenticated: false, code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
