import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Networks } from "@stellar/stellar-sdk";

import { OFFICIAL_STELLAR_TESTNET_HORIZON_URL } from "../lib/stellar/official-testnet-horizon";
import {
  OfficialStellarTestnetIssuancePreflightReader,
  SharedIssuerTestnetPreflightError,
} from "../lib/stellar/shared-issuer-testnet-preflight";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  SharedIssuerIssuanceError,
  buildSharedIssuerIssuancePlan,
} from "../lib/stellar/shared-issuer-issuance";

const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 101)).publicKey();
const DESTINATION = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 102),
).publicKey();
const LEDGER_CLOSED_AT = "2026-10-13T08:00:00.000Z";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ledgerRecord(sequence = 1_000) {
  return {
    _embedded: {
      records: [
        {
          sequence,
          closed_at: LEDGER_CLOSED_AT,
          base_fee_in_stroops: 100,
          base_reserve_in_stroops: 5_000_000,
        },
      ],
    },
  };
}

function issuerAccount(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account_id: ISSUER,
    sequence: "123456",
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: {
      low_threshold: 1,
      med_threshold: 1,
      high_threshold: 1,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [
      {
        key: ISSUER,
        weight: 1,
        type: "ed25519_public_key",
      },
    ],
    balances: [
      {
        asset_type: "native",
        balance: "10.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "1.0000000",
      },
    ],
    ...overrides,
  };
}

function destinationAccount(
  balances: unknown[] = [
    {
      asset_type: "native",
      balance: "5.0000000",
      buying_liabilities: "0.0000000",
      selling_liabilities: "0.0000000",
    },
    {
      asset_type: "credit_alphanum4",
      asset_code: "NOVA",
      asset_issuer: ISSUER,
      balance: "10.0000000",
      limit: "1000.0000000",
      buying_liabilities: "2.0000000",
      selling_liabilities: "0.0000000",
      is_authorized: true,
    },
  ],
): Record<string, unknown> {
  return {
    account_id: DESTINATION,
    sequence: "888",
    subentry_count: 1,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: {
      low_threshold: 0,
      med_threshold: 0,
      high_threshold: 0,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [
      {
        key: DESTINATION,
        weight: 1,
        type: "ed25519_public_key",
      },
    ],
    balances,
  };
}

function createStableFetch(options?: {
  issuer?: Record<string, unknown>;
  destination?: Record<string, unknown>;
  firstLedger?: number;
  secondLedger?: number;
  destinationStatus?: number;
}): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let ledgerReads = 0;
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("/ledgers?")) {
      ledgerReads += 1;
      return jsonResponse(
        ledgerRecord(
          ledgerReads === 1
            ? (options?.firstLedger ?? 1_000)
            : (options?.secondLedger ?? options?.firstLedger ?? 1_000),
        ),
      );
    }

    if (url.endsWith(`/accounts/${ISSUER}`)) {
      return jsonResponse(options?.issuer ?? issuerAccount());
    }

    if (url.endsWith(`/accounts/${DESTINATION}`)) {
      if (options?.destinationStatus === 404) {
        return jsonResponse({ status: 404 }, 404);
      }
      return jsonResponse(options?.destination ?? destinationAccount());
    }

    return jsonResponse({ error: "unexpected request" }, 500);
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function preflightErrorCode(error: unknown): string | undefined {
  return error instanceof SharedIssuerTestnetPreflightError
    ? error.code
    : undefined;
}

test("reads one stable official Testnet preflight snapshot and computes issuer spendable XLM", async () => {
  const { fetchImpl, calls } = createStableFetch();
  const reader = new OfficialStellarTestnetIssuancePreflightReader(fetchImpl);

  const result = await reader.readIssuancePreconditions({
    issuerPublicKey: ISSUER,
    destinationPublicKey: DESTINATION,
    assetCode: "nova",
    assetCodeReservedForProject: true,
    feeStroops: "100",
  });

  assert.equal(result.network, "testnet");
  assert.equal(result.networkPassphrase, Networks.TESTNET);
  assert.equal(result.observedLedger, 1_000);
  assert.equal(result.baseFeeStroops, "100");
  assert.equal(result.baseReserveStroops, "5000000");
  assert.equal(result.preconditions.issuerSequence, "123456");
  assert.equal(result.preconditions.issuerSpendableNativeStroops, "80000000");
  assert.deepEqual(result.preconditions.destinationTrustline, {
    network: "testnet",
    networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
    destinationPublicKey: DESTINATION,
    assetCode: "NOVA",
    issuerPublicKey: ISSUER,
    observedLedger: 1_000,
    exists: true,
    authorized: true,
    balance: "10.0000000",
    limit: "1000.0000000",
    buyingLiabilities: "2.0000000",
  });

  assert.equal(calls.length, 4);
  assert.equal(
    calls[0]?.url,
    `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/ledgers?order=desc&limit=1`,
  );
  assert.equal(
    calls[3]?.url,
    `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/ledgers?order=desc&limit=1`,
  );
  assert.ok(calls.slice(1, 3).every((call) => call.init?.method === "GET"));
  assert.ok(calls.every((call) => call.init?.redirect === "error"));
});

