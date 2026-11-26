import { loadConfig } from "./config.js";
import { PostgresAgentRepository } from "./db/repository.js";
import { buildServer } from "./http/server.js";
import { startRuntime } from "./runtime/runtime.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const repository = PostgresAgentRepository.connect(config.databaseUrl);
  const server = buildServer({ config, repository });
  // Run the cancellation request before any (possibly slow) repository
  // initialization. Only paused services qualify; cancellation itself has the
  // same independent fail-closed environment checks.
  console.log(JSON.stringify({ event: "emergency_cancel_startup_check",
    paused: config.paused, executionEnabled: config.executionEnabled,
    decisionEnabled: config.decisionEnabled, claimEnabled: config.claimExecutionEnabled }));
  if (config.paused && !config.executionEnabled && !config.decisionEnabled && !config.claimExecutionEnabled) {
    console.log(JSON.stringify({ event: "emergency_cancel_import_requested" }));
    void import("./emergency/cancel-all-agent-offers.js").catch((error: unknown) => {
      console.error(JSON.stringify({ event: "emergency_cancel_import_failed",
        error: error instanceof Error ? error.name : "UnknownError" }));
    });
  }

  const runtime = await startRuntime({ config, repository, env: process.env, server, logger: console });
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
