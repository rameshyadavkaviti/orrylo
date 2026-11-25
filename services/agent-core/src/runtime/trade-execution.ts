import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

type LoadedAccount = Account & {
  balances: Array<Record<string, unknown>>;
  subentry_count?: number;
};
type BuiltTransaction = ReturnType<TransactionBuilder["build"]>;

type OrderAsset = { asset_type: string; asset_code?: string; asset_issuer?: string };
type AccountOffer = { id: string; selling: OrderAsset; buying: OrderAsset; price?: string; last_modified_time?: string };
interface TradeServer {
  loadAccount(publicKey: string): Promise<LoadedAccount>;
  fetchBaseFee(): Promise<number>;
  offers(): {
    forAccount(publicKey: string): {
      limit(value: number): { call(): Promise<{ records: unknown[] }> };
    };
  };
  submitTransaction(transaction: BuiltTransaction): Promise<{ hash: string }>;
}

export interface TradeExecutionIntent {
  action: "buy" | "sell";
  publicKey: string;
  bestAskXlm: number | null;
  bestBidXlm: number | null;
  referencePriceXlm: number;
  confidence: number;
  urgency: number;
  dailyCommittedXlm: number;
}

export type TradeExecutionResult =
  | { status: "submitted"; hash: string; action: "buy" | "sell"; priceXlm: number; amountRylo: number; maxXlm: number }
  | { status: "blocked"; reason: "FREE_RESERVE" | "NO_RYLO" | "INVALID_PRICE" | "SIGNER_MISMATCH" | "OPEN_OFFER_CAP" | "MIN_ORDER_NOTIONAL" };

