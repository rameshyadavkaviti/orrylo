import { NextRequest, NextResponse } from "next/server";
import { prepareRyloPurchase, validPublicKey, validQuantity } from "@/lib/rylo";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { recordWebsitePurchase } from "@/lib/bonus-store";

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
    const purchaseTx = TransactionBuilder.fromXDR(result.xdr, Networks.PUBLIC);
    const purchaseHash = Buffer.from(purchaseTx.hash()).toString("hex");
    // Fail closed: never return a buyable XDR that promises an unregistered active reward.
    const bonus = await recordWebsitePurchase(purchaseHash, pubkey, quantity);
    return NextResponse.json({ ...result, purchaseHash, ...bonus }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Purchase could not be prepared.";
    const userFacing = /trustline|route|liquidity|costs more|quote|bonus|campaign|excluded/i.test(message)
      ? message
      : "Purchase preparation is unavailable. No transaction was submitted.";
    return NextResponse.json({ error: userFacing }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
