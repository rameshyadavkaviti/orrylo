import { readFile, writeFile } from "node:fs/promises";

import { createDatabaseClient } from "../lib/server/persistence/database";
import { createServerSharedIssuanceOrchestrator } from "../lib/server/projects/shared-issuance-runtime";
import type { SharedIssuerSigningPrimitive } from "../lib/stellar/shared-issuer-signing-policy";

const APPROVED_MANUAL_TESTNET_SHARED_ISSUER =
  "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";

type Command = "prepare" | "submit" | "reconcile";

interface CommonArgs {
  command: Command;
  requestId: string;
  projectId: string;
  ownerPublicKey: string;
}

interface PrepareArgs extends CommonArgs {
  command: "prepare";
  unsignedXdrFile: string;
}

interface SubmitArgs extends CommonArgs {
  command: "submit";
  signedXdrFile: string;
}

interface ReconcileArgs extends CommonArgs {
  command: "reconcile";
}

type Args = PrepareArgs | SubmitArgs | ReconcileArgs;

const manualOnlyPrimitive: SharedIssuerSigningPrimitive = {
  async signCanonicalEnvelope() {
    throw new Error(
      "manual_operator_runtime_must_never_invoke_a_signing_primitive",
    );
  },
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const [commandValue, ...rest] = argv;
  if (
    commandValue !== "prepare" &&
    commandValue !== "submit" &&
    commandValue !== "reconcile"
  ) {
    throw new Error(usage());
  }

  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(usage());
    values.set(flag, value);
  }

  const requestId = values.get("--request-id");
  const projectId = values.get("--project-id");
  const ownerPublicKey = values.get("--owner");
  if (!requestId || !projectId || !ownerPublicKey) throw new Error(usage());

  if (commandValue === "prepare") {
    const unsignedXdrFile = values.get("--unsigned-xdr-file");
    if (!unsignedXdrFile || values.size !== 4) throw new Error(usage());
    return {
      command: commandValue,
      requestId,
      projectId,
      ownerPublicKey,
      unsignedXdrFile,
    };
  }

  if (commandValue === "submit") {
    const signedXdrFile = values.get("--signed-xdr-file");
    if (!signedXdrFile || values.size !== 4) throw new Error(usage());
    return {
      command: commandValue,
      requestId,
      projectId,
      ownerPublicKey,
      signedXdrFile,
    };
  }

  if (values.size !== 3) throw new Error(usage());
  return { command: commandValue, requestId, projectId, ownerPublicKey };
}

function usage(): string {
  return [
    "Usage:",
    "  npm run issuance:manual:testnet -- prepare --request-id UUID --project-id UUID --owner G... --unsigned-xdr-file ./attempt-1-unsigned.xdr",
    "  npm run issuance:manual:testnet -- submit --request-id UUID --project-id UUID --owner G... --signed-xdr-file ./attempt-1-signed.xdr",
    "  npm run issuance:manual:testnet -- reconcile --request-id UUID --project-id UUID --owner G...",
    "",
    "Required server-only environment:",
    "  NEXT_PUBLIC_STELLAR_NETWORK=testnet",
    "  ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
    "  ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS",
    "  DATABASE_URL",
    "  ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
    "",
    "No signer URL, signer auth secret, or Stellar secret key is accepted.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim() !== "testnet") {
    throw new Error("NEXT_PUBLIC_STELLAR_NETWORK must be testnet.");
  }

  const issuerPublicKey = requiredEnv(
    "ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY",
  );
  if (issuerPublicKey !== APPROVED_MANUAL_TESTNET_SHARED_ISSUER) {
    throw new Error(
      "ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY must match the approved live Testnet Shared Issuer.",
    );
  }
  const feeStroops = requiredEnv("ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS");
  const applicationDatabase = createDatabaseClient(requiredEnv("DATABASE_URL"));
  const confirmationWriterDatabaseUrl = requiredEnv(
    "ORRYLO_CONFIRMATION_WRITER_DATABASE_URL",
  );
  const confirmationWriterDatabase = createDatabaseClient(
    confirmationWriterDatabaseUrl,
  );

  try {
    const orchestrator = await createServerSharedIssuanceOrchestrator({
      primitive: manualOnlyPrimitive,
      issuerPublicKey,
      feeStroops,
      confirmationWriterDatabaseUrl,
      applicationDatabase,
      confirmationWriterDatabase,
    });

    const common = {
      requestId: args.requestId,
      projectId: args.projectId,
      ownerPublicKey: args.ownerPublicKey,
    };

    if (args.command === "prepare") {
      const handoff = await orchestrator.prepareManualSigningHandoff(common);
      await writeFile(
        args.unsignedXdrFile,
        `${handoff.unsignedEnvelopeXdr}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      const { unsignedEnvelopeXdr: _omitted, ...publicHandoff } = handoff;
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "awaiting_manual_signature",
            unsignedXdrFile: args.unsignedXdrFile,
            ...publicHandoff,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    if (args.command === "submit") {
      const signedEnvelopeXdr = (
        await readFile(args.signedXdrFile, "utf8")
      ).trim();
      if (!signedEnvelopeXdr) throw new Error("Signed XDR file is empty.");
      const execution = await orchestrator.submitManualSignedEnvelope({
        ...common,
        signedEnvelopeXdr,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            action: "manual_signed_envelope_consumed",
            execution,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const execution = await orchestrator.reconcileManualAttempt(common);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          action: "reconciled_exact_attempt",
          execution,
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
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "manual_operator_failure";
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(
    `${JSON.stringify({ ok: false, code, error: message })}\n`,
  );
  process.exitCode = 1;
});
