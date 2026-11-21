import { NextResponse } from "next/server";
import { HORIZON_URL, RYLO_CODE, RYLO_ISSUER } from "@/lib/rylo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderLevel = { price: string; amount: string; price_r: { n: number; d: number } };
type OrderBook = { asks?: OrderLevel[] };

function toStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Invalid order book level.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10000000n + BigInt(fraction.padEnd(7, "0"));
}

function fromStroops(value: bigint): string {
  const whole = value / 10000000n;
  const fractional = (value % 10000000n).toString().padStart(7, "0").replace(/0+$/, "");
  return whole.toLocaleString("en-US") + (fractional ? "." + fractional : "");
}

export async function GET() {
  const url = new URL("/order_book", HORIZON_URL);
  url.searchParams.set("selling_asset_type", "credit_alphanum4");
  url.searchParams.set("selling_asset_code", RYLO_CODE);
  url.searchParams.set("selling_asset_issuer", RYLO_ISSUER);
  url.searchParams.set("buying_asset_type", "native");
  url.searchParams.set("limit", "200");

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Unable to retrieve order book.");
    const book = await response.json() as OrderBook;
    if (!Array.isArray(book.asks)) throw new Error("Unexpected order book.");
    let available = 0n;
    let bestAsk: string | null = null;
    let counted = 0;
    for (const level of book.asks) {
      if (typeof level.price !== "string" || typeof level.amount !== "string") continue;
      const n = level.price_r?.n;
      const d = level.price_r?.d;
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n <= 0 || d <= 0) continue;
      const price = toStroops(level.price);
      if (bestAsk === null || price < toStroops(bestAsk)) bestAsk = level.price;
      // Use the exact on-chain rational price, not a rounded decimal display value.
      if (BigInt(n) * 10n <= BigInt(d)) {
        available += toStroops(level.amount);
        counted++;
      }
    }
    return NextResponse.json({
      amountAtOrBelowLimit: fromStroops(available),
      priceLimitXlm: "0.1000000",
      bestAskXlm: bestAsk,
      priceLevelsAtOrBelowLimit: counted,
      limitedToTop200Levels: book.asks.length >= 200,
      checkedAt: new Date().toISOString(),
      market: "direct RYLO/XLM order book",
      verified: true
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      error: "Stellar order book cannot be verified right now.",
      verified: false
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
