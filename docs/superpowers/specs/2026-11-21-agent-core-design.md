# ORRYLO Agent Core — Phase 1 Design

## Intent

Start ORRYLO's separate agent system inside Railway project orrylo-v2. Every correctly configured Stellar wallet becomes one durable software agent with a unique causal cognitive seed, private memory, changing internal state, independent decision traces, and a bounded path of behavioral development.

This phase establishes measurable mechanisms. It does not claim that agents are human, conscious, scientifically validated, profitable, or already improving in live markets.

## Goals

- Discover configured wallets at startup and create missing agents immediately.
- Verify that every Stellar secret derives the configured public key.
- Never persist, return, or log wallet secrets.
- Derive a stable unique seed for each public key using a versioned HMAC master key.
- Keep each agent's seed, state, memories, narrative, episodes, and evaluations separate.
- Initialize strong ORRYLO competition and RYLO-acquisition motives without mapping either directly to BUY.
- Evolve state after every valid episode while changing core identity slowly and only within bounds.
- Provide authenticated event ingestion and private read APIs.
- Keep live trading disabled and separate from the informational website.
- Deploy the core and PostgreSQL in orrylo-v2 without changing orrylo-home.

## Non-goals

- Sign, submit, or match Stellar transactions.
- Choose an issuer, force trades, guarantee activity, support price, or generate volume.
- Put agent controls, custody, or trading UI on orrylo.com.
- Reuse VEYRIX code, profiles, schedules, or participant data.
- Depend on an LLM for deterministic identity or state transitions.

## Anti-goals

- Cosmetic personas that differ only by prose or names.
- Shared memory or a shared learned policy that erases individuality.
- Secrets in PostgreSQL, API responses, errors, traces, or logs.
- One event rewriting identity or any unbounded self-modification.
- Common-owner self-dealing, synchronized price targets, volume targets, wash trades, or chart-shape optimization.

## Constraints

- Source of Truth: rameshyadavkaviti/orrylo main.
- Infrastructure: Railway orrylo-v2 production.
- Node.js 20+, TypeScript, PostgreSQL.
- Secrets remain Railway variables and process memory only.
- ORRYLO_EXECUTION_ENABLED must be false; Phase 1 has no transaction adapter.
- Website and agent runtime remain operationally separate.

## Approaches

### Selected: one agent-core service plus PostgreSQL

Create an isolated services/agent-core application combining enrollment, migrations, API, and the bounded evolution loop. This is the smallest deployable architecture and can later split without changing persisted contracts.

### Deferred: separate API and worker

Better independent scaling, but unnecessary before workload and event volume are known.

### Rejected: stateless function

Does not fit continuous reconciliation, ordered episodes, or durable background processing.

## Enrollment contract

Read pairs named:

- ORRYLO_AGENT_<TOKEN>_PUBLIC_KEY
- ORRYLO_AGENT_<TOKEN>_SECRET_KEY

TOKEN permits uppercase letters, digits, and underscores. Enrollment verifies Stellar key derivation and is idempotent by public key.

Rules:

- Missing halves, malformed values, mismatched keypairs, duplicate aliases, or a public key under multiple aliases are rejected without exposing secrets.
- Valid candidates still enroll when another candidate is invalid, but readiness is unhealthy and reports only sanitized counts/codes.
- Removing an alias marks its durable agent unconfigured; it never deletes identity or history.
- Renaming an alias for the same public key updates the alias with an audit event.
- Reusing an existing alias for a different public key is a conflict.

## Identity contract

Derive a versioned digest with HMAC-SHA-256(master key, public key plus context). Convert digest material into correlated bundles, not independent random traits.

Persist stable values, sensitivities, priors, reference-point profile, social priors, deliberation and exploration tendencies, learning rates, and plasticity bounds.

Initial ranges include:

- ryloCompetitionDrive: 0.82–0.98
- ryloAcquisitionDrive: 0.78–0.96

Exact values and correlated inhibitors differ by agent. Acquisition competes with solvency, opportunity cost, loss aversion, valuation, uncertainty, reputation, time horizon, and learned goals. Motives never directly select BUY; delay, observe, hold, sell, abstain, and exit remain available.

Existing seeds are persisted and never regenerated during master-key rotation. A key-version variable applies only to new enrollments. Loss of the master key blocks reproducible new enrollment but does not rewrite existing agents.

## Event and ordering contract

POST /v1/events accepts:

