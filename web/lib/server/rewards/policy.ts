export const FIRST_TOKEN_ELIGIBILITY_TYPE = "FIRST_SUCCESSFUL_TOKEN_CREATION";
export const FIRST_TOKEN_REWARD_TYPE = "FIRST_TOKEN_CREATION_REWARD";
export const FIRST_TOKEN_REWARD_AMOUNT = "150.0000000";
export const TOKEN_CREATION_SUCCEEDED_EVENT = "TOKEN_CREATION_SUCCEEDED";

export const REWARD_WINDOW_DAYS = 60;
export const REWARD_WINDOW_MS = REWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const REWARD_WINDOW_INTERVAL = "[launch_at, window_end)";

export class OfficialLaunchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialLaunchConfigurationError";
  }
}

export type OfficialLaunchConfig =
  | { configured: false }
  | { configured: true; launchAt: number; windowEnd: number };

export function parseOfficialLaunchAt(
  raw: string | undefined,
): OfficialLaunchConfig {
  const value = raw?.trim();

  if (!value) {
    return { configured: false };
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(
      value,
    );

  if (!match) {
    throw new OfficialLaunchConfigurationError(
      "ORRYLO_OFFICIAL_LAUNCH_AT must be a strict UTC ISO-8601 timestamp ending in Z.",
    );
  }

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, msRaw] =
    match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const millisecond = Number((msRaw ?? "").padEnd(3, "0") || "0");
  const launchAt = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const date = new Date(launchAt);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    throw new OfficialLaunchConfigurationError(
      "ORRYLO_OFFICIAL_LAUNCH_AT is not a valid calendar timestamp.",
    );
  }

  return {
    configured: true,
    launchAt,
    windowEnd: launchAt + REWARD_WINDOW_MS,
  };
}

export type RewardWindowEvaluation =
  "before_launch" | "inside_window" | "after_window";

export function evaluateRewardWindow(
  now: number,
  config: Extract<OfficialLaunchConfig, { configured: true }>,
): RewardWindowEvaluation {
  if (now < config.launchAt) {
    return "before_launch";
  }

  if (now >= config.windowEnd) {
    return "after_window";
  }

  return "inside_window";
}
