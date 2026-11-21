import { NextRequest, NextResponse } from "next/server";
import { HORIZON_URL, RYLO_CODE, RYLO_ISSUER, validPublicKey } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const pubkey = request.nextUrl.searchParams.get("pubkey");
  if (!validPublicKey(pubkey)) return NextResponse.json({ error: "Invalid Stellar wallet." }, { status: 400 });
  try {
    const result = await fetch(HORIZON_URL + "/accounts/" + pubkey, {
      cache: "no-store", signal: AbortSignal.timeout(10000)
    });
    if (!result.ok) throw new Error("Wallet account is not active on Stellar mainnet.");
    const account = (await result.json()) as { balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }> };
    const hasTrustline = (account.balances || []).some(
      (balance) => balance.asset_code === RYLO_CODE && balance.asset_issuer === RYLO_ISSUER
    );
    return NextResponse.json({ hasTrustline }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to check the mainnet wallet and trustline." }, { status: 503 });
  }
}