- eventId: caller-stable string, maximum 128 characters
- agentId or publicKey: exactly one target
- type: market_observation, decision_outcome, social_signal, operator_feedback, or evaluation_probe
- sequence: next positive per-agent integer
- occurredAt: ISO-8601 timestamp
- source: bounded producer identifier
- context: type-specific validated JSON
- outcome: optional type-specific validated JSON

One accepted event creates one episode. Onboarding is internal and cannot be submitted.

Per agent, sequence must equal the current sequence plus one. A repeated eventId with an identical canonical payload returns the stored result without another update. The same eventId with a different payload returns conflict. Late, skipped, or concurrent out-of-order sequences return conflict and are not applied. Event, episode, trace, memories, state revision, evaluation delta, and success audit commit atomically. Rejections create only a sanitized append-only audit record.

## Cognitive and evolution contract

Each episode follows:

observation -> attention -> appraisal -> memory retrieval -> active goals -> fast proposals -> deliberation gate -> bounded update -> trace -> consolidation

- Retrieve at most five memories using weighted recency, similarity, salience, and identity relevance.
- Deliberation probability rises with surprise, goal conflict, uncertainty, stakes, and accountability; it falls with load and time pressure.
- State delta per episode is capped at 0.15 per field.
- Learned prior delta per episode is capped at 0.02.
- Early strategy/state learning rate is baseRate × (1 + 2 × exp(-episodeCount / 25)).
- A durable identity adjustment requires at least 12 directionally consistent episodes across three contexts and is capped at 0.005 per consolidation.
- All values remain inside stored plasticity bounds.
- Structured memories and narratives are JSON records, not generated prose.
- Episodic records remain for audit; cognitive retrieval is bounded. Consolidation may create semantic/procedural summaries but does not delete audit history.

Deterministic random draws derive from agent ID, event ID, and seed version and are logged before the update. Different histories must produce different later state.

## Data model

- schema_migrations
- agents
- agent_seeds
- agent_states
- agent_memories
- agent_episodes
- agent_narratives
- agent_evaluations
- audit_events

Seed, state, event, and evaluation schemas version independently. Unique constraints cover public key, active alias, per-agent sequence, and event ID.

## HTTP and privacy

Open, redacted operational endpoints:

- GET /healthz: process only
- GET /readyz: database, migration, enrollment and paused status without identifiers or internals

All /v1 routes require constant-time Bearer authentication:

- GET /v1/agents
- GET /v1/agents/:id
- POST /v1/events
- GET /v1/metrics

Responses expose redacted cognitive summaries and metrics, never secrets, raw environment values, or private signing material. Phase 1 uses one global internal key plus an optional previous key for overlap during rotation.

## Pause and failure behavior

ORRYLO_PAUSED=true keeps health and readiness available, makes readiness report paused, and rejects new event ingestion with 503. It does not delete or rewrite data. Live execution is absent.

Database failure makes /readyz unhealthy while /healthz remains a redacted process signal. Structured errors redact names containing SECRET, TOKEN, KEY, or PASSWORD.

## Evaluation acceptance criteria

- Deterministic replay: 100% identical for fixed inputs.
- Bounds and secret-leak tests: 100% pass.
- Duplicate event: zero state-revision change.
- Trace completeness: 100% required stages present.
- Paired counterfactual fixtures: at least 80% of preregistered directional effects.
- Distinct-wallet seed vectors: non-identical; minimum normalized distance 0.05 in the reference fixture.
- Non-convergence: retain at least 60% of baseline pairwise distance after the standard longitudinal fixture.
- Market-integrity status: pass/fail reported separately and must pass.

These criteria validate Phase 1 mechanisms, not human equivalence.

## Railway deployment

- Preserve orrylo-home.
- Add PostgreSQL service agent-postgres.
- Add orrylo-agent-core from rameshyadavkaviti/orrylo@main with root /services/agent-core.
- Reference the database URL from the Postgres service.
- Generate ORRYLO_IDENTITY_MASTER_KEY and ORRYLO_INTERNAL_API_KEY without printing them.
- Set ORRYLO_EXECUTION_ENABLED=false, ORRYLO_AGENT_ENV_PREFIX=ORRYLO_AGENT_, and ORRYLO_PAUSED=false.
- Deploy only after tests pass; require terminal SUCCESS, healthy endpoints, and secret-free bounded logs.

## Future phases

Later approvals must separately define verified RYLO identity, real market observation, beneficial-owner enforcement, risk policy, valuation, emergency kill switch semantics for execution, and a Stellar signing/submission adapter.
