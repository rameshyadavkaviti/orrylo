import { NextRequest, NextResponse } from "next/server";
import { prepareRyloPurchase, validPublicKey, validQuantity } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2048) return NextResponse.json({ error: "Invalid request." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { pubkey, quantity } = body as Record<string, unknown>;
  if (!validPublicKey(pubkey) || !validQuantity(quantity)) {
    return NextResponse.json({ error: "Invalid wallet or RYLO quantity." }, { status: 400 });
  }
  try {
    const result = await prepareRyloPurchase(pubkey, quantity);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Purchase could not be prepared.";
    const userFacing = /trustline|route|liquidity|costs more|quote/i.test(message)
      ? message
      : "Stellar could not verify the wallet or prepare this transaction.";
    return NextResponse.json({ error: userFacing }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
