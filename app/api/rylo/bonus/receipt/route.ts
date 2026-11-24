import { NextRequest, NextResponse } from "next/server";
import { lookupBonus } from "@/lib/bonus-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("hash") || "";
  if (!/^[a-f0-9]{64}$/.test(hash)) return NextResponse.json({error:"Invalid purchase hash."}, {status:400});
  try {
    const row = await lookupBonus(hash);
    if (!row) return NextResponse.json({found:false}, {status:404, headers:{"Cache-Control":"no-store"}});
    return NextResponse.json({
      found:true, status:row.status, bonusAmountRylo:row.bonus_amount,
      payoutHash:row.payout_hash || null,
      reason:row.status === "rejected" ? row.rejection_reason : null
    }, {headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"Bonus status is temporarily unavailable."}, {status:503, headers:{"Cache-Control":"no-store"}});
  }
}
