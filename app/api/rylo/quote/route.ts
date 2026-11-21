import { NextRequest, NextResponse } from "next/server";
import { getQuote, INITIAL_TRANCHE, MAX_AMOUNT, PRICE_XLM, REFERENCE_ISSUED, RYLO_CODE, RYLO_ISSUER, validQuantity } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("quantity");
  const quantity = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!validQuantity(quantity)) {
    return NextResponse.json({ error: "Choose between 1 and " + MAX_AMOUNT + " RYLO." }, { status: 400 });
  }
  try {
    const { path: _path, ...quote } = await getQuote(quantity);
    void _path;
    return NextResponse.json({
      ...quote, issuer: RYLO_ISSUER, code: RYLO_CODE, unitPriceCapXlm: PRICE_XLM,
      initialTranchePlanned: INITIAL_TRANCHE, referenceIssued: REFERENCE_ISSUED,
      initialTrancheVerifiedForSale: false
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Live Stellar quote is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
