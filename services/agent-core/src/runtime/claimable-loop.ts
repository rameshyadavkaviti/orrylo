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

import type { AgentRepository } from "../db/repository.js";

export interface ClaimableRyloGift {
  balanceId: string;
  destination: string;
  amountRylo: number;
}

interface ClaimableRecord {
  id?: unknown;
  asset?: unknown;
  amount?: unknown;
  claimants?: unknown;
}

interface ClaimablePage {
  _embedded?: { records?: ClaimableRecord[] };
  _links?: { next?: { href?: string } };
}

interface LoggerLike {
  info(value: unknown): void;
  error(value: unknown): void;
}

type LoadedAccount = Account & {
  balances: Array<Record<string, unknown>>;
};
type BuiltTransaction = ReturnType<TransactionBuilder["build"]>;

interface HorizonLike {
  loadAccount(publicKey: string): Promise<LoadedAccount>;
  fetchBaseFee(): Promise<number>;
  submitTransaction(transaction: BuiltTransaction): Promise<{ hash: string }>;
}

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.min(maximum, Math.max(minimum, value));

function safeStellarError(error: unknown): Record<string, unknown> {
  const candidate = error as {
    name?: unknown;
    response?: {
      status?: unknown;
      data?: { extras?: { result_codes?: { transaction?: unknown; operations?: unknown } } };
    };
  };
  const codes = candidate?.response?.data?.extras?.result_codes;
  const operations = Array.isArray(codes?.operations)
    ? codes.operations.filter((value): value is string => typeof value === "string").slice(0, 4)
    : undefined;
  return {
    error: typeof candidate?.name === "string" ? candidate.name : "UnknownError",
    ...(typeof candidate?.response?.status === "number" ? { horizonStatus: candidate.response.status } : {}),
    ...(typeof codes?.transaction === "string" ? { transactionCode: codes.transaction } : {}),
    ...(operations && operations.length > 0 ? { operationCodes: operations } : {}),
  };
}

export class HorizonClaimableBalanceObserver {
  constructor(private readonly options: {
    horizonUrl: string;
    ryloCode: string;
    ryloIssuer: string;
    fetcher?: typeof fetch;
  }) {}

