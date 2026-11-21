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
  | { status: "blocked"; reason: "DAILY_CAP" | "OPEN_OFFER_CAP" | "FREE_RESERVE" | "NO_RYLO" | "INVALID_PRICE" | "SIGNER_MISMATCH" };

const fixed7 = (value: number): string => value.toFixed(7);
const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class StellarTradeExecutor {
  private readonly rylo: Asset;

  constructor(private readonly options: {
    ryloCode: string;
    ryloIssuer: string;
    maxTradeXlm: number;
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
      openOffers: offers.records.length,
    };
  }

  async execute(intent: TradeExecutionIntent, signer: Keypair): Promise<TradeExecutionResult> {
    if (signer.publicKey() !== intent.publicKey) return { status: "blocked", reason: "SIGNER_MISMATCH" };
    const remainingDaily = this.options.dailyCapXlm - intent.dailyCommittedXlm;
    if (remainingDaily < 0.0000001) return { status: "blocked", reason: "DAILY_CAP" };
    const server = this.server();
    const [account, offers] = await Promise.all([
      server.loadAccount(intent.publicKey),
      server.offers().forAccount(intent.publicKey).limit(200).call(),
    ]);
    if (offers.records.length >= this.options.maxOpenOffers) return { status: "blocked", reason: "OPEN_OFFER_CAP" };
    const native = account.balances.find((balance) => balance.asset_type === "native");
    const trustline = account.balances.find((balance) =>
      balance.asset_code === this.options.ryloCode && balance.asset_issuer === this.options.ryloIssuer);
    const nativeBalance = number(native?.balance);
    const nativeLiabilities = number(native?.selling_liabilities);
    const minimumReserve = 0.5 * (2 + number(account.subentry_count));
    const freeXlm = nativeBalance - nativeLiabilities - minimumReserve - this.options.minFreeXlm;
    const budget = Math.min(this.options.maxTradeXlm, remainingDaily, Math.max(0, freeXlm));
    if (budget < 0.0000001) return { status: "blocked", reason: "FREE_RESERVE" };

    let priceXlm: number;
    let amountRylo: number;
    let operation;
    if (intent.action === "buy") {
      const subjective = intent.referencePriceXlm * (0.9 + 0.08 * intent.confidence + 0.04 * intent.urgency);
      const nonCrossing = intent.bestAskXlm === null ? this.options.maxBuyPriceXlm : Math.max(0.0000001, intent.bestAskXlm - 0.0000001);
      priceXlm = Math.min(subjective, this.options.maxBuyPriceXlm, nonCrossing);
      if (!Number.isFinite(priceXlm) || priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      amountRylo = Math.floor((budget / priceXlm) * 10_000_000) / 10_000_000;
      operation = Operation.manageBuyOffer({ selling: Asset.native(), buying: this.rylo, buyAmount: fixed7(amountRylo), price: fixed7(priceXlm) });
    } else {
      const availableRylo = number(trustline?.balance) - number(trustline?.selling_liabilities);
      if (!trustline || availableRylo < 0.0000001) return { status: "blocked", reason: "NO_RYLO" };
      const subjective = intent.referencePriceXlm * (1.02 + 0.12 * (1 - intent.confidence) + 0.04 * intent.urgency);
      const nonCrossing = intent.bestBidXlm === null ? intent.referencePriceXlm : intent.bestBidXlm + 0.0000001;
      priceXlm = Math.max(subjective, nonCrossing);
      if (!Number.isFinite(priceXlm) || priceXlm <= 0) return { status: "blocked", reason: "INVALID_PRICE" };
      amountRylo = Math.min(availableRylo, Math.floor((budget / priceXlm) * 10_000_000) / 10_000_000);
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
