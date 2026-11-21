import assert from "node:assert/strict";
import test from "node:test";
import { Account, Keypair } from "@stellar/stellar-sdk";

import type { AgentRepository } from "../src/db/repository.js";
import type { AgentProjection, EvolutionReceipt } from "../src/db/types.js";
import {
  ClaimableBalanceRunner,
  HorizonClaimableBalanceObserver,
  StellarClaimExecutor,
  type ClaimableRyloGift,
} from "../src/runtime/claimable-loop.js";

const issuer = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";

test("observer exposes only unconditional single-claimant gifts for configured agents and exact RYLO", async () => {
  const wallet = Keypair.random();
  const other = Keypair.random();
  const body = {
    _embedded: {
      records: [
        { id: `00000000${"a".repeat(64)}`, asset: `RYLO:${issuer}`, amount: "2.0000000", claimants: [{ destination: wallet.publicKey(), predicate: { unconditional: true } }] },
        { id: `00000000${"b".repeat(64)}`, asset: `OTHER:${issuer}`, amount: "2.0000000", claimants: [{ destination: wallet.publicKey(), predicate: { unconditional: true } }] },
        { id: `00000000${"c".repeat(64)}`, asset: `RYLO:${issuer}`, amount: "2.0000000", claimants: [{ destination: other.publicKey(), predicate: { unconditional: true } }] },
        { id: `00000000${"d".repeat(64)}`, asset: `RYLO:${issuer}`, amount: "2.0000000", claimants: [{ destination: wallet.publicKey(), predicate: { abs_before: "2026-11-22T00:00:00Z" } }] },
      ],
    },
    _links: { next: { href: "" } },
  };
  const observer = new HorizonClaimableBalanceObserver({
    horizonUrl: "https://horizon.stellar.org",
    ryloCode: "RYLO",
    ryloIssuer: issuer,
    fetcher: async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const gifts = await observer.observe(new Set([wallet.publicKey()]));
  assert.equal(gifts.length, 1);
  assert.equal(gifts[0]?.destination, wallet.publicKey());
  assert.equal(gifts[0]?.amountRylo, 2);
});

test("executor creates a trustline when absent, claims the balance, and signs with the claimant", async () => {
  const wallet = Keypair.random();
  let submitted: { operations: Array<{ type: string }>; signatures: unknown[] } | undefined;
  const executor = new StellarClaimExecutor({
    ryloCode: "RYLO",
    ryloIssuer: issuer,
    server: {
      loadAccount: async () => Object.assign(new Account(wallet.publicKey(), "1"), { balances: [{ asset_type: "native", balance: "300.0000000" }] }),
      fetchBaseFee: async () => 100,
      submitTransaction: async (transaction) => {
        submitted = transaction as typeof submitted;
        return { hash: "a".repeat(64) };
      },
    },
  });
  const result = await executor.execute({
    balanceId: `00000000${"a".repeat(64)}`,
    destination: wallet.publicKey(),
    amountRylo: 2,
  }, wallet);
  assert.equal(result.hash, "a".repeat(64));
  assert.equal(result.trustlineCreated, true);
  assert.deepEqual(submitted?.operations.map((operation) => operation.type), ["changeTrust", "claimClaimableBalance"]);
  assert.equal(submitted?.signatures.length, 1);
});

test("runner records a cognitive gift decision before executing an accepted claim", async () => {
  const agent: AgentProjection = {
    id: "00000000-0000-4000-8000-000000000001",
    alias: "ALPHA",
    publicKey: Keypair.random().publicKey(),
    configured: true,
    revision: 7,
    episodeCount: 7,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
    cognitiveSummary: { affect: 0, stress: 0.2, confidence: 0.5, urgency: 0.2, feltSecurity: 0.8 },
    behavioralSummary: { lastAction: null, actionRunLength: 0, lastEpisodeAt: null },
  };
  const events: string[] = [];
  const executionsRecorded: string[] = [];
  const repository = {
    list: async () => [agent],
    get: async () => ({ ...agent, revision: agent.revision + events.length }),
    applyEvolution: async (_target: string, event: { type: string }): Promise<EvolutionReceipt> => {
      events.push(event.type);
      return { eventId: `event-${events.length}`, agentId: agent.id, sequence: agent.revision + events.length, revision: agent.revision + events.length, duplicate: false, actionTendency: events.length === 1 ? "claim" : "hold", deliberated: true };
    },
    recordExecution: async (_target: string, record: { transactionHash: string }) => {
      executionsRecorded.push(record.transactionHash);
    },
  } as unknown as AgentRepository;
  const gift: ClaimableRyloGift = { balanceId: `00000000${"a".repeat(64)}`, destination: agent.publicKey, amountRylo: 2 };
  let executions = 0;
  const logs: unknown[] = [];
  const runner = new ClaimableBalanceRunner({
    repository,
    observe: async () => [gift],
    inspect: async () => ({ hasRyloTrustline: false, nativeBalanceXlm: 300 }),
    signerForPublicKey: () => Keypair.random(),
    execute: async () => { executions += 1; return { hash: "b".repeat(64), trustlineCreated: true }; },
    executionEnabled: true,
    logger: { info(value: unknown) { logs.push(value); }, error(value: unknown) { logs.push(value); } },
  });
  const result = await runner.run();
  assert.deepEqual(events, ["claimable_balance_observation", "decision_outcome"]);
  assert.equal(executions, 1);
  assert.deepEqual(executionsRecorded, ["b".repeat(64)]);
  assert.deepEqual(result, { observed: 1, evaluated: 1, claimed: 1, deferred: 0, declined: 0, failed: 0 });
  assert.equal(JSON.stringify(logs).includes(agent.publicKey), false);
});
