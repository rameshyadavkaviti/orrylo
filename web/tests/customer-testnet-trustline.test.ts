import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  CustomerTrustlineError,
  inspectCustomerTrustline,
  confirmCustomerTrustline,
  reconcileCustomerTrustline,
  readCustomerTrustlineConfiguration,
} from "../lib/server/projects/customer-testnet-trustline";

const ISSUER = "GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV";
const WALLET = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 203));
const CUSTOMER = WALLET.publicKey();
const CONFIG = {
  issuerPublicKey: ISSUER,
  issuerFeeStroops: "100",
  maxCustomerFeeStroops: "200",
};

function issuerAccount() {
  return {
    account_id: ISSUER,
    sequence: "101",
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [{ key: ISSUER, weight: 1, type: "ed25519_public_key" }],
    balances: [
      {
        asset_type: "native",
        balance: "10.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
    ],
  };
}

function customerAccount(input?: {
  trustline?: boolean;
  limit?: string;
  authorized?: boolean;
  nativeBalance?: string;
  sequence?: string;
}) {
  const trustline = input?.trustline ?? false;
  return {
    account_id: CUSTOMER,
    sequence: input?.sequence ?? "123",
    subentry_count: trustline ? 1 : 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [{ key: CUSTOMER, weight: 1, type: "ed25519_public_key" }],
    balances: [
      {
        asset_type: "native",
        balance: input?.nativeBalance ?? "5.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      ...(trustline
        ? [
            {
              asset_type: "credit_alphanum12",
              asset_code: "TESTNEW",
              asset_issuer: ISSUER,
              balance: "0.0000000",
              limit: input?.limit ?? "100.0000000",
              buying_liabilities: "0.0000000",
              is_authorized: input?.authorized ?? true,
            },
          ]
        : []),
    ],
  };
}

function fixture(input?: {
  trustline?: boolean;
  limit?: string;
  authorized?: boolean;
  nativeBalance?: string;
  baseFee?: number;
  ledgerClosedAt?: string;
  customerSequence?: string;
  transaction?: (hash: string) => unknown;
}) {
  let trust = input?.trustline ?? false;
  let trustLimit = input?.limit;
  const calls: string[] = [];
  const fetchImpl = (async (url: URL | RequestInfo) => {
    const path = String(url);
    calls.push(path);
    let body: unknown;
    if (path.includes("/ledgers?")) {
      body = {
        _embedded: {
          records: [
            {
              sequence: 900,
              closed_at: input?.ledgerClosedAt ?? "2026-10-16T09:00:00Z",
              base_fee_in_stroops: input?.baseFee ?? 100,
              base_reserve_in_stroops: 5_000_000,
            },
          ],
        },
      };
    } else if (path.endsWith("/accounts/" + ISSUER)) {
      body = issuerAccount();
    } else if (path.endsWith("/accounts/" + CUSTOMER)) {
      body = customerAccount({
        trustline: trust,
        limit: trustLimit,
        authorized: input?.authorized,
        nativeBalance: input?.nativeBalance,
        sequence: input?.customerSequence,
      });
    } else if (path.includes("/transactions/")) {
      const hash = path.split("/").at(-1)!;
      body = input?.transaction?.(hash);
      if (!body) return new Response("{}", { status: 404 });
    } else {
      return new Response("{}", { status: 500 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    setTrustline(limit = "1000.0000000") {
      trust = true;
      trustLimit = limit;
    },
  };
}

function args() {
  return {
    configuration: CONFIG,
    destinationPublicKey: CUSTOMER,
    assetCode: "TESTNEW",
    initialSupply: "250",
  };
}

test("existing authorized trustline with capacity bypasses signing and charges zero customer fee", async () => {
  const fx = fixture({ trustline: true, limit: "1000.0000000" });
  const plan = await inspectCustomerTrustline(args(), fx.fetchImpl);
  assert.equal(plan.status, "ready");
  assert.equal(plan.customerFeeStroops, "0");
  assert.equal(plan.additionalReserveStroops, "0");
  assert.equal(plan.unsignedXdr, undefined);
});

test("missing trustline produces one exact wallet-funded ChangeTrust on Testnet", async () => {
  const fx = fixture();
  const plan = await inspectCustomerTrustline(args(), fx.fetchImpl, () =>
    Date.parse("2026-10-16T09:00:01Z"),
  );
  assert.equal(plan.status, "signature_required");
  assert.equal(plan.customerFeeStroops, "100");
  assert.equal(plan.additionalReserveStroops, "5000000");
  assert.equal(plan.issuerPublicKey, ISSUER);
  assert.equal(plan.destinationPublicKey, CUSTOMER);
  assert.ok(plan.unsignedXdr);
  const tx = TransactionBuilder.fromXDR(plan.unsignedXdr!, Networks.TESTNET);
  assert.ok(tx instanceof Transaction);
  assert.equal(tx.source, CUSTOMER);
  assert.equal(tx.operations.length, 1);
  assert.equal(tx.operations[0]?.type, "changeTrust");
  const op = tx.operations[0] as unknown as {
    line: { getIssuer(): string; getCode(): string };
    limit: string;
  };
  assert.equal(op.line.getCode(), "TESTNEW");
  assert.equal(op.line.getIssuer(), ISSUER);
  assert.equal(op.limit, "250.0000000");
  assert.equal(tx.fee, "100");
  assert.equal(Buffer.from(tx.hash()).toString("hex"), plan.transactionHash);
});

test("insufficient capacity produces a new limit; unauthorized trustline fails closed", async () => {
  const fx = fixture({ trustline: true, limit: "100.0000000" });
  const plan = await inspectCustomerTrustline(args(), fx.fetchImpl);
  assert.equal(plan.status, "signature_required");
  assert.equal(plan.additionalReserveStroops, "0");
  const op = (
    TransactionBuilder.fromXDR(
      plan.unsignedXdr!,
      Networks.TESTNET,
    ) as Transaction
  ).operations[0] as unknown as { limit: string };
  assert.equal(op.limit, "250.0000000");
  await assert.rejects(
    inspectCustomerTrustline(
      args(),
      fixture({ trustline: true, authorized: false }).fetchImpl,
    ),
    (error: unknown) =>
      error instanceof CustomerTrustlineError &&
      error.code === "trustline_unauthorized",
  );
});

test("customer fee cap and reserve safety reject before wallet signing", async () => {
  await assert.rejects(
    inspectCustomerTrustline(
      { ...args(), configuration: { ...CONFIG, issuerFeeStroops: "300" } },
      fixture({ baseFee: 201 }).fetchImpl,
    ),
    (error: unknown) =>
      error instanceof CustomerTrustlineError &&
      error.code === "trustline_fee_cap_exceeded",
  );
  await assert.rejects(
    inspectCustomerTrustline(
      args(),
      fixture({ nativeBalance: "1.0000000" }).fetchImpl,
    ),
    (error: unknown) =>
      error instanceof CustomerTrustlineError &&
      error.code === "insufficient_customer_xlm",
  );
});

test("configured fee cap is mandatory; no uncontrolled or Mainnet trustline", () => {
  for (const overrides of [
    { NEXT_PUBLIC_STELLAR_NETWORK: "public" },
    { NEXT_PUBLIC_STELLAR_NETWORK: "testnet" },
    {
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY: ISSUER,
      ORRYLO_TESTNET_SHARED_ISSUER_FEE_STROOPS: "100",
    },
  ]) {
    assert.throws(
      () =>
        readCustomerTrustlineConfiguration({ NODE_ENV: "test", ...overrides }),
      (error: unknown) =>
        error instanceof CustomerTrustlineError &&
        error.code === "trustline_configuration_unavailable",
    );
  }
});

test("only an official exact-hash successful ChangeTrust followed by usable capacity is accepted", async () => {
  const fx = fixture();
  const unsigned = await inspectCustomerTrustline(args(), fx.fetchImpl);
  assert.ok(unsigned.unsignedXdr && unsigned.transactionHash);
  const tx = TransactionBuilder.fromXDR(unsigned.unsignedXdr, Networks.TESTNET);
  assert.ok(tx instanceof Transaction);
  tx.sign(WALLET);
  const evidence = {
    hash: unsigned.transactionHash,
    successful: true,
    ledger: 901,
    envelope_xdr: tx.toXDR(),
  };
  const confirmedFx = fixture({
    trustline: true,
    limit: "250.0000000",
    transaction: () => evidence,
  });
  const accepted = await confirmCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash,
    },
    confirmedFx.fetchImpl,
  );
  assert.equal(accepted.status, "ready");

  const unconfirmed = fixture({
    transaction: () => ({ ...evidence, successful: false }),
  });
  await assert.rejects(
    confirmCustomerTrustline(
      {
        ...args(),
        transactionHash: unsigned.transactionHash,
      },
      unconfirmed.fetchImpl,
    ),
  );

  const missing = fixture({
    transaction: () => evidence,
  });
  await assert.rejects(
    confirmCustomerTrustline(
      {
        ...args(),
        transactionHash: unsigned.transactionHash,
      },
      missing.fetchImpl,
    ),
  );
});

const EXPIRED_TIME = () => Date.parse("2026-10-16T08:40:00Z");

test("uncertain ChangeTrust is pending even if the trustline still does not exist", async () => {
  const fx = fixture({ ledgerClosedAt: "2026-10-16T08:43:00Z" });
  const unsigned = await inspectCustomerTrustline(
    args(),
    fx.fetchImpl,
    EXPIRED_TIME,
  );
  const result = await reconcileCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash!,
      unsignedXdr: unsigned.unsignedXdr!,
    },
    fx.fetchImpl,
  );
  assert.equal(result.status, "pending");
  assert.ok(
    fx.calls.some((url) =>
      url.endsWith("/transactions/" + unsigned.transactionHash),
    ),
  );
});

test("exact-hash 404 resolves terminal only after expiry and unchanged customer sequence", async () => {
  const fx = fixture();
  const unsigned = await inspectCustomerTrustline(
    args(),
    fx.fetchImpl,
    EXPIRED_TIME,
  );
  const result = await reconcileCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash!,
      unsignedXdr: unsigned.unsignedXdr!,
    },
    fx.fetchImpl,
  );
  assert.equal(result.status, "terminal");

  const advancedSequence = fixture({ customerSequence: "124" });
  const unresolved = await reconcileCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash!,
      unsignedXdr: unsigned.unsignedXdr!,
    },
    advancedSequence.fetchImpl,
  );
  assert.equal(unresolved.status, "pending");
});