const fixed7 = (value: number): string => value.toFixed(7);
const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class StellarTradeExecutor {
  private readonly rylo: Asset;
  private readonly lastSweep = new Map<string, number>();
  private readonly accountLocks = new Map<string, Promise<void>>();

  private async exclusive<T>(publicKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.accountLocks.get(publicKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.accountLocks.set(publicKey, current);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.accountLocks.get(publicKey) === current) this.accountLocks.delete(publicKey);
    }
  }

  constructor(private readonly options: {
    ryloCode: string;
    ryloIssuer: string;
    maxTradeXlm: number;
    minOrderXlm?: number;
    dailyCapXlm: number;
    minFreeXlm: number;
    maxBuyPriceXlm: number;
    maxOpenOffers: number;
    server?: TradeServer;
  }) {
    this.rylo = new Asset(options.ryloCode, options.ryloIssuer);
  }

  private server(): TradeServer {
    return this.options.server ?? new Horizon.Server("https://horizon.stellar.org") as unknown as TradeServer;
  }


  private relevantOffers(records: unknown[]): AccountOffer[] {
    return records.filter((value): value is AccountOffer => {
      if (!value || typeof value !== "object") return false;
      const o = value as Partial<AccountOffer>;
      const rylo = (asset?: OrderAsset) =>
        asset?.asset_code === this.options.ryloCode && asset?.asset_issuer === this.options.ryloIssuer &&
        (asset.asset_type === "credit_alphanum4" || asset.asset_type === "credit_alphanum12");
      return typeof o.id === "string" && /^\d+$/.test(o.id) &&
        ((o.selling?.asset_type === "native" && rylo(o.buying)) ||
         (rylo(o.selling) && o.buying?.asset_type === "native"));
    });
  }

  // Safe maintenance: cancellation only, scoped to the agent's RYLO/XLM pair.
  // Runs irrespective of BUY/SELL/HOLD and never produces a trade match.
  async maintain(publicKey: string, signer: Keypair, now = Date.now()):
    Promise<{ status: "noop" | "submitted" | "blocked"; removed: number; hash?: string; reason?: string }> {
    return this.exclusive(publicKey, () => this.maintainUnlocked(publicKey, signer, now));
  }

  private async maintainUnlocked(publicKey: string, signer: Keypair, now: number):
    Promise<{ status: "noop" | "submitted" | "blocked"; removed: number; hash?: string; reason?: string }> {
    if (signer.publicKey() !== publicKey) return { status: "blocked", removed: 0, reason: "SIGNER_MISMATCH" };
    if (now - (this.lastSweep.get(publicKey) ?? 0) < 120_000) return { status: "noop", removed: 0 };
    const server = this.server();
    const book = await server.offers().forAccount(publicKey).limit(200).call();
    const offers = this.relevantOffers(book.records);
    // Preserve every legitimate standing order while this wallet is at or below its
    // configured cap, even if the order is old. Only cancel surplus RYLO/XLM orders.
    const excess = Math.max(0, offers.length - this.options.maxOpenOffers);
    const oldestFirst = [...offers].sort((a, b) => {
      const at = a.last_modified_time ? Date.parse(a.last_modified_time) : NaN;
      const bt = b.last_modified_time ? Date.parse(b.last_modified_time) : NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      // Horizon offer IDs increase as offers are created; use them as a fallback
      // if a timestamp is absent or equal. Never touch another asset pair.
      const aid = BigInt(a.id), bid = BigInt(b.id);
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    });
    const cancel = oldestFirst.slice(0, Math.min(4, excess));
    if (!cancel.length) {
      this.lastSweep.set(publicKey, now);
      return { status: "noop", removed: 0 };
    }
    const [account, baseFee] = await Promise.all([server.loadAccount(publicKey), server.fetchBaseFee()]);
    const fee = String(Math.max(Number(BASE_FEE), baseFee));
    const native = account.balances.find((item) => item.asset_type === "native");
    const reserve = 0.5 * (2 + number(account.subentry_count));
    if (number(native?.balance) - reserve < (Number(fee) * cancel.length) / 10_000_000) {
      return { status: "blocked", removed: 0, reason: "FEE_RESERVE" };
    }
    let builder = new TransactionBuilder(account, { fee, networkPassphrase: Networks.PUBLIC });
    for (const offer of cancel) {
      const selling = offer.selling.asset_type === "native" ? Asset.native() : this.rylo;
      const buying = offer.buying.asset_type === "native" ? Asset.native() : this.rylo;
      builder = builder.addOperation(Operation.manageSellOffer({
        selling, buying, amount: "0", price: offer.price && Number(offer.price) > 0 ? offer.price : "1", offerId: offer.id,
      }));
    }
    const transaction = builder.setTimeout(60).build();
    transaction.sign(signer);
    const submitted = await server.submitTransaction(transaction);
    this.lastSweep.set(publicKey, now);
    return { status: "submitted", removed: cancel.length, hash: submitted.hash };
  }

  async inspect(publicKey: string): Promise<{ nativeBalanceXlm: number; ryloBalance: number; hasRyloTrustline: boolean; openOffers: number }> {
    const server = this.server();
    const [account, offers] = await Promise.all([
      server.loadAccount(publicKey),
      server.offers().forAccount(publicKey).limit(200).call(),
    ]);
    const native = account.balances.find((balance) => balance.asset_type === "native");
    const trustline = account.balances.find((balance) =>
      balance.asset_code === this.options.ryloCode && balance.asset_issuer === this.options.ryloIssuer);
    return {
      nativeBalanceXlm: number(native?.balance),
      ryloBalance: number(trustline?.balance) - number(trustline?.selling_liabilities),
      hasRyloTrustline: Boolean(trustline),
      openOffers: this.relevantOffers(offers.records).length,
    };
  }

  async execute(intent: TradeExecutionIntent, signer: Keypair): Promise<TradeExecutionResult> {
    return this.exclusive(intent.publicKey, () => this.executeUnlocked(intent, signer));
  }

  private async executeUnlocked(intent: TradeExecutionIntent, signer: Keypair): Promise<TradeExecutionResult> {
    if (signer.publicKey() !== intent.publicKey) return { status: "blocked", reason: "SIGNER_MISMATCH" };
    const server = this.server();
    const [account, open] = await Promise.all([
      server.loadAccount(intent.publicKey),
      server.offers().forAccount(intent.publicKey).limit(200).call(),
    ]);
    if (this.relevantOffers(open.records).length >= this.options.maxOpenOffers)
      return { status: "blocked", reason: "OPEN_OFFER_CAP" };
    const native = account.balances.find((balance) => balance.asset_type === "native");
    const trustline = account.balances.find((balance) =>
      balance.asset_code === this.options.ryloCode && balance.asset_issuer === this.options.ryloIssuer);
    const nativeBalance = number(native?.balance);
    const nativeLiabilities = number(native?.selling_liabilities);
    const minimumReserve = 0.5 * (2 + number(account.subentry_count));
    const freeXlm = nativeBalance - nativeLiabilities - minimumReserve - this.options.minFreeXlm;
    const budget = Math.min(this.options.maxTradeXlm, Math.max(0, freeXlm));
    if (budget < 0.0000001) return { status: "blocked", reason: "FREE_RESERVE" };
    const minimum = this.options.minOrderXlm ?? 0;
    if (budget + 0.00000000001 < minimum) return { status: "blocked", reason: "MIN_ORDER_NOTIONAL" };
    const confidence = Math.min(1, Math.max(0, intent.confidence));
    const targetXlm = minimum + (budget - minimum) * confidence;

    let priceXlm: number;
    let amountRylo: number;
    let operation;
    if (intent.action === "buy") {
      const subjective = intent.referencePriceXlm * (0.9 + 0.08 * intent.confidence + 0.04 * intent.urgency);
      const nonCrossing = intent.bestAskXlm === null ? this.options.maxBuyPriceXlm : Math.max(0.0000001, intent.bestAskXlm - 0.0000001);
      priceXlm = Math.min(subjective, this.options.maxBuyPriceXlm, nonCrossing);
      if (!Number.isFinite(priceXlm) || priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      // Round the offer price first: the submitted notional must be >= minimum
      // even after the Stellar 7-decimal amount and price conversions.
      priceXlm = Number(fixed7(priceXlm));
      if (priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      amountRylo = Math.floor((targetXlm / priceXlm) * 10_000_000) / 10_000_000;
      if (amountRylo * priceXlm < minimum) {
        const exactMin = Math.ceil((minimum / priceXlm) * 10_000_000) / 10_000_000;
        if (exactMin * priceXlm > budget + 0.00000000001) return { status: "blocked", reason: "MIN_ORDER_NOTIONAL" };
        amountRylo = exactMin;
      }
      operation = Operation.manageBuyOffer({ selling: Asset.native(), buying: this.rylo, buyAmount: fixed7(amountRylo), price: fixed7(priceXlm) });
    } else {
      const availableRylo = number(trustline?.balance) - number(trustline?.selling_liabilities);
      if (!trustline || availableRylo < 0.0000001) return { status: "blocked", reason: "NO_RYLO" };
      const subjective = intent.referencePriceXlm * (1.02 + 0.12 * (1 - intent.confidence) + 0.04 * intent.urgency);
      const nonCrossing = intent.bestBidXlm === null ? intent.referencePriceXlm : intent.bestBidXlm + 0.0000001;
      priceXlm = Math.max(subjective, nonCrossing);
      if (!Number.isFinite(priceXlm) || priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      priceXlm = Number(fixed7(priceXlm));
      if (priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      amountRylo = Math.min(availableRylo, Math.floor((targetXlm / priceXlm) * 10_000_000) / 10_000_000);
      if (amountRylo * priceXlm < minimum) return { status: "blocked", reason: "MIN_ORDER_NOTIONAL" };
      operation = Operation.manageSellOffer({ selling: this.rylo, buying: Asset.native(), amount: fixed7(amountRylo), price: fixed7(priceXlm) });
    }
    if (amountRylo < 0.0000001) return { status: "blocked", reason: intent.action === "sell" ? "NO_RYLO" : "FREE_RESERVE" };
    const fee = String(Math.max(Number(BASE_FEE), await server.fetchBaseFee()));
    const transaction = new TransactionBuilder(account, { fee, networkPassphrase: Networks.PUBLIC })
      .addOperation(operation)
      .setTimeout(60)
      .build();
    transaction.sign(signer);
    const submitted = await server.submitTransaction(transaction);
    return {
      status: "submitted",
      hash: submitted.hash,
      action: intent.action,
      priceXlm: Number(fixed7(priceXlm)),
      amountRylo: Number(fixed7(amountRylo)),
      maxXlm: Number(fixed7(priceXlm * amountRylo)),
    };
  }
}
