# ORRYLO Agent Core Phase 1 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Deploy a separate ORRYLO service that immediately enrolls valid environment-configured Stellar wallets as unique, persistent, independently evolving agents without enabling live trading.

**Architecture:** Add an isolated TypeScript service under services/agent-core and a Railway PostgreSQL service. The core reconciles wallet variables, derives versioned causal seeds with HMAC, persists separate state/memory/episodes, ingests ordered authenticated events, and applies bounded deterministic evolution.

**Tech Stack:** Node.js 20, TypeScript 5, Fastify, PostgreSQL (pg), @stellar/stellar-sdk, Node test runner, Railway.

**Spec:** docs/superpowers/specs/2026-11-21-agent-core-design.md

## Global constraints

- Keep orrylo-home and the informational website separate.
- Never persist, return, or log wallet secrets.
- High RYLO motives never directly select BUY.
- Phase 1 cannot sign or submit Stellar transactions.
- Execution true must fail startup.
- Every transition is bounded, idempotent, attributable, ordered, and audited.

## Review focus

- Public/secret mismatch rejects only that candidate, keeps diagnostics safe, and makes readiness unhealthy.
- Duplicate public keys or aliases cannot create two identities.
- Restarting with identical variables cannot reset or duplicate an agent.
- Duplicate event IDs cannot evolve state twice; conflicting payloads return conflict.
- Database failure makes readiness fail without health disclosing internals.

## Task 1 — Configuration and service skeleton

Files: services/agent-core/package.json, tsconfig.json, src/config.ts, test/config.test.ts.

- Write failing tests for required variables, ranges, pause behavior, and execution=true rejection.
- Implement loadConfig(env): AppConfig and secret-safe ConfigError.
- Verify focused tests pass.

## Task 2 — Wallet discovery and verification

Files: src/enrollment/wallet-env.ts, test/wallet-env.test.ts.

- Test valid pairs, missing halves, malformed aliases/keys, mismatched keypairs, duplicates, and error redaction.
- Implement discoverWallets and verifyWalletCandidate using Stellar key derivation.
- Verify secrets never appear in serialized results.

## Task 3 — Deterministic cognitive identity

Files: src/identity/types.ts, src/identity/derive-seed.ts, test/derive-seed.test.ts.

- Test determinism, uniqueness, versioning, correlations, bounds, high RYLO motives, and absence of direct actions.
- Implement HMAC sampling and correlated parameter bundles.
- Verify reference identity distances.

## Task 4 — Bounded evolution

Files: src/evolution/types.ts, src/evolution/evolve.ts, test/evolve.test.ts.

- Test state/prior/core caps, ordered deterministic replay, path dependence, early plasticity decay, deliberation, memory retrieval, and divergent histories.
- Implement createInitialState and evolveAgent returning trace, memories, attribution, and metric deltas.
- Verify wait/observe/hold/sell/abstain/exit remain available and BUY is never guaranteed.

## Task 5 — Persistence and transactions

Files: src/db/migrations/001_initial.sql, src/db/migrate.ts, src/db/repository.ts, src/db/types.ts, test/repository.contract.test.ts.

- Define normalized versioned tables, uniqueness constraints, indexes, append-only audits, and checksums.
- Define AgentRepository methods: migrate, enroll, reconcileConfiguration, list, get, appendEpisode, applyEvolution, metrics, readiness.
- Test duplicate enrollment/events, conflicting payloads, sequences, revision checks, atomicity, redacted projections, and DB-failure readiness.
- Add integration tests gated by TEST_DATABASE_URL.

## Task 6 — Enrollment reconciliation

Files: src/enrollment/reconcile.ts, test/reconcile.test.ts.

- Test first enrollment, restart idempotency, alias removal/rename/conflict, mixed valid/invalid candidates, onboarding episode, and secret-free audits.
- Implement reconciliation and initial state/narrative creation.
- Readiness is unhealthy when any configured candidate is invalid.

## Task 7 — Authenticated API

Files: src/http/auth.ts, src/http/server.ts, test/http.test.ts.

- Test constant-time current/previous keys, all routes, payload limits, event schemas, per-agent sequencing, duplicate/conflicting events, pause 503, redacted output, and DB readiness.
- Implement healthz, readyz, agents, agent detail, events, and metrics.
- Keep health/readiness open and all /v1 routes private.

## Task 8 — Runtime and operations

Files: src/runtime/evolution-loop.ts, src/index.ts, test/runtime.test.ts.

- Test migration before reconciliation, non-overlapping loop, graceful shutdown, readiness transitions, pause, and secret-free logs.
- Implement runtime composition without fabricated market events.
- Run typecheck, unit tests, build, behavioral fixtures, and Postgres integration when available.

## Task 9 — Behavioral manifest and documentation

Files: services/agent-core/design-manifest.json, test/behavioral-signatures.test.ts, services/agent-core/README.md, root README.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/DEPLOYMENT.md.

- Encode the causal contracts and paired fixtures.
- Test the numeric acceptance criteria from the spec.
- Record Phase 1 as approved implementation while keeping live execution pending.
- Document variables, endpoints, claims boundary, rollback, and commands.

## Task 10 — Railway deployment and evidence

- Re-read orrylo-v2 inventory; do not create duplicates.
- Create agent-postgres once and verify inventory.
- Create orrylo-agent-core from main with root /services/agent-core.
- Wire DATABASE_URL by Railway reference.
- Generate identity/API keys without printing them.
- Set execution false, prefix, pause, and runtime variables.
- Inspect staged changes before accepting them.
- Poll deployment to terminal SUCCESS or diagnose bounded logs.
- Verify healthz, readyz, deployment status, logs, and that orrylo-home remains SUCCESS.
- Record commit SHA, observed evidence, known gaps, and rollback in docs/DEPLOYMENT.md.