  async observe(configuredPublicKeys: ReadonlySet<string>): Promise<ClaimableRyloGift[]> {
    const asset = `${this.options.ryloCode}:${this.options.ryloIssuer}`;
    let next = new URL("/claimable_balances", this.options.horizonUrl);
    next.searchParams.set("asset", asset);
    next.searchParams.set("limit", "200");
    next.searchParams.set("order", "asc");
    const gifts: ClaimableRyloGift[] = [];
    const visited = new Set<string>();
    for (let page = 0; page < 10 && next && !visited.has(next.toString()); page += 1) {
      visited.add(next.toString());
      const response = await (this.options.fetcher ?? fetch)(next, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HorizonClaimableBalancesError:${response.status}`);
      const body = await response.json() as ClaimablePage;
      for (const record of body._embedded?.records ?? []) {
        if (record.asset !== asset || typeof record.id !== "string" || typeof record.amount !== "string") continue;
        const amountRylo = Number(record.amount);
        if (!Number.isFinite(amountRylo) || amountRylo <= 0 || !Array.isArray(record.claimants) || record.claimants.length !== 1) continue;
        const claimant = record.claimants[0] as { destination?: unknown; predicate?: { unconditional?: unknown } };
        if (typeof claimant.destination !== "string" || claimant.predicate?.unconditional !== true) continue;
        if (!configuredPublicKeys.has(claimant.destination)) continue;
        gifts.push({ balanceId: record.id, destination: claimant.destination, amountRylo });
      }
      const href = body._links?.next?.href;
      if (!href) break;
      const candidate = new URL(href, this.options.horizonUrl);
      if (candidate.origin !== new URL(this.options.horizonUrl).origin) break;
      next = candidate;
    }
    return gifts;
  }
}

export class StellarClaimExecutor {
  private readonly asset: Asset;

  constructor(private readonly options: {
    ryloCode: string;
    ryloIssuer: string;
    server?: HorizonLike;
  }) {
    this.asset = new Asset(options.ryloCode, options.ryloIssuer);
  }

  private server(): HorizonLike {
    return this.options.server ?? new Horizon.Server("https://horizon.stellar.org") as unknown as HorizonLike;
  }

  async inspect(publicKey: string): Promise<{ hasRyloTrustline: boolean; nativeBalanceXlm: number }> {
    const account = await this.server().loadAccount(publicKey);
    const native = account.balances.find((balance) => balance.asset_type === "native");
    const trustline = account.balances.some((balance) =>
      balance.asset_code === this.options.ryloCode && balance.asset_issuer === this.options.ryloIssuer);
    return { hasRyloTrustline: trustline, nativeBalanceXlm: Number(native?.balance ?? 0) };
  }

  async execute(gift: ClaimableRyloGift, signer: Keypair): Promise<{ hash: string; trustlineCreated: boolean }> {
    if (signer.publicKey() !== gift.destination) throw new Error("CLAIM_SIGNER_MISMATCH");
    const server = this.server();
    const account = await server.loadAccount(gift.destination);
    const hasTrustline = account.balances.some((balance) =>
      balance.asset_code === this.options.ryloCode && balance.asset_issuer === this.options.ryloIssuer);
    const fee = String(Math.max(Number(BASE_FEE), await server.fetchBaseFee()));
    const builder = new TransactionBuilder(account, { fee, networkPassphrase: Networks.PUBLIC });
    if (!hasTrustline) builder.addOperation(Operation.changeTrust({ asset: this.asset }));
    const transaction = builder
      .addOperation(Operation.claimClaimableBalance({ balanceId: gift.balanceId }))
      .setTimeout(60)
      .build();
    transaction.sign(signer);
    const submitted = await server.submitTransaction(transaction);
    return { hash: submitted.hash, trustlineCreated: !hasTrustline };
  }
}

export function signerForPublicKey(
  env: Record<string, string | undefined>,
  prefix: string,
  publicKey: string,
): Keypair | undefined {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(prefix) || !name.endsWith("_SECRET_KEY") || !value) continue;
    try {
      const signer = Keypair.fromSecret(value);
      if (signer.publicKey() === publicKey) return signer;
    } catch {
      continue;
    }
  }
  return undefined;
}

export class ClaimableBalanceRunner {
  constructor(private readonly options: {
    repository: AgentRepository;
    observe(publicKeys: ReadonlySet<string>): Promise<ClaimableRyloGift[]>;
    inspect(publicKey: string): Promise<{ hasRyloTrustline: boolean; nativeBalanceXlm: number }>;
    signerForPublicKey(publicKey: string): Keypair | undefined;
    execute(gift: ClaimableRyloGift, signer: Keypair): Promise<{ hash: string; trustlineCreated: boolean }>;
    executionEnabled: boolean;
    logger: LoggerLike;
  }) {}

  async run(): Promise<{ observed: number; evaluated: number; claimed: number; deferred: number; declined: number; failed: number }> {
    const agents = (await this.options.repository.list()).filter((agent) => agent.configured);
    const byPublicKey = new Map(agents.map((agent) => [agent.publicKey, agent]));
    const gifts = await this.options.observe(new Set(byPublicKey.keys()));
    const totals = { observed: gifts.length, evaluated: 0, claimed: 0, deferred: 0, declined: 0, failed: 0 };
    for (const gift of gifts) {
      const agent = byPublicKey.get(gift.destination);
      if (!agent) continue;
      try {
        const account = await this.options.inspect(agent.publicKey);
        const latest = await this.options.repository.get(agent.id);
        if (!latest) throw new Error("AGENT_NOT_FOUND");
        const occurredAt = new Date().toISOString();
        const context = {
          contextTag: "rylo_claimable_gift",
          giftAmountRylo: gift.amountRylo,
          giftUnconditional: 1,
          hasRyloTrustline: account.hasRyloTrustline ? 1 : 0,
          feeBurden: clamp(0.00002 / Math.max(0.00002, account.nativeBalanceXlm)),
          uncertainty: 0.05,
          stakes: clamp(gift.amountRylo * 0.1 / Math.max(1, account.nativeBalanceXlm)),
          goalConflict: 0.05,
          accountability: 1,
          timePressure: 0,
          socialReliability: 0.7,
          valence: 1,
        };
        const receipt = await this.options.repository.applyEvolution(agent.id, {
          eventId: `claimable:${gift.balanceId}:${Date.now().toString(36)}`,
          type: "claimable_balance_observation",
          sequence: latest.revision + 1,
          occurredAt,
          source: "horizon_mainnet",
          context,
        });
        totals.evaluated += 1;
        if (receipt.actionTendency === "decline") { totals.declined += 1; continue; }
        if (receipt.actionTendency !== "claim" || !this.options.executionEnabled) { totals.deferred += 1; continue; }
        const signer = this.options.signerForPublicKey(agent.publicKey);
        if (!signer) throw new Error("CLAIM_SIGNER_NOT_FOUND");
        const submitted = await this.options.execute(gift, signer);
        totals.claimed += 1;
        await this.options.repository.recordExecution(agent.id, {
          transactionHash: submitted.hash,
          kind: "claim",
          action: "claim",
          amountRylo: gift.amountRylo,
          maxXlm: 0,
          createdAt: new Date().toISOString(),
        });
        const afterDecision = await this.options.repository.get(agent.id);
        if (!afterDecision) throw new Error("AGENT_NOT_FOUND");
        await this.options.repository.applyEvolution(agent.id, {
          eventId: `claim-result:${submitted.hash}`,
          type: "decision_outcome",
          sequence: afterDecision.revision + 1,
          occurredAt: new Date().toISOString(),
          source: "stellar_mainnet",
          context: { ...context, transactionHash: submitted.hash },
          outcome: { reward: 1, action: "claim" },
        });
      } catch (error) {
        totals.failed += 1;
        this.options.logger.error({ event: "claimable_agent_failed", ...safeStellarError(error) });
      }
    }
    this.options.logger.info({ event: "claimable_cycle_completed", ...totals });
    return totals;
  }
}
