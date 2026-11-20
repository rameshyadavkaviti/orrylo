import type { AppConfig } from "../config.js";
import type { AgentRepository } from "../db/repository.js";
import { createInitialState } from "../evolution/evolve.js";
import { deriveCognitiveSeed } from "../identity/derive-seed.js";
import { discoverWallets } from "./wallet-env.js";

export interface ReconciliationResult {
  enrolled: number;
  configured: number;
  invalid: number;
  issueCodes: string[];
}

export async function reconcileEnrollment(
  env: Record<string, string | undefined>,
  config: AppConfig,
  repository: AgentRepository,
): Promise<ReconciliationResult> {
  const discovery = discoverWallets(env, config.agentEnvPrefix);
  const issueCodes: string[] = discovery.issues.map((issue) => issue.code);
  let enrolled = 0;
  const activePublicKeys: string[] = [];

  for (const wallet of discovery.wallets) {
    try {
      const existing = await repository.get(wallet.publicKey);
      const seed = deriveCognitiveSeed(config.identityMasterKey, wallet.publicKey, config.identityKeyVersion);
      await repository.enroll({
        alias: wallet.alias,
        publicKey: wallet.publicKey,
        seed,
        state: createInitialState(seed),
      });
      activePublicKeys.push(wallet.publicKey);
      if (!existing) enrolled += 1;
    } catch (error) {
      issueCodes.push(error instanceof Error && "code" in error ? String(error.code) : "ENROLLMENT_FAILED");
    }
  }

  await repository.reconcileConfiguration(activePublicKeys);
  await repository.setEnrollmentStatus(issueCodes);
  return {
    enrolled,
    configured: activePublicKeys.length,
    invalid: issueCodes.length,
    issueCodes,
  };
}
