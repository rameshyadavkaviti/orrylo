import type { AgentRepository } from "../db/repository.js";

interface OrderBookEntry {
  price: string;
  amount: string;
}

export interface HorizonOrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

export interface MarketContext extends Record<string, unknown> {
  contextTag: "rylo_xlm_market";
  priceChange: number;
  scarcity: number;
  uncertainty: number;
  stakes: number;
  rivalGain: 0;
  goalConflict: number;
  accountability: 1;
  timePressure: number;
  liquidityStress: number;
  valence: number;
  socialReliability: number;
  bestBidXlm: number | null;
  bestAskXlm: number | null;
  askDepthRylo: number;
  bidDepthRylo: number;
}

export interface MarketSnapshot {
  observedAt: string;
  context: MarketContext;
}

interface LoggerLike {
  info(value: unknown): void;
  error(value: unknown): void;
}

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));
const finite = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const depth = (entries: OrderBookEntry[]): number => entries.reduce((sum, entry) => sum + (finite(entry.amount) ?? 0), 0);

export function marketContextFromOrderBook(
  orderBook: HorizonOrderBook,
  referencePriceXlm: number,
  previousMidXlm?: number,
): MarketContext {
  const bestBidXlm = finite(orderBook.bids[0]?.price) ?? null;
  const bestAskXlm = finite(orderBook.asks[0]?.price) ?? null;
  const midXlm = bestBidXlm !== null && bestAskXlm !== null
    ? (bestBidXlm + bestAskXlm) / 2
    : bestAskXlm ?? bestBidXlm ?? referencePriceXlm;
  const priceChange = previousMidXlm && previousMidXlm > 0 ? clamp((midXlm - previousMidXlm) / previousMidXlm, -1, 1) : 0;
  const askDepthRylo = depth(orderBook.asks);
  const bidDepthRylo = depth(orderBook.bids);
  const missingSides = Number(bestBidXlm === null) + Number(bestAskXlm === null);
  const spread = bestBidXlm !== null && bestAskXlm !== null && midXlm > 0 ? (bestAskXlm - bestBidXlm) / midXlm : 1;
  const uncertainty = clamp(0.2 + missingSides * 0.4 + clamp(spread) * 0.4);
  const scarcity = clamp(1 - askDepthRylo / 5_000);
  const deviation = clamp(Math.abs(midXlm - referencePriceXlm) / referencePriceXlm);
  const liquidityStress = clamp(missingSides * 0.45 + Number(askDepthRylo < 100) * 0.25 + Number(bidDepthRylo < 100) * 0.25);

  return {
    contextTag: "rylo_xlm_market",
    priceChange,
    scarcity,
    uncertainty,
    stakes: clamp(0.25 + deviation * 0.5 + liquidityStress * 0.25),
    rivalGain: 0,
    goalConflict: clamp(0.2 + uncertainty * 0.55 + liquidityStress * 0.25),
    accountability: 1,
    timePressure: clamp(Math.abs(priceChange) * 2),
    liquidityStress,
    valence: clamp((referencePriceXlm - midXlm) / referencePriceXlm, -1, 1),
    socialReliability: 0.5,
    bestBidXlm,
    bestAskXlm,
    askDepthRylo,
    bidDepthRylo,
  };
}

export class HorizonMarketObserver {
  private previousMidXlm?: number;

  constructor(private readonly options: {
    horizonUrl: string;
    ryloCode: string;
    ryloIssuer: string;
    referencePriceXlm: number;
    fetcher?: typeof fetch;
  }) {}

  async observe(): Promise<MarketSnapshot> {
    const params = new URLSearchParams({
      selling_asset_type: "credit_alphanum4",
      selling_asset_code: this.options.ryloCode,
      selling_asset_issuer: this.options.ryloIssuer,
      buying_asset_type: "native",
    });
    const response = await (this.options.fetcher ?? fetch)(`${this.options.horizonUrl}/order_book?${params}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HorizonOrderBookError:${response.status}`);
    const body = await response.json() as Partial<HorizonOrderBook>;
    const orderBook: HorizonOrderBook = {
      bids: Array.isArray(body.bids) ? body.bids : [],
      asks: Array.isArray(body.asks) ? body.asks : [],
    };
    const context = marketContextFromOrderBook(orderBook, this.options.referencePriceXlm, this.previousMidXlm);
    const currentMid = context.bestBidXlm !== null && context.bestAskXlm !== null
      ? (context.bestBidXlm + context.bestAskXlm) / 2
      : context.bestAskXlm ?? context.bestBidXlm ?? this.options.referencePriceXlm;
    this.previousMidXlm = currentMid;
    return { observedAt: new Date().toISOString(), context };
  }
}

export class DecisionRunner {
  constructor(private readonly options: {
    repository: AgentRepository;
    observe: () => Promise<MarketSnapshot>;
    logger: LoggerLike;
  }) {}

  async run(): Promise<{ decided: number; failed: number; actions: Record<string, number> }> {
    const snapshot = await this.options.observe();
    const agents = (await this.options.repository.list()).filter((agent) => agent.configured);
    const actions: Record<string, number> = {};
    let decided = 0;
    let failed = 0;
    for (const agent of agents) {
      try {
        const receipt = await this.options.repository.applyEvolution(agent.id, {
          eventId: `market:${snapshot.observedAt}:${agent.id}`,
          type: "market_observation",
          sequence: agent.revision + 1,
          occurredAt: snapshot.observedAt,
          source: "horizon_mainnet",
          context: snapshot.context,
        });
        decided += 1;
        actions[receipt.actionTendency] = (actions[receipt.actionTendency] ?? 0) + 1;
      } catch (error) {
        failed += 1;
        this.options.logger.error({ event: "agent_decision_failed", agentId: agent.id, error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    this.options.logger.info({
      event: "decision_cycle_completed",
      observedAt: snapshot.observedAt,
      configured: agents.length,
      decided,
      failed,
      actions,
      market: {
        bestBidXlm: snapshot.context.bestBidXlm,
        bestAskXlm: snapshot.context.bestAskXlm,
        askDepthRylo: snapshot.context.askDepthRylo,
        bidDepthRylo: snapshot.context.bidDepthRylo,
      },
    });
    return { decided, failed, actions };
  }
}
