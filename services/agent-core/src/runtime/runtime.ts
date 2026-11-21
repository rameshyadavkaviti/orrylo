import type { AppConfig } from "../config.js";
import type { AgentRepository } from "../db/repository.js";
import { reconcileEnrollment } from "../enrollment/reconcile.js";
import { EnrollmentLoop } from "./evolution-loop.js";
import { DecisionRunner, HorizonMarketObserver } from "./decision-loop.js";

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
  const decisionRunner = new DecisionRunner({ repository, observe: () => marketObserver.observe(), logger });
  const decisionLoop = new EnrollmentLoop(config.decisionIntervalMs, () => decisionRunner.run().then(() => undefined), (error) => {
    logger.error({ event: "decision_cycle_failed", error: error instanceof Error ? error.name : "UnknownError" });
  });
  if (config.decisionEnabled && !config.paused) {
    await decisionLoop.tick().catch((error) => {
      logger.error({ event: "initial_decision_failed", error: error instanceof Error ? error.name : "UnknownError" });
    });
    decisionLoop.start();
  }

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      loop.stop();
      decisionLoop.stop();
      await server.close();
      await repository.close();
    },
  };
}
