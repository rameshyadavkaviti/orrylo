import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/constants";
import { getWalletAuthService } from "../../../../lib/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HORIZON = {
  testnet: "https://horizon-testnet.stellar.org",
  public: "https://horizon.stellar.org",
} as const;

export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network");
  if (network !== "testnet" && network !== "public") {
    return NextResponse.json({ error: "invalid_network" }, { status: 400 });
  }

  const session = await getWalletAuthService().getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) {
    return NextResponse.json({ error: "wallet_disconnected" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    Keypair.fromPublicKey(session.publicKey);
    const response = await fetch(`${HORIZON[network]}/accounts/${session.publicKey}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (response.status === 404) {
      return NextResponse.json({ status: "unfunded", network }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!response.ok) throw new Error("horizon_unavailable");
    const account: unknown = await response.json();
    if (!account || typeof account !== "object" || !("account_id" in account) ||
        account.account_id !== session.publicKey || !("balances" in account) ||
        !Array.isArray(account.balances)) throw new Error("invalid_horizon_response");
    const native = account.balances.find((item: unknown) =>
      item !== null && typeof item === "object" && "asset_type" in item && item.asset_type === "native",
    );
    if (!native || !("balance" in native) || typeof native.balance !== "string" ||
        !/^(0|[1-9][0-9]*)\.[0-9]{7}$/.test(native.balance)) throw new Error("invalid_horizon_response");
    return NextResponse.json(
      { status: "ready", network, balance: native.balance },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "balance_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
