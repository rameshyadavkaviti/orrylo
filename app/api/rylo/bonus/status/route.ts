import { NextResponse } from "next/server";
import { BONUS_ENABLED, BONUS_CAMPAIGN_ID } from "@/lib/bonus-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    active: BONUS_ENABLED, campaign: BONUS_CAMPAIGN_ID,
    thresholdExclusiveRylo: 1000, bonusPercent: 50, oncePerWallet: true,
    status: BONUS_ENABLED ? "active" : "preview"
  }, { headers: { "Cache-Control": "no-store" } });
}
