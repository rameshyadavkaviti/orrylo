import { Keypair } from "@stellar/stellar-sdk";

export type WalletIssueCode =
  | "MALFORMED_VARIABLE"
  | "MISSING_PUBLIC_KEY"
  | "MISSING_SECRET_KEY"
  | "MALFORMED_KEYPAIR"
  | "KEYPAIR_MISMATCH"
  | "DUPLICATE_PUBLIC_KEY";

export interface WalletIssue {
  alias?: string;
  code: WalletIssueCode;
}

export interface VerifiedWallet {
  alias: string;
  publicKey: string;
}

export type WalletVerification =
  | { ok: true; wallet: VerifiedWallet }
  | { ok: false; issue: WalletIssue };

export interface WalletDiscovery {
  wallets: VerifiedWallet[];
  issues: WalletIssue[];
}

type Env = Record<string, string | undefined>;

export function verifyWalletCandidate(alias: string, publicKey: string, secretKey: string): WalletVerification {
  try {
    const fromSecret = Keypair.fromSecret(secretKey);
    Keypair.fromPublicKey(publicKey);
    if (fromSecret.publicKey() !== publicKey) {
      return { ok: false, issue: { alias, code: "KEYPAIR_MISMATCH" } };
    }
    return { ok: true, wallet: { alias, publicKey } };
  } catch {
    return { ok: false, issue: { alias, code: "MALFORMED_KEYPAIR" } };
  }
}

export function discoverWallets(env: Env, prefix = "ORRYLO_AGENT_"): WalletDiscovery {
  const grouped = new Map<string, { publicKey?: string; secretKey?: string }>();
  const issues: WalletIssue[] = [];

  for (const [name, value] of Object.entries(env)) {
    if (name === "ORRYLO_AGENT_ENV_PREFIX") continue;
    if (!name.startsWith(prefix)) continue;
    const remainder = name.slice(prefix.length);
    const match = /^(.+)_(PUBLIC_KEY|SECRET_KEY)$/.exec(remainder);
    if (!match || !/^[A-Z0-9_]+$/.test(match[1] ?? "")) {
      issues.push({ code: "MALFORMED_VARIABLE" });
      continue;
    }
    const alias = match[1]!;
    const entry = grouped.get(alias) ?? {};
    if (match[2] === "PUBLIC_KEY") entry.publicKey = value;
    else entry.secretKey = value;
    grouped.set(alias, entry);
  }

  const candidates: VerifiedWallet[] = [];
  for (const [alias, entry] of grouped) {
    if (!entry.publicKey) {
      issues.push({ alias, code: "MISSING_PUBLIC_KEY" });
      continue;
    }
    if (!entry.secretKey) {
      issues.push({ alias, code: "MISSING_SECRET_KEY" });
      continue;
    }
    const verified = verifyWalletCandidate(alias, entry.publicKey, entry.secretKey);
    if (verified.ok) candidates.push(verified.wallet);
    else issues.push(verified.issue);
  }

  const aliasesByPublicKey = new Map<string, string[]>();
  for (const wallet of candidates) {
    const aliases = aliasesByPublicKey.get(wallet.publicKey) ?? [];
    aliases.push(wallet.alias);
    aliasesByPublicKey.set(wallet.publicKey, aliases);
  }

  const duplicated = new Set<string>();
  for (const [publicKey, aliases] of aliasesByPublicKey) {
    if (aliases.length < 2) continue;
    duplicated.add(publicKey);
    for (const alias of aliases) issues.push({ alias, code: "DUPLICATE_PUBLIC_KEY" });
  }

  return {
    wallets: candidates.filter((candidate) => !duplicated.has(candidate.publicKey)).sort((a, b) => a.alias.localeCompare(b.alias)),
    issues,
  };
}
