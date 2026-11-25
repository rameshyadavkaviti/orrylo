import { Keypair } from "@stellar/stellar-sdk";

export interface AppConfig {
  databaseUrl: string;
  identityMasterKey: string;
  identityKeyVersion: number;
  internalApiKey: string;
  internalApiKeyPrevious?: string;
  agentEnvPrefix: string;
  executionEnabled: boolean;
  executionMaxTradeXlm: number;
  executionDailyCapXlm: number;
  executionMinFreeXlm: number;
  executionMaxBuyPriceXlm: number;
  executionMaxOpenOffers: number;
  relatedPublicKeys: readonly string[];
  claimableObservationEnabled: boolean;
  claimExecutionEnabled: boolean;
  paused: boolean;
  port: number;
  host: string;
  reconcileIntervalMs: number;
  decisionEnabled: boolean;
  decisionIntervalMs: number;
  horizonUrl: string;
  ryloCode: string;
  ryloIssuer: string;
  referencePriceXlm: number;
}

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }

  toJSON(): { name: string; code: string; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError("CONFIG_REQUIRED", `Required variable ${name} is missing`);
  return value;
}

function boolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigError("CONFIG_INVALID", `${name} must be true or false`);
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError("CONFIG_INVALID", `${name} must be an integer in range ${min}..${max}`);
  }
  return value;
}

function positiveNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError("CONFIG_INVALID", `${name} must be a positive number`);
  }
  return value;
}

function requiredPositiveNumber(env: Env, name: string): number {
  const raw = required(env, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ConfigError("CONFIG_INVALID", `${name} must be a positive number`);
  return value;
}

function publicKeys(env: Env, name: string, requiredWhenEnabled: boolean): readonly string[] {
  const raw = env[name];
  if (!raw) {
    if (requiredWhenEnabled) throw new ConfigError("CONFIG_REQUIRED", `Required variable ${name} is missing`);
    return [];
  }
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0) throw new ConfigError("CONFIG_INVALID", `${name} must contain at least one Stellar public key`);
  for (const value of values) stellarPublicKey({ [name]: value }, name, value);
  return values;
}

function stellarPublicKey(env: Env, name: string, fallback: string): string {
  const value = env[name] ?? fallback;
  try {
    Keypair.fromPublicKey(value);
    return value;
  } catch {
    throw new ConfigError("CONFIG_INVALID", `${name} must be a Stellar public key`);
  }
}

function url(env: Env, name: string, fallback: string): string {
  const raw = env[name] ?? fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") throw new Error("https required");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new ConfigError("CONFIG_INVALID", `${name} must be a valid HTTPS URL`);
  }
}

function key(env: Env, name: string, minimumLength: number, optional = false): string | undefined {
  const value = env[name];
  if (!value && optional) return undefined;
  if (!value) throw new ConfigError("CONFIG_REQUIRED", `Required variable ${name} is missing`);
  if (value.length < minimumLength) {
    throw new ConfigError("CONFIG_INVALID", `${name} must contain at least ${minimumLength} characters`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const executionEnabled = boolean(env, "ORRYLO_EXECUTION_ENABLED", false);
  const claimableObservationEnabled = boolean(env, "ORRYLO_CLAIMABLE_OBSERVATION_ENABLED", false);
  const claimExecutionEnabled = boolean(env, "ORRYLO_CLAIM_EXECUTION_ENABLED", false);
  if (claimExecutionEnabled && !claimableObservationEnabled) {
    throw new ConfigError("CONFIG_INVALID", "Claim execution requires claimable-balance observation");
  }
  const executionMaxTradeXlm = executionEnabled ? requiredPositiveNumber(env, "ORRYLO_EXECUTION_MAX_TRADE_XLM") : positiveNumber(env, "ORRYLO_EXECUTION_MAX_TRADE_XLM", 0.1);
  const executionDailyCapXlm = executionEnabled ? requiredPositiveNumber(env, "ORRYLO_EXECUTION_DAILY_CAP_XLM") : positiveNumber(env, "ORRYLO_EXECUTION_DAILY_CAP_XLM", 0.5);
  const executionMinFreeXlm = executionEnabled ? requiredPositiveNumber(env, "ORRYLO_EXECUTION_MIN_FREE_XLM") : positiveNumber(env, "ORRYLO_EXECUTION_MIN_FREE_XLM", 2);
  const executionMaxBuyPriceXlm = executionEnabled ? requiredPositiveNumber(env, "ORRYLO_EXECUTION_MAX_BUY_PRICE_XLM") : positiveNumber(env, "ORRYLO_EXECUTION_MAX_BUY_PRICE_XLM", 0.1);
  if (executionDailyCapXlm < executionMaxTradeXlm) throw new ConfigError("CONFIG_INVALID", "Daily cap must be at least the per-trade cap");

  return {
    databaseUrl: required(env, "DATABASE_URL"),
    identityMasterKey: key(env, "ORRYLO_IDENTITY_MASTER_KEY", 32)!,
    identityKeyVersion: integer(env, "ORRYLO_IDENTITY_KEY_VERSION", 1, 1, 2_147_483_647),
    internalApiKey: key(env, "ORRYLO_INTERNAL_API_KEY", 32)!,
    internalApiKeyPrevious: key(env, "ORRYLO_INTERNAL_API_KEY_PREVIOUS", 32, true),
    agentEnvPrefix: env.ORRYLO_AGENT_ENV_PREFIX ?? "ORRYLO_AGENT_",
    executionEnabled,
    executionMaxTradeXlm,
    executionDailyCapXlm,
    executionMinFreeXlm,
    executionMaxBuyPriceXlm,
    executionMaxOpenOffers: integer(env, "ORRYLO_EXECUTION_MAX_OPEN_OFFERS", 8, 1, 20),
    relatedPublicKeys: publicKeys(env, "ORRYLO_RELATED_PUBLIC_KEYS", executionEnabled),
    claimableObservationEnabled,
    claimExecutionEnabled,
    paused: boolean(env, "ORRYLO_PAUSED", false),
    port: integer(env, "PORT", 3000, 1, 65_535),
    host: env.HOST ?? "0.0.0.0",
    reconcileIntervalMs: integer(env, "ORRYLO_RECONCILE_INTERVAL_MS", 30_000, 1_000, 86_400_000),
    decisionEnabled: boolean(env, "ORRYLO_DECISION_ENABLED", false),
    decisionIntervalMs: integer(env, "ORRYLO_DECISION_INTERVAL_MS", 300_000, 10_000, 86_400_000),
    horizonUrl: url(env, "ORRYLO_HORIZON_URL", "https://horizon.stellar.org"),
    ryloCode: env.ORRYLO_RYLO_CODE ?? "RYLO",
    ryloIssuer: stellarPublicKey(
      env,
      "ORRYLO_RYLO_ISSUER",
      "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO",
    ),
    referencePriceXlm: positiveNumber(env, "ORRYLO_REFERENCE_PRICE_XLM", 0.1),
  };
}
