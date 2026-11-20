CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL UNIQUE,
  configured BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_seeds (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  seed JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_states (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_memories (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  memory_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  context_tag TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  memory JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, memory_id)
);
CREATE INDEX IF NOT EXISTS agent_memories_retrieval_idx ON agent_memories(agent_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS agent_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL UNIQUE,
  sequence BIGINT NOT NULL,
  payload_hash TEXT NOT NULL,
  event JSONB NOT NULL,
  trace JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_narratives (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  narrative JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE IF NOT EXISTS agent_evaluations (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL,
  metrics JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID REFERENCES agents(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_agent_idx ON audit_events(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_status (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
