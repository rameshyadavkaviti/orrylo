import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { discoverWallets } from "../enrollment/wallet-env.js";

// One-off, idempotent emergency procedure. It NEVER places an offer, trades,
// transfers assets or alters trustlines. Wallet secrets never enter the logs.
type OfferAsset = { asset_type: string; asset_code?: string; asset_issuer?: string };
type OfferRecord = { id: string; price: string; selling: OfferAsset; buying: OfferAsset };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function toAsset(record: OfferAsset): Asset {
  if (record.asset_type === "native") return Asset.native();
  if ((record.asset_type === "credit_alphanum4" || record.asset_type === "credit_alphanum12") &&
      record.asset_code && record.asset_issuer) {
    return new Asset(record.asset_code, record.asset_issuer);
  }
  throw new Error("UNSUPPORTED_OFFER_ASSET");
}

function safeError(error: unknown): { name: string; transactionCode?: string; operationCodes?: unknown } {
  const x = error as { name?: string; response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: unknown } } } } };
  return {
    name: typeof x?.name === "string" ? x.name : "UNKNOWN_ERROR",
    transactionCode: x?.response?.data?.extras?.result_codes?.transaction,
    operationCodes: x?.response?.data?.extras?.result_codes?.operations,
  };
}

async function main(): Promise<void> {
  if (process.env.ORRYLO_PAUSED !== "true" ||
      process.env.ORRYLO_EXECUTION_ENABLED !== "false" ||
      process.env.ORRYLO_DECISION_ENABLED !== "false" ||
      process.env.ORRYLO_CLAIM_EXECUTION_ENABLED !== "false") {
    throw new Error("EMERGENCY_CANCELLATION_REQUIRES_PAUSED_AGENT_CORE");
  }
  const prefix = process.env.ORRYLO_AGENT_ENV_PREFIX ?? "ORRYLO_AGENT_";
  const discovered = discoverWallets(process.env, prefix);
  if (discovered.issues.length) {
    console.error(JSON.stringify({ event: "cancel_agent_offers_discovery_failed", issueCodes: discovered.issues.map(i => i.code) }));
    throw new Error("UNVERIFIED_AGENT_WALLETS");
  }
  if (discovered.wallets.length !== 50) throw new Error("EXPECTED_50_VERIFIED_AGENT_WALLETS");
  const server = new Horizon.Server(process.env.ORRYLO_HORIZON_URL ?? "https://horizon.stellar.org");
  let cancelled = 0, succeeded = 0, failed = 0, remaining = 0;
  console.log(JSON.stringify({ event: "cancel_agent_offers_started", accounts: discovered.wallets.length }));
  for (const wallet of discovered.wallets) {
    const secret = process.env[`${prefix}${wallet.alias}_SECRET_KEY`];
    if (!secret) throw new Error("MISSING_VERIFIED_SIGNER");
    const keypair = Keypair.fromSecret(secret);
    if (keypair.publicKey() !== wallet.publicKey) throw new Error("SIGNER_MISMATCH");
    let walletCancelled = 0;
    let walletFailed = false;
    let lastError: ReturnType<typeof safeError> | undefined;
    // Request only the first page repeatedly; successful cancels shrink it.
    // This safely handles more than 200 offers without storing arbitrary limits.
    for (let cycle = 0; cycle < 120; cycle++) {
      let offers: OfferRecord[];
      try {
        const response = await server.offers().forAccount(wallet.publicKey).limit(200).call();
        offers = response.records as unknown as OfferRecord[];
      } catch (error) {
        walletFailed = true;
        lastError = safeError(error);
        break;
      }
      if (!offers.length) break;
      const batch = offers.slice(0, 4);
      let cancelledBatch = false;
      for (let attempt = 0; attempt < 3 && !cancelledBatch; attempt++) {
        try {
          const account = await server.loadAccount(wallet.publicKey);
          const baseFee = await server.fetchBaseFee();
          let txBuilder = new TransactionBuilder(account, {
            fee: String(Math.max(Number(BASE_FEE), baseFee)),
            networkPassphrase: Networks.PUBLIC,
          });
          for (const offer of batch) {
            if (!/^\d+$/.test(offer.id) || !Number.isFinite(Number(offer.price)) || Number(offer.price) <= 0)
              throw new Error("INVALID_EXISTING_OFFER");
            txBuilder = txBuilder.addOperation(Operation.manageSellOffer({
              selling: toAsset(offer.selling),
              buying: toAsset(offer.buying),
              amount: "0",
              price: offer.price,
              offerId: offer.id,
            }));
          }
          const transaction = txBuilder.setTimeout(60).build();
          transaction.sign(keypair);
          const result = await server.submitTransaction(transaction);
          walletCancelled += batch.length;
          cancelled += batch.length;
          cancelledBatch = true;
          console.log(JSON.stringify({
            event: "cancel_agent_offers_batch",
            agent: wallet.alias, count: batch.length, hash: result.hash,
          }));
          await delay(850);
        } catch (error) {
          lastError = safeError(error);
          if (attempt < 2) await delay((attempt + 1) * 1500);
        }
      }
      if (!cancelledBatch) {
        walletFailed = true;
        break;
      }
      if (cycle === 119) {
        walletFailed = true;
        lastError = { name: "PAGINATION_LOOP_LIMIT" };
      }
    }
    try {
      const pending = await server.offers().forAccount(wallet.publicKey).limit(200).call();
      const left = pending.records.length;
      remaining += left;
      if (left) walletFailed = true;
      if (walletFailed) {
        failed++;
        console.error(JSON.stringify({event: "cancel_agent_offers_account_incomplete", agent: wallet.alias,
          cancelled: walletCancelled, remainingAtLeast: left, error: lastError }));
      } else {
        succeeded++;
        console.log(JSON.stringify({event: "cancel_agent_offers_account_complete", agent: wallet.alias, cancelled: walletCancelled }));
      }
    } catch (error) {
      failed++;
      console.error(JSON.stringify({event: "cancel_agent_offers_account_verify_failed", agent: wallet.alias,
        error: safeError(error) }));
    }
  }
  console.log(JSON.stringify({ event: "cancel_agent_offers_summary", accounts: discovered.wallets.length,
    succeeded, failed, cancelled, remainingAtLeast: remaining }));
  if (failed !== 0 || remaining !== 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({event: "cancel_agent_offers_fatal", error: error instanceof Error ? error.message : "UNKNOWN_ERROR"}));
  process.exitCode = 3;
});
