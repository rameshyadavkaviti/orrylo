import { NextRequest, NextResponse } from "next/server";
import { HORIZON_URL } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("hash") || "";
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
    return NextResponse.json({ error: "Invalid transaction hash." }, { status: 400 });
  }
  try {
    const result = await fetch(HORIZON_URL + "/transactions/" + hash, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (result.status === 404) return NextResponse.json({ confirmed: false }, { headers: { "Cache-Control": "no-store" } });
    if (!result.ok) throw new Error("Horizon unavailable");
    const tx = (await result.json()) as { successful?: boolean };
    return NextResponse.json({ confirmed: tx.successful === true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ confirmed: false, verificationUnavailable: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