test("preflight output feeds the existing canonical builder without browser-supplied Stellar authority", async () => {
  const { fetchImpl } = createStableFetch();
  const result = await new OfficialStellarTestnetIssuancePreflightReader(
    fetchImpl,
  ).readIssuancePreconditions({
    issuerPublicKey: ISSUER,
    destinationPublicKey: DESTINATION,
    assetCode: "NOVA",
    assetCodeReservedForProject: true,
    feeStroops: "100",
  });

  const plan = buildSharedIssuerIssuancePlan(
    {
      projectId: "project-preflight",
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "25",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      validFrom: 1_800_000_000,
      validUntil: 1_800_000_300,
    },
    result.preconditions,
  );

  assert.equal(plan.intent.issuerPublicKey, ISSUER);
  assert.equal(plan.intent.destinationPublicKey, DESTINATION);
  assert.equal(plan.intent.assetCode, "NOVA");
  assert.equal(plan.intent.amount, "25.0000000");
});

test("fails closed if the Testnet ledger advances while account preflight reads are in flight", async () => {
  const { fetchImpl } = createStableFetch({
    firstLedger: 1_000,
    secondLedger: 1_001,
  });

  await assert.rejects(
    new OfficialStellarTestnetIssuancePreflightReader(
      fetchImpl,
    ).readIssuancePreconditions({
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      assetCode: "NOVA",
      assetCodeReservedForProject: true,
      feeStroops: "100",
    }),
    (error: unknown) =>
      preflightErrorCode(error) === "preflight_ledger_advanced",
  );
});

test("rejects an issuer whose flags, thresholds, or signer set differ from owner-approved Testnet MVP Lite policy", async () => {
  const badIssuer = issuerAccount({
    flags: {
      auth_required: true,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
  });
  const { fetchImpl } = createStableFetch({ issuer: badIssuer });

  await assert.rejects(
    new OfficialStellarTestnetIssuancePreflightReader(
      fetchImpl,
    ).readIssuancePreconditions({
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      assetCode: "NOVA",
      assetCodeReservedForProject: true,
      feeStroops: "100",
    }),
    (error: unknown) => preflightErrorCode(error) === "issuer_policy_mismatch",
  );
});

test("represents a missing exact destination trustline truthfully so construction rejects it", async () => {
  const { fetchImpl } = createStableFetch({
    destination: destinationAccount([
      {
        asset_type: "native",
        balance: "5.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
    ]),
  });

  const result = await new OfficialStellarTestnetIssuancePreflightReader(
    fetchImpl,
  ).readIssuancePreconditions({
    issuerPublicKey: ISSUER,
    destinationPublicKey: DESTINATION,
    assetCode: "NOVA",
    assetCodeReservedForProject: true,
    feeStroops: "100",
  });

  assert.equal(result.preconditions.destinationTrustline.exists, false);
  assert.equal(result.preconditions.destinationTrustline.authorized, false);

  assert.throws(
    () =>
      buildSharedIssuerIssuancePlan(
        {
          projectId: "project-no-trustline",
          assetCode: "NOVA",
          issuerPublicKey: ISSUER,
          destinationPublicKey: DESTINATION,
          amount: "1",
          network: "testnet",
          networkPassphrase: Networks.TESTNET,
          validFrom: 1_800_000_000,
          validUntil: 1_800_000_300,
        },
        result.preconditions,
      ),
    (error: unknown) =>
      error instanceof SharedIssuerIssuanceError &&
      error.code === "trustline_missing",
  );
});

test("rejects a configured transaction fee below the stable network base fee", async () => {
  const { fetchImpl } = createStableFetch();

  await assert.rejects(
    new OfficialStellarTestnetIssuancePreflightReader(
      fetchImpl,
    ).readIssuancePreconditions({
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      assetCode: "NOVA",
      assetCodeReservedForProject: true,
      feeStroops: "99",
    }),
    (error: unknown) =>
      preflightErrorCode(error) === "fee_below_network_minimum",
  );
});

test("rejects an issuer that cannot cover the configured fee above reserve and selling liabilities", async () => {
  const poorIssuer = issuerAccount({
    balances: [
      {
        asset_type: "native",
        balance: "1.0000100",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
    ],
  });
  const { fetchImpl } = createStableFetch({ issuer: poorIssuer });

  await assert.rejects(
    new OfficialStellarTestnetIssuancePreflightReader(
      fetchImpl,
    ).readIssuancePreconditions({
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      assetCode: "NOVA",
      assetCodeReservedForProject: true,
      feeStroops: "101",
    }),
    (error: unknown) =>
      preflightErrorCode(error) === "insufficient_issuer_native_balance",
  );
});

test("rejects missing destination accounts without creating or funding them", async () => {
  const { fetchImpl } = createStableFetch({ destinationStatus: 404 });

  await assert.rejects(
    new OfficialStellarTestnetIssuancePreflightReader(
      fetchImpl,
    ).readIssuancePreconditions({
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      assetCode: "NOVA",
      assetCodeReservedForProject: true,
      feeStroops: "100",
    }),
    (error: unknown) => preflightErrorCode(error) === "destination_not_found",
  );
});
