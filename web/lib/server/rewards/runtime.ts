import { getDatabaseClient } from "../persistence/database";
import { EligibilityRewardService } from "./service";

export function getEligibilityRewardService(
  env: NodeJS.ProcessEnv = process.env,
): EligibilityRewardService {
  return new EligibilityRewardService(getDatabaseClient(env), {
    officialLaunchAt: env.ORRYLO_OFFICIAL_LAUNCH_AT,
  });
}
