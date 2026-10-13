import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  OFFICIAL_STELLAR_TESTNET_HORIZON_URL,
  OfficialStellarTestnetHorizonReader,
  OfficialStellarTestnetHorizonSubmissionAdapter,
  OfficialTestnetHorizonError,
} from "../lib/stellar/official-testnet-horizon";
import {
  SHARED_ISSUER_TESTNET_PASSPHRASE,
  buildSharedIssuerIssuancePlan,
} from "../lib/stellar/shared-issuer-issuance";

const NOW = Date.parse("2026-10-13T07:30:00.000Z");
const LATEST_LEDGER_CLOSED_AT = "2026-10-13T07:29:55.000Z";
const TRANSACTION_LEDGER_CLOSED_AT = "2026-10-13T07:29:50.000Z";
const ISSUER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 91));
const DESTINATION_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 92));
const ISSUER = ISSUER_KEYPAIR.publicKey();
const DESTINATION = DESTINATION_KEYPAIR.publicKey();

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

function createFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function signedEnvelopeFixture(): { signedEnvelopeXdr: string; hash: string } {
  const plan = buildSharedIssuerIssuancePlan(
    {
      projectId: "project-horizon-adapter",
      assetCode: "NOVA",
      issuerPublicKey: ISSUER,
      destinationPublicKey: DESTINATION,
      amount: "25",
      network: "testnet",
      networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
      validFrom: 1_800_000_000,
      validUntil: 1_800_000_300,
    },
    {
      assetCodeReservedForProject: true,
      issuerSequence: "123",
      issuerSpendableNativeStroops: "1000000",
      feeStroops: "100",
      destinationTrustline: {
        network: "testnet",
        networkPassphrase: SHARED_ISSUER_TESTNET_PASSPHRASE,
        destinationPublicKey: DESTINATION,
        assetCode: "NOVA",
        issuerPublicKey: ISSUER,
        observedLedger: 100,
        exists: true,
        authorized: true,
        balance: "0",
        limit: "1000",
        buyingLiabilities: "0",
      },
    },
  );
  const transaction = TransactionBuilder.fromXDR(
    plan.unsignedEnvelopeXdr,
    Networks.TESTNET,
  );
  if (!(transaction instanceof Transaction)) {
    assert.fail("expected classic transaction fixture");
  }
  transaction.sign(ISSUER_KEYPAIR);
  return {
    signedEnvelopeXdr: transaction.toXDR(),
    hash: plan.transactionHash,
  };
}

test("official reader binds confirmed evidence to the exact transaction resource and latest ledger checkpoint", async () => {
  const hash = "a".repeat(64);
  const { fetchImpl, calls } = createFetch((url) => {
    if (
      url === `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/transactions/${hash}`
    ) {
      return jsonResponse({
        hash,
        ledger: 900,
        created_at: TRANSACTION_LEDGER_CLOSED_AT,
        successful: true,
        envelope_xdr: "signed-envelope-xdr",
        result_xdr: "result-xdr",
      });
    }
    if (
      url ===
      `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/ledgers?order=desc&limit=1`
    ) {
      return jsonResponse({
        _embedded: {
          records: [
            {
              sequence: 901,
              closed_at: LATEST_LEDGER_CLOSED_AT,
            },
          ],
        },
      });
    }
    return jsonResponse({ error: "unexpected request" }, 500);
  });

  const reader = new OfficialStellarTestnetHorizonReader(fetchImpl, () => NOW);
  const evidence = await reader.lookupTransaction(hash.toUpperCase());

  assert.deepEqual(evidence, {
    status: "confirmed",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: hash,
    resultTransactionHash: hash,
    envelopeXdr: "signed-envelope-xdr",
    resultXdr: "result-xdr",
    ledgerSequence: 900,
    ledgerClosedAt: TRANSACTION_LEDGER_CLOSED_AT,
    observedLedger: 901,
    observedAt: new Date(NOW).toISOString(),
    observedLedgerClosedAt: LATEST_LEDGER_CLOSED_AT,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.redirect, "error");
});

test("official reader returns failed exact-hash evidence without fabricating success XDR", async () => {
  const hash = "b".repeat(64);
  const { fetchImpl } = createFetch((url) => {
    if (url.includes("/transactions/")) {
      return jsonResponse({
        hash,
        ledger: 910,
        created_at: TRANSACTION_LEDGER_CLOSED_AT,
        successful: false,
      });
    }
    return jsonResponse({
      _embedded: {
        records: [
          {
            sequence: 911,
            closed_at: LATEST_LEDGER_CLOSED_AT,
          },
        ],
      },
    });
  });

  const evidence = await new OfficialStellarTestnetHorizonReader(
    fetchImpl,
    () => NOW,
  ).lookupTransaction(hash);

  assert.deepEqual(evidence, {
    status: "failed",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: hash,
    ledgerSequence: 910,
    observedLedger: 911,
    observedAt: new Date(NOW).toISOString(),
    observedLedgerClosedAt: LATEST_LEDGER_CLOSED_AT,
  });
});

test("exact-hash 404 becomes not-found only with a separate official latest-ledger checkpoint", async () => {
  const hash = "c".repeat(64);
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes("/transactions/")) {
      return jsonResponse({ status: 404 }, 404);
    }
    return jsonResponse({
      _embedded: {
        records: [
          {
            sequence: 920,
            closed_at: LATEST_LEDGER_CLOSED_AT,
          },
        ],
      },
    });
  });

  const evidence = await new OfficialStellarTestnetHorizonReader(
    fetchImpl,
    () => NOW,
  ).lookupTransaction(hash);

  assert.deepEqual(evidence, {
    status: "not_found",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    transactionHash: hash,
    observedLedger: 920,
    observedAt: new Date(NOW).toISOString(),
    observedLedgerClosedAt: LATEST_LEDGER_CLOSED_AT,
  });
  assert.equal(calls.length, 2);
});

