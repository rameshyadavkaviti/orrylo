import { createDatabaseClient } from "../lib/server/persistence/database";
import {
  verifyTestnetActivationDatabaseBoundaries,
  verifyTestnetActivationReadiness,
} from "../lib/server/projects/testnet-activation-verifier";
import { OFFICIAL_STELLAR_TESTNET_HORIZON_URL } from "../lib/stellar/official-testnet-horizon";
import { OfficialStellarTestnetIssuancePreflightReader } from "../lib/stellar/shared-issuer-testnet-preflight";

interface Args {
  destinationPublicKey: string;
  assetCode: string;
  amount: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(usage());
    }
    values.set(flag, value);
  }

  const destinationPublicKey = values.get("--destination");
  const assetCode = values.get("--asset-code");
  const amount = values.get("--amount");
  if (!destinationPublicKey || !assetCode || !amount || values.size !== 3) {
    throw new Error(usage());
  }
  return { destinationPublicKey, assetCode, amount };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run activation:verify:testnet -- --destination G... --asset-code CODE --amount 100.0000000",
    "",
    "Required server-only environment:",
    "  ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
    "  ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS",
    "  DATABASE_URL",
    "  ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
    "",
    "This command is read-only. It never signs, submits, funds, configures, or creates a trustline.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const issuerPublicKey = requiredEnv(
    "ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
  );
  const feeStroops = requiredEnv("ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS");
  const applicationDatabaseUrl = requiredEnv("DATABASE_URL");
  const confirmationWriterDatabaseUrl = requiredEnv(
    "ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
  );

  const configuredNetwork =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim() || "testnet";
  if (configuredNetwork !== "testnet") {
    throw new Error(
      "NEXT_PUBLIC_STELLAR_NETWORK must be testnet for activation.",
    );
  }

  const configuredHorizon = process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL?.trim();
  if (
    configuredHorizon &&
    configuredHorizon !== OFFICIAL_STELLAR_TESTNET_HORIZON_URL
  ) {
    throw new Error(
      "NEXT_PUBLIC_STELLAR_HORIZON_URL must match the official Stellar Testnet Horizon endpoint.",
    );
  }

  const applicationDatabase = createDatabaseClient(applicationDatabaseUrl);
  const confirmationWriterDatabase = createDatabaseClient(
    confirmationWriterDatabaseUrl,
  );

  try {
    const preflight = new OfficialStellarTestnetIssuancePreflightReader();
    const report = await verifyTestnetActivationReadiness(
      {
        issuerPublicKey,
        destinationPublicKey: args.destinationPublicKey,
        assetCode: args.assetCode,
        amount: args.amount,
        feeStroops,
      },
      {
        readPreflight: (input) => preflight.readIssuancePreconditions(input),
        verifyDatabaseBoundaries: () =>
          verifyTestnetActivationDatabaseBoundaries(
            applicationDatabase,
            confirmationWriterDatabase,
          ),
      },
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          verifier: "orrylo-testnet-mvp-read-only-v1",
          ...report,
          signer: {
            checked: false,
            reason:
              "Signer custody/deployment remains owner-gated and this verifier never requests a signature.",
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await Promise.all([
      applicationDatabase.end({ timeout: 5 }),
      confirmationWriterDatabase.end({ timeout: 5 }),
    ]);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      verifier: "orrylo-testnet-mvp-read-only-v1",
      error: message,
    })}\n`,
  );
  process.exitCode = 1;
});
