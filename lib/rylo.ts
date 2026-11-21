import { Asset, Horizon, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";

export const RYLO_ISSUER = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";
export const RYLO_CODE = "RYLO";
export const INITIAL_TRANCHE = "3,517,680.9993500";
export const REFERENCE_ISSUED = "963,748,219";
export const MAX_AMOUNT = 10000;
export const PRICE_XLM = 0.1;
export const HORIZON_URL = "https://horizon.stellar.org";
const asset = new Asset(RYLO_CODE, RYLO_ISSUER);

type PathAsset = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};
type HorizonPath = {
  source_asset_type: string;
  source_amount: string;
  path: PathAsset[];
};
type PathResponse = { _embedded?: { records?: HorizonPath[] } };

export function validQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_AMOUNT;
}

export function validPublicKey(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

function decimalUnits(input: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(input)) throw new Error("Invalid Stellar amount.");
  const parts = input.split(".");
  return BigInt(parts[0]) * 10000000n + BigInt((parts[1] || "").padEnd(7, "0"));
}

function pathAsset(p: PathAsset): Asset {
  if (p.asset_type === "native") return Asset.native();
  if (
    (p.asset_type !== "credit_alphanum4" && p.asset_type !== "credit_alphanum12") ||
    !p.asset_code ||
    !p.asset_issuer ||
    !StrKey.isValidEd25519PublicKey(p.asset_issuer)
  ) throw new Error("Invalid on-chain path asset.");
  return new Asset(p.asset_code, p.asset_issuer);
}

export type RyloQuote = {
  available: boolean;
  quantity: number;
  referenceXlm: string;
  quotedXlm: string | null;
  reason: string | null;
  checkedAt: string;
};

type InternalQuote = RyloQuote & { path: Asset[] };

export async function getQuote(quantity: number): Promise<InternalQuote> {
  if (!validQuantity(quantity)) throw new Error("Choose between 1 and 10,000 RYLO.");
  const referenceXlm = (quantity / 10).toFixed(7);
  const checkedAt = new Date().toISOString();
  const endpoint = new URL(HORIZON_URL + "/paths/strict-receive");
  endpoint.searchParams.set("source_assets", "native");
  endpoint.searchParams.set("destination_asset_type", "credit_alphanum4");
  endpoint.searchParams.set("destination_asset_code", RYLO_CODE);
  endpoint.searchParams.set("destination_asset_issuer", RYLO_ISSUER);
  endpoint.searchParams.set("destination_amount", String(quantity));

  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Stellar market quote could not be verified.");
  const body = (await response.json()) as PathResponse;
  const records = (body._embedded?.records || []).filter((r) =>
    r.source_asset_type === "native" && typeof r.source_amount === "string" && Array.isArray(r.path)
  );
  const sorted = records.sort((a, b) => {
    const x = decimalUnits(a.source_amount);
    const y = decimalUnits(b.source_amount);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const best = sorted[0];
  if (!best) {
    return {
      available: false, quantity, referenceXlm, quotedXlm: null,
      reason: "No executable XLM → RYLO route is available for this amount.",
      checkedAt, path: []
    };
  }
  const path = best.path.map(pathAsset);
  if (decimalUnits(best.source_amount) > decimalUnits(referenceXlm)) {
    return {
      available: false, quantity, referenceXlm, quotedXlm: best.source_amount,
      reason: "Available market liquidity costs more than the 0.1 XLM per RYLO limit.",
      checkedAt, path
    };
  }
  return { available: true, quantity, referenceXlm, quotedXlm: best.source_amount, reason: null, checkedAt, path };
}

export async function prepareRyloPurchase(pubkey: string, quantity: number) {
  if (!validPublicKey(pubkey) || !validQuantity(quantity)) throw new Error("Invalid Stellar account or amount.");
  const quote = await getQuote(quantity);
  if (!quote.available) throw new Error(quote.reason || "No executable purchase quote.");
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(pubkey);
  const hasTrustline = account.balances.some(
    (balance) => "asset_code" in balance && balance.asset_code === RYLO_CODE &&
      "asset_issuer" in balance && balance.asset_issuer === RYLO_ISSUER
  );
  if (!hasTrustline) throw new Error("Add the RYLO trustline in Albedo before purchasing.");

  const transaction = new TransactionBuilder(account, {
    networkPassphrase: Networks.PUBLIC,
    fee: "100"
  })
    .addOperation(Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: quote.referenceXlm,
      destination: pubkey,
      destAsset: asset,
      destAmount: String(quantity),
      path: quote.path
    }))
    .setTimeout(120)
    .build();
  return {
    xdr: transaction.toXDR(),
    quotedXlm: quote.quotedXlm,
    maximumXlm: quote.referenceXlm,
    expiresInSeconds: 120
  };
}
