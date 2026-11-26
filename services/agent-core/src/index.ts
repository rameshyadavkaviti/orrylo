import { loadConfig } from "./config.js";
import { PostgresAgentRepository } from "./db/repository.js";
import { buildServer } from "./http/server.js";
import { startRuntime } from "./runtime/runtime.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const repository = PostgresAgentRepository.connect(config.databaseUrl);
  const server = buildServer({ config, repository });
  const runtime = await startRuntime({ config, repository, env: process.env, server, logger: console });
  // Emergency cancellation runs only with an explicit environment flag AND a
  // fully paused agent-core. The HTTP healthcheck remains responsive.
  if (process.env.ORRYLO_EMERGENCY_CANCEL_ALL_OFFERS === "true") {
    if (!config.paused || config.executionEnabled || config.decisionEnabled || config.claimExecutionEnabled) {
      throw new Error("EMERGENCY_CANCEL_REQUIRES_COMPLETE_AGENT_PAUSE");
    }
    void import("./emergency/cancel-all-agent-offers.js").catch((error: unknown) => {
      console.error(JSON.stringify({ event: "emergency_cancel_import_failed",
        error: error instanceof Error ? error.name : "UnknownError" }));
    });
  }

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "startup_failed", error: error instanceof Error ? error.name : "UnknownError" }));
  process.exit(1);
});
