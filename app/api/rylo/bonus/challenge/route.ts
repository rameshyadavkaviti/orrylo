import { NextRequest, NextResponse } from "next/server";
import { issueBonusChallenge } from "@/lib/bonus-store";
import { validPublicKey } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 400)
    return NextResponse.json({error:"Invalid request."}, {status:413});
  let value: unknown;
  try { value = await request.json(); } catch {
    return NextResponse.json({error:"Invalid request."}, {status:400});
  }
  const pubkey = value && typeof value === "object"
    ? (value as Record<string,unknown>).pubkey : null;
  if (!validPublicKey(pubkey)) return NextResponse.json({error:"Invalid Stellar account."}, {status:400});
  try {
    const challenge = await issueBonusChallenge(pubkey);
    return NextResponse.json(challenge, {headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"Unable to issue bonus verification challenge."}, {status:503});
  }
}