test("account sequence evidence is bound to the requested issuer and a later latest-ledger observation", async () => {
  const { fetchImpl, calls } = createFetch((url) => {
    if (url === `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/accounts/${ISSUER}`) {
      return jsonResponse({
        account_id: ISSUER,
        sequence: "123456",
      });
    }
    return jsonResponse({
      _embedded: {
        records: [
          {
            sequence: 930,
            closed_at: LATEST_LEDGER_CLOSED_AT,
          },
        ],
      },
    });
  });

  const evidence = await new OfficialStellarTestnetHorizonReader(
    fetchImpl,
    () => NOW,
  ).readAccountSequence(ISSUER.toLowerCase());

  assert.equal(evidence.accountPublicKey, ISSUER);
  assert.equal(evidence.sequence, "123456");
  assert.equal(evidence.observedLedger, 930);
  assert.equal(calls.length, 2);
});

test("official reader rejects mismatched transaction records and invalid caller identities", async () => {
  let requestCount = 0;
  const { fetchImpl } = createFetch(() => {
    requestCount += 1;
    return jsonResponse({
      hash: "e".repeat(64),
      ledger: 940,
      created_at: TRANSACTION_LEDGER_CLOSED_AT,
      successful: true,
      envelope_xdr: "xdr",
      result_xdr: "result",
    });
  });
  const reader = new OfficialStellarTestnetHorizonReader(fetchImpl, () => NOW);

  await assert.rejects(
    reader.lookupTransaction("d".repeat(64)),
    (error: unknown) =>
      error instanceof OfficialTestnetHorizonError &&
      error.code === "malformed_horizon_response",
  );
  assert.equal(requestCount, 1);

  await assert.rejects(
    reader.lookupTransaction("not-a-hash"),
    (error: unknown) =>
      error instanceof OfficialTestnetHorizonError &&
      error.code === "invalid_transaction_hash",
  );
  await assert.rejects(
    reader.readAccountSequence("not-an-account"),
    (error: unknown) =>
      error instanceof OfficialTestnetHorizonError &&
      error.code === "invalid_account",
  );
  assert.equal(requestCount, 1);
});

test("submission adapter posts the exact signed envelope once and returns only the locally matching hash", async () => {
  const fixture = signedEnvelopeFixture();
  const { fetchImpl, calls } = createFetch((_url, init) => {
    assert.equal(init?.method, "POST");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("tx"), fixture.signedEnvelopeXdr);
    return jsonResponse({ hash: fixture.hash });
  });

  const result = await new OfficialStellarTestnetHorizonSubmissionAdapter(
    fetchImpl,
  ).submitSignedEnvelope(fixture.signedEnvelopeXdr);

  assert.deepEqual(result, { hash: fixture.hash });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    `${OFFICIAL_STELLAR_TESTNET_HORIZON_URL}/transactions`,
  );
  assert.equal(calls[0]?.init?.redirect, "error");
});

test("submission transport uncertainty never retries and requires exact-hash reconciliation", async () => {
  const fixture = signedEnvelopeFixture();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new Error("connection reset after write");
  }) as typeof fetch;

  await assert.rejects(
    new OfficialStellarTestnetHorizonSubmissionAdapter(
      fetchImpl,
    ).submitSignedEnvelope(fixture.signedEnvelopeXdr),
    (error: unknown) =>
      error instanceof OfficialTestnetHorizonError &&
      error.code === "submission_reconciliation_required" &&
      error.transactionHash === fixture.hash,
  );
  assert.equal(calls, 1);
});

test("non-success or mismatched submission responses require reconciliation instead of automatic resubmission", async () => {
  const fixture = signedEnvelopeFixture();

  for (const response of [
    jsonResponse({ error: "temporary" }, 503),
    jsonResponse({ hash: "f".repeat(64) }),
  ]) {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return response;
    }) as typeof fetch;

    await assert.rejects(
      new OfficialStellarTestnetHorizonSubmissionAdapter(
        fetchImpl,
      ).submitSignedEnvelope(fixture.signedEnvelopeXdr),
      (error: unknown) =>
        error instanceof OfficialTestnetHorizonError &&
        error.code === "submission_reconciliation_required" &&
        error.transactionHash === fixture.hash,
    );
    assert.equal(calls, 1);
  }
});

test("invalid signed XDR is rejected before any submission request", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ hash: "a".repeat(64) });
  }) as typeof fetch;

  await assert.rejects(
    new OfficialStellarTestnetHorizonSubmissionAdapter(
      fetchImpl,
    ).submitSignedEnvelope("not-xdr"),
    (error: unknown) =>
      error instanceof OfficialTestnetHorizonError &&
      error.code === "invalid_signed_envelope",
  );
  assert.equal(calls, 0);
});
