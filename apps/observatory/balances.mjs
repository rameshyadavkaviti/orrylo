// Read-only Stellar Horizon account balance polling. Secrets are never used.
const STROOPS = 10_000_000n;
const RETRY_MS = 45_000;
const HTTP_TIMEOUT_MS = 8_000;
const VALID_KEY = /^G[A-Z2-7]{55}$/;
const VALID_AMOUNT = /^\d+(?:\.\d{1,7})?$/;

function toUnits(amount) {
  if (typeof amount !== "string" || !VALID_AMOUNT.test(amount)) throw new Error("INVALID_AMOUNT");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * STROOPS + BigInt(fraction.padEnd(7, "0"));
}
function fromUnits(amount) {
  const whole = amount / STROOPS;
  const fraction = (amount % STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
async function accountBalance(publicKey, config) {
  if (!VALID_KEY.test(publicKey)) return { status: "invalid_public_key", xlm: null, rylo: null };
  try {
    const response = await fetch(config.horizonUrl + "/accounts/" + encodeURIComponent(publicKey), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (response.status === 404) return { status: "account_not_found", xlm: null, rylo: null };
    if (!response.ok) return { status: "horizon_http_" + response.status, xlm: null, rylo: null };
    const data = await response.json();
    if (!Array.isArray(data?.balances)) throw new Error("INVALID_RESPONSE");
    const native = data.balances.find(b => b.asset_type === "native");
    if (!native || typeof native.balance !== "string") throw new Error("NO_NATIVE_BALANCE");
    const rylo = data.balances.find(b => b.asset_code === config.ryloCode && b.asset_issuer === config.ryloIssuer);
    const xlm = fromUnits(toUnits(native.balance));
    const assetBalance = rylo ? fromUnits(toUnits(rylo.balance)) : "0";
    return { status: "ok", xlm, rylo: assetBalance, hasRyloTrustline: !!rylo };
  } catch (error) {
    return { status: error?.name === "TimeoutError" ? "timeout" : "horizon_unavailable", xlm: null, rylo: null };
  }
}
export function createBalanceReader(config) {
  let cache = { expires: 0, key: "", data: null, pending: null };
  return async function balances(agents) {
    const keys = [...new Set(agents.map(a => a.public_key).filter(Boolean))];
    const cacheKey = keys.slice().sort().join("|");
    if (cache.data && Date.now() < cache.expires && cache.key === cacheKey) return cache.data;
    if (cache.pending && cache.key === cacheKey) return cache.pending;
    cache.key = cacheKey;
    const work = (async () => {
      const rows = new Array(keys.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(5, keys.length) }, async () => {
        while (cursor < keys.length) {
          const pos = cursor++;
          rows[pos] = { publicKey: keys[pos], ...await accountBalance(keys[pos], config) };
        }
      }));
      let xlmUnits = 0n, ryloUnits = 0n, complete = 0;
      for (const r of rows) {
        if (r.status !== "ok") continue;
        complete++;
        xlmUnits += toUnits(r.xlm);
        ryloUnits += toUnits(r.rylo);
      }
      const result = {
        checkedAt: new Date().toISOString(),
        asset: { code: config.ryloCode, issuer: config.ryloIssuer },
        verified: complete,
        totalAccounts: keys.length,
        allVerified: complete === keys.length,
        totals: { xlm: fromUnits(xlmUnits), rylo: fromUnits(ryloUnits) },
        accounts: rows
      };
      cache.data = result;
      cache.expires = Date.now() + RETRY_MS;
      return result;
    })();
    cache.pending = work;
    try { return await work; } finally { if (cache.pending === work) cache.pending = null; }
  };
}
