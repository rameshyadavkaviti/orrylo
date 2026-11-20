import type { AppConfig } from "../config.js";
import type { AgentRepository } from "../db/repository.js";
import { reconcileEnrollment } from "../enrollment/reconcile.js";
import { EnrollmentLoop } from "./evolution-loop.js";

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

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      loop.stop();
      await server.close();
      await repository.close();
    },
  };
}
