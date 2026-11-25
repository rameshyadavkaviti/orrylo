import { NextResponse } from "next/server";
import { BONUS_ENABLED, BONUS_CAMPAIGN_ID } from "@/lib/bonus-store";
import { BONUS_RATE, BONUS_THRESHOLD_RYLO } from "@/lib/bonus";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    active: BONUS_ENABLED, campaign: BONUS_CAMPAIGN_ID,
    minimumEligibleRylo: BONUS_THRESHOLD_RYLO, minimumInclusive: true,
    bonusPercent: BONUS_RATE * 100, oncePerWallet: true,
    status: BONUS_ENABLED ? "active" : "preview"
  }, { headers: { "Cache-Control": "no-store" } });
}