test("eventually verified trustline readiness permits progress with unresolved callback", async () => {
  const fx = fixture();
  const unsigned = await inspectCustomerTrustline(
    args(),
    fx.fetchImpl,
    EXPIRED_TIME,
  );
  fx.setTrustline("1000.0000000");
  const result = await reconcileCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash!,
      unsignedXdr: unsigned.unsignedXdr!,
    },
    fx.fetchImpl,
  );
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.trustline.status, "ready");
    assert.equal(result.trustline.destinationPublicKey, CUSTOMER);
  }
});

test("authoritatively failed exact-hash transaction permits only fresh planning", async () => {
  const fx = fixture();
  const unsigned = await inspectCustomerTrustline(
    args(),
    fx.fetchImpl,
    EXPIRED_TIME,
  );
  const tx = TransactionBuilder.fromXDR(
    unsigned.unsignedXdr!,
    Networks.TESTNET,
  );
  assert.ok(tx instanceof Transaction);
  tx.sign(WALLET);
  const failure = fixture({
    transaction: () => ({
      hash: unsigned.transactionHash,
      successful: false,
      ledger: 901,
      envelope_xdr: tx.toXDR(),
    }),
  });
  const result = await reconcileCustomerTrustline(
    {
      ...args(),
      transactionHash: unsigned.transactionHash!,
      unsignedXdr: unsigned.unsignedXdr!,
    },
    failure.fetchImpl,
  );
  assert.equal(result.status, "terminal");
});

test("changed hash or XDR cannot fabricate terminal proof", async () => {
  const fx = fixture();
  const unsigned = await inspectCustomerTrustline(
    args(),
    fx.fetchImpl,
    EXPIRED_TIME,
  );
  await assert.rejects(
    reconcileCustomerTrustline(
      {
        ...args(),
        transactionHash: "b".repeat(64),
        unsignedXdr: unsigned.unsignedXdr!,
      },
      fx.fetchImpl,
    ),
    (error: unknown) =>
      error instanceof CustomerTrustlineError &&
      error.code === "trustline_transaction_mismatch",
  );
});
