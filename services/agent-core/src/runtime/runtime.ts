import { Horizon } from "@stellar/stellar-sdk";

import type { AppConfig } from "../config.js";
import type { AgentRepository } from "../db/repository.js";
import { reconcileEnrollment } from "../enrollment/reconcile.js";
import { EnrollmentLoop } from "./evolution-loop.js";
import { DecisionRunner, HorizonMarketObserver } from "./decision-loop.js";
import { ClaimableBalanceRunner, HorizonClaimableBalanceObserver, signerForPublicKey, StellarClaimExecutor } from "./claimable-loop.js";
import { StellarTradeExecutor } from "./trade-execution.js";

interface ServerLike {
  listen(options?: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

interface LoggerLike {
  info(value: unknown): void;
  error(value: unknown): void;
}

export interface RuntimeHandle { stop(): Promise<void> }

export async function startRuntime(options: {
  config: AppConfig;
  repository: AgentRepository;
  env: Record<string, string | undefined>;
  server: ServerLike;
  logger: LoggerLike;
}): Promise<RuntimeHandle> {
  const { config, repository, env, server, logger } = options;
  await server.listen({ host: config.host, port: config.port });
  let migrated = false;
  const reconcile = async () => {
    if (!migrated) {
      await repository.migrate();
      migrated = true;
    }
    const result = await reconcileEnrollment(env, config, repository);
    logger.info({ event: "enrollment_reconciled", enrolled: result.enrolled, configured: result.configured, invalid: result.invalid });
  };
  const loop = new EnrollmentLoop(config.reconcileIntervalMs, reconcile, (error) => {
    logger.error({ event: "enrollment_reconcile_failed", error: error instanceof Error ? error.name : "UnknownError" });
  });
  await loop.tick().catch((error) => {
    logger.error({ event: "initialization_failed", error: error instanceof Error ? error.name : "UnknownError" });
  });
  loop.start();

  const marketObserver = new HorizonMarketObserver({
    horizonUrl: config.horizonUrl,
    ryloCode: config.ryloCode,
    ryloIssuer: config.ryloIssuer,
    referencePriceXlm: config.referencePriceXlm,
  });
  const horizon = new Horizon.Server(config.horizonUrl);
  const signer = (publicKey: string) => signerForPublicKey(env, config.agentEnvPrefix, publicKey);
  const tradeExecutor = new StellarTradeExecutor({
    server: horizon as never,
    ryloCode: config.ryloCode,
    ryloIssuer: config.ryloIssuer,
    maxTradeXlm: config.executionMaxTradeXlm,
    minOrderXlm: config.executionMinOrderXlm,
    dailyCapXlm: config.executionDailyCapXlm,
    minFreeXlm: config.executionMinFreeXlm,
    maxBuyPriceXlm: config.executionMaxBuyPriceXlm,
    maxOpenOffers: config.executionMaxOpenOffers,
  });
  const decisionRunner = new DecisionRunner({
    repository,
    observe: () => marketObserver.observe(),
    logger,
    inspectPortfolio: (publicKey) => tradeExecutor.inspect(publicKey),

    signerForPublicKey: signer,
    executeTrade: (intent, keypair) => tradeExecutor.execute(intent, keypair),
    executionEnabled: config.executionEnabled,
    referencePriceXlm: config.referencePriceXlm,
  });
  const claimObserver = new HorizonClaimableBalanceObserver({
    horizonUrl: config.horizonUrl,
    ryloCode: config.ryloCode,
    ryloIssuer: config.ryloIssuer,
  });
  const claimExecutor = new StellarClaimExecutor({
    server: horizon as never,
    ryloCode: config.ryloCode,
    ryloIssuer: config.ryloIssuer,
  });
  const claimRunner = new ClaimableBalanceRunner({
    repository,
    observe: (publicKeys) => claimObserver.observe(publicKeys),
    inspect: (publicKey) => claimExecutor.inspect(publicKey),
    signerForPublicKey: signer,
    execute: (gift, keypair) => claimExecutor.execute(gift, keypair),
    executionEnabled: config.claimExecutionEnabled,
    logger,
  });
  const runDecisionCycle = async () => {
    if (config.claimableObservationEnabled) await claimRunner.run();
    await decisionRunner.run();
  };
  const decisionLoop = new EnrollmentLoop(config.decisionIntervalMs, runDecisionCycle, (error) => {
    logger.error({ event: "decision_cycle_failed", error: error instanceof Error ? error.name : "UnknownError" });
  });
  if (config.decisionEnabled && !config.paused) {
    await decisionLoop.tick().catch((error) => {
      logger.error({ event: "initial_decision_failed", error: error instanceof Error ? error.name : "UnknownError" });
    });
    decisionLoop.start();
  }

  // Independent observer: maintenance sampling must not alter the cognitive
  // observer's temporal market-change signal.
  const maintenanceObserver = new HorizonMarketObserver({
    horizonUrl: config.horizonUrl,
    ryloCode: config.ryloCode,
    ryloIssuer: config.ryloIssuer,
    referencePriceXlm: config.referencePriceXlm,
  });
  let lastMaintenanceMid: number | null = null;
  let stableMarketSamples = 0;
  // Maintenance never forces a new trade. It only cancels aged, implausible
  // offers after independent, consistent market observations.
  let maintenanceCursor = 0;
  const maintenanceLoop = new EnrollmentLoop(30_000, async () => {
    const accounts = (await repository.list()).filter((agent) => agent.configured);
    if (accounts.length === 0) return;
    let market: { bestBidXlm: number; bestAskXlm: number } | undefined;
    try {
      const observed = (await maintenanceObserver.observe()).context;
      const bid = observed.bestBidXlm;
      const ask = observed.bestAskXlm;
      const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
      const reliable = mid !== null && bid !== null && ask !== null &&
        bid > 0 && ask > bid && (ask - bid) / mid <= 0.10 &&
        observed.askDepthRylo >= 5 && observed.bidDepthRylo >= 5;
      if (reliable && mid !== null && bid !== null && ask !== null) {
        stableMarketSamples = lastMaintenanceMid !== null &&
          Math.abs(mid / lastMaintenanceMid - 1) <= 0.03
          ? Math.min(stableMarketSamples + 1, 100) : 1;
        lastMaintenanceMid = mid;
        if (stableMarketSamples >= 3) market = { bestBidXlm: bid, bestAskXlm: ask };
      } else {
        stableMarketSamples = 0;
        lastMaintenanceMid = null;
      }
    } catch (error) {
      stableMarketSamples = 0;
      lastMaintenanceMid = null;
      logger.error({ event: "market_maintenance_observation_failed",
        error: error instanceof Error ? error.name : "UnknownError" });
    }
    const count = Math.min(4, accounts.length);
    const batch = Array.from({ length: count }, (_, i) => accounts[(maintenanceCursor + i) % accounts.length]!);
    maintenanceCursor = (maintenanceCursor + count) % accounts.length;
    await Promise.all(batch.map(async (agent) => {
      try {
        const keypair = signer(agent.publicKey);
        if (!keypair) {
          logger.error({ event: "offer_cleanup_signer_missing", agentId: agent.id });
          return;
        }
        const result = await tradeExecutor.maintain(agent.publicKey, keypair, Date.now(), market);
        if (result.status === "submitted") logger.info({ event: "offer_cleanup_submitted", agentId: agent.id, removed: result.removed });
        else if (result.status === "blocked") logger.error({ event: "offer_cleanup_blocked", agentId: agent.id, reason: result.reason });
      } catch (error) {
        logger.error({ event: "offer_cleanup_failed", agentId: agent.id, error: error instanceof Error ? error.name : "UnknownError" });
      }
    }));
  }, (error) => logger.error({ event: "offer_cleanup_cycle_failed", error: error instanceof Error ? error.name : "UnknownError" }));
  if (config.executionEnabled && !config.paused) {
    maintenanceLoop.start();
    void maintenanceLoop.tick().catch((error) =>
      logger.error({ event: "offer_cleanup_initial_failed", error: error instanceof Error ? error.name : "UnknownError" }));
  }

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      loop.stop();
      decisionLoop.stop();
      maintenanceLoop.stop();
      await server.close();
      await repository.close();
    },
  };
}
