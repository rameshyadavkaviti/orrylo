import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { evolveAgent } from "../evolution/evolve.js";
import type { AgentEvent, AgentMemory, AgentState, EvolutionResult } from "../evolution/types.js";
import type { CognitiveSeed } from "../identity/types.js";
import { migrate as runMigrations } from "./migrate.js";
import type { AgentProjection, EnrollInput, EvolutionReceipt, RepositoryMetrics, RepositoryReadiness } from "./types.js";

export class RepositoryConflict extends Error {
  constructor(readonly code: "ALIAS_CONFLICT" | "PUBLIC_KEY_CONFLICT" | "EVENT_ID_CONFLICT" | "SEQUENCE_CONFLICT" | "AGENT_NOT_FOUND") {
    super(code);
    this.name = "RepositoryConflict";
  }
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function hashEvent(event: AgentEvent): string {
  return createHash("sha256").update(canonicalize(event)).digest("hex");
}

function projection(record: StoredAgent): AgentProjection {
  return {
    id: record.id,
    alias: record.alias,
    publicKey: record.publicKey,
    configured: record.configured,
    revision: record.state.revision,
    episodeCount: record.state.episodeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cognitiveSummary: {
      affect: record.state.affect,
      stress: record.state.stress,
      confidence: record.state.confidence,
      urgency: record.state.urgency,
      feltSecurity: record.state.feltSecurity,
    },
  };
}

export interface AgentRepository {
  migrate(): Promise<void>;
  enroll(input: EnrollInput): Promise<AgentProjection>;
  reconcileConfiguration(publicKeys: string[]): Promise<void>;
  setEnrollmentStatus(issueCodes: string[]): Promise<void>;
  list(): Promise<AgentProjection[]>;
  get(idOrPublicKey: string): Promise<AgentProjection | undefined>;
  applyEvolution(idOrPublicKey: string, event: AgentEvent): Promise<EvolutionReceipt>;
  metrics(): Promise<RepositoryMetrics>;
  readiness(): Promise<RepositoryReadiness>;
  close(): Promise<void>;
}

interface StoredAgent extends EnrollInput {
  id: string;
  configured: boolean;
  memories: AgentMemory[];
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
}

export class InMemoryAgentRepository implements AgentRepository {
  private readonly agents = new Map<string, StoredAgent>();
  private readonly events = new Map<string, { agentId: string; hash: string; receipt: EvolutionReceipt }>();
  private invalidCandidates = 0;
  private migrated = false;

  constructor(private readonly options: { failEvolution?: boolean } = {}) {}

  async migrate(): Promise<void> { this.migrated = true; }

  async enroll(input: EnrollInput): Promise<AgentProjection> {
    const byPublic = [...this.agents.values()].find((agent) => agent.publicKey === input.publicKey);
    const byAlias = [...this.agents.values()].find((agent) => agent.alias === input.alias);
    if (byAlias && byAlias.publicKey !== input.publicKey) throw new RepositoryConflict("ALIAS_CONFLICT");
    if (byPublic) {
      if (byAlias && byAlias.id !== byPublic.id) throw new RepositoryConflict("ALIAS_CONFLICT");
      byPublic.alias = input.alias;
      byPublic.configured = true;
      byPublic.updatedAt = new Date().toISOString();
      return projection(byPublic);
    }
    const now = new Date().toISOString();
    const stored: StoredAgent = { ...structuredClone(input), id: randomUUID(), configured: true, memories: [], lastSequence: 0, createdAt: now, updatedAt: now };
    this.agents.set(stored.id, stored);
    return projection(stored);
  }

  async reconcileConfiguration(publicKeys: string[]): Promise<void> {
    const active = new Set(publicKeys);
    for (const agent of this.agents.values()) agent.configured = active.has(agent.publicKey);
  }

  async setEnrollmentStatus(issueCodes: string[]): Promise<void> { this.invalidCandidates = issueCodes.length; }
  async list(): Promise<AgentProjection[]> { return [...this.agents.values()].map(projection).sort((a, b) => a.alias.localeCompare(b.alias)); }
  async get(idOrPublicKey: string): Promise<AgentProjection | undefined> {
    const agent = this.agents.get(idOrPublicKey) ?? [...this.agents.values()].find((entry) => entry.publicKey === idOrPublicKey);
    return agent ? projection(agent) : undefined;
  }

  async applyEvolution(idOrPublicKey: string, event: AgentEvent): Promise<EvolutionReceipt> {
    const agent = this.agents.get(idOrPublicKey) ?? [...this.agents.values()].find((entry) => entry.publicKey === idOrPublicKey);
    if (!agent) throw new RepositoryConflict("AGENT_NOT_FOUND");
    const payloadHash = hashEvent(event);
    const existing = this.events.get(event.eventId);
    if (existing) {
      if (existing.agentId !== agent.id || existing.hash !== payloadHash) throw new RepositoryConflict("EVENT_ID_CONFLICT");
      return { ...existing.receipt, duplicate: true };
    }
    if (event.sequence !== agent.lastSequence + 1) throw new RepositoryConflict("SEQUENCE_CONFLICT");
    if (this.options.failEvolution) throw new Error("injected evolution failure");
    const result = evolveAgent(agent.seed, agent.state, agent.memories, event);
    const receipt: EvolutionReceipt = {
      eventId: event.eventId,
      agentId: agent.id,
      sequence: event.sequence,
      revision: result.state.revision,
      duplicate: false,
      actionTendency: result.actionTendency,
      deliberated: result.trace.deliberated,
    };
    agent.state = result.state;
    agent.memories = result.memories;
    agent.lastSequence = event.sequence;
    agent.updatedAt = new Date().toISOString();
    this.events.set(event.eventId, { agentId: agent.id, hash: payloadHash, receipt });
    return receipt;
  }

  async metrics(): Promise<RepositoryMetrics> {
    const agents = [...this.agents.values()];
    return {
      agents: agents.length,
      configuredAgents: agents.filter((agent) => agent.configured).length,
      episodes: this.events.size,
      memories: agents.reduce((sum, agent) => sum + agent.memories.length, 0),
      invalidCandidates: this.invalidCandidates,
    };
  }

  async readiness(): Promise<RepositoryReadiness> {
    return { database: true, migrated: this.migrated, enrollmentHealthy: this.invalidCandidates === 0, invalidCandidates: this.invalidCandidates };
  }
  async close(): Promise<void> {}
}

interface AgentRow {
  id: string; alias: string; public_key: string; configured: boolean; created_at: Date; updated_at: Date;
  state: AgentState; revision: number; episode_count?: number;
}

function rowProjection(row: AgentRow): AgentProjection {
  return {
    id: row.id, alias: row.alias, publicKey: row.public_key, configured: row.configured,
    revision: row.revision, episodeCount: row.state.episodeCount,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    cognitiveSummary: { affect: row.state.affect, stress: row.state.stress, confidence: row.state.confidence, urgency: row.state.urgency, feltSecurity: row.state.feltSecurity },
  };
}

export class PostgresAgentRepository implements AgentRepository {
  private databaseHealthy = true;

  constructor(readonly pool: Pool) {
    this.pool.on("error", () => { this.databaseHealthy = false; });
  }
  static connect(databaseUrl: string): PostgresAgentRepository {
    return new PostgresAgentRepository(new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5_000 }));
  }
  async migrate(): Promise<void> {
    try {
      await runMigrations(this.pool);
      this.databaseHealthy = true;
    } catch (error) {
      this.databaseHealthy = false;
      throw error;
    }
  }

  async enroll(input: EnrollInput): Promise<AgentProjection> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const publicResult = await client.query<AgentRow>("SELECT a.*, s.state, s.revision FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE public_key=$1 FOR UPDATE", [input.publicKey]);
      const aliasResult = await client.query<{ id: string; public_key: string }>("SELECT id, public_key FROM agents WHERE alias=$1", [input.alias]);
      const existing = publicResult.rows[0];
      if (aliasResult.rows[0] && aliasResult.rows[0].public_key !== input.publicKey) throw new RepositoryConflict("ALIAS_CONFLICT");
      if (existing) {
        const updated = await client.query<AgentRow>("UPDATE agents SET alias=$1, configured=TRUE, updated_at=now() WHERE id=$2 RETURNING *", [input.alias, existing.id]);
        await client.query("INSERT INTO audit_events(agent_id,code,details) VALUES($1,'ENROLLMENT_RECONCILED',$2)", [existing.id, { alias: input.alias }]);
        await client.query("COMMIT");
        return rowProjection({ ...updated.rows[0]!, state: existing.state, revision: existing.revision });
      }
      const inserted = await client.query<AgentRow>("INSERT INTO agents(alias,public_key) VALUES($1,$2) RETURNING *", [input.alias, input.publicKey]);
      const agent = inserted.rows[0]!;
      await client.query("INSERT INTO agent_seeds(agent_id,schema_version,key_version,seed) VALUES($1,$2,$3,$4)", [agent.id, input.seed.schemaVersion, input.seed.keyVersion, input.seed]);
      await client.query("INSERT INTO agent_states(agent_id,schema_version,revision,last_sequence,state) VALUES($1,$2,0,0,$3)", [agent.id, input.state.schemaVersion, input.state]);
      await client.query("INSERT INTO agent_narratives(agent_id,version,narrative) VALUES($1,1,$2)", [agent.id, { identityContinuity: true, origin: "environment_enrollment" }]);
      await client.query("INSERT INTO audit_events(agent_id,code,details) VALUES($1,'AGENT_ENROLLED',$2)", [agent.id, { alias: input.alias, seedVersion: input.seed.schemaVersion }]);
      await client.query("COMMIT");
      return rowProjection({ ...agent, state: input.state, revision: 0 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async reconcileConfiguration(publicKeys: string[]): Promise<void> {
    await this.pool.query("UPDATE agents SET configured = (public_key = ANY($1::text[])), updated_at=now()", [publicKeys]);
  }
  async setEnrollmentStatus(issueCodes: string[]): Promise<void> {
    await this.pool.query("INSERT INTO system_status(key,value) VALUES('enrollment',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [{ issueCodes, invalidCandidates: issueCodes.length }]);
  }
  async list(): Promise<AgentProjection[]> {
    const result = await this.pool.query<AgentRow>("SELECT a.*, s.state, s.revision FROM agents a JOIN agent_states s ON s.agent_id=a.id ORDER BY a.alias");
    return result.rows.map(rowProjection);
  }
  async get(idOrPublicKey: string): Promise<AgentProjection | undefined> {
    const result = await this.pool.query<AgentRow>("SELECT a.*, s.state, s.revision FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id::text=$1 OR a.public_key=$1", [idOrPublicKey]);
    return result.rows[0] ? rowProjection(result.rows[0]) : undefined;
  }

  async applyEvolution(idOrPublicKey: string, event: AgentEvent): Promise<EvolutionReceipt> {
    const client = await this.pool.connect();
    const payloadHash = hashEvent(event);
    let transactionActive = false;
    let resolvedAgentId: string | null = null;
    try {
      await client.query("BEGIN");
      transactionActive = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.eventId]);
      const locked = await client.query<{ id: string; seed: CognitiveSeed; state: AgentState; last_sequence: string }>(
        "SELECT a.id,se.seed,st.state,st.last_sequence FROM agents a JOIN agent_seeds se ON se.agent_id=a.id JOIN agent_states st ON st.agent_id=a.id WHERE a.id::text=$1 OR a.public_key=$1 FOR UPDATE OF st",
        [idOrPublicKey],
      );
      const row = locked.rows[0];
      if (!row) throw new RepositoryConflict("AGENT_NOT_FOUND");
      resolvedAgentId = row.id;
      const duplicate = await client.query<{ agent_id: string; payload_hash: string; result: EvolutionReceipt }>("SELECT agent_id,payload_hash,result FROM agent_episodes WHERE event_id=$1", [event.eventId]);
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].agent_id !== row.id || duplicate.rows[0].payload_hash !== payloadHash) throw new RepositoryConflict("EVENT_ID_CONFLICT");
        await client.query("COMMIT");
        transactionActive = false;
        return { ...duplicate.rows[0].result, duplicate: true };
      }
      if (event.sequence !== Number(row.last_sequence) + 1) throw new RepositoryConflict("SEQUENCE_CONFLICT");
      const memoryRows = await client.query<{ memory: AgentMemory }>("SELECT memory FROM agent_memories WHERE agent_id=$1 ORDER BY occurred_at DESC LIMIT 200", [row.id]);
      const result: EvolutionResult = evolveAgent(row.seed, row.state, memoryRows.rows.map((item) => item.memory), event);
      const receipt: EvolutionReceipt = { eventId: event.eventId, agentId: row.id, sequence: event.sequence, revision: result.state.revision, duplicate: false, actionTendency: result.actionTendency, deliberated: result.trace.deliberated };
      await client.query("INSERT INTO agent_episodes(agent_id,event_id,sequence,payload_hash,event,trace,result) VALUES($1,$2,$3,$4,$5,$6,$7)", [row.id, event.eventId, event.sequence, payloadHash, event, result.trace, receipt]);
      const memory = result.memories[result.memories.length - 1]!;
      await client.query("INSERT INTO agent_memories(agent_id,memory_id,kind,context_tag,occurred_at,memory) VALUES($1,$2,$3,$4,$5,$6)", [row.id, memory.id, memory.kind, memory.contextTag, memory.occurredAt, memory]);
      await client.query("UPDATE agent_states SET schema_version=$2,revision=$3,last_sequence=$4,state=$5,updated_at=now() WHERE agent_id=$1", [row.id, result.state.schemaVersion, result.state.revision, event.sequence, result.state]);
      await client.query("INSERT INTO agent_evaluations(agent_id,schema_version,metrics) VALUES($1,2,$2) ON CONFLICT(agent_id) DO UPDATE SET schema_version=EXCLUDED.schema_version,metrics=EXCLUDED.metrics,updated_at=now()", [row.id, result.metrics]);
      await client.query("INSERT INTO audit_events(agent_id,code,details) VALUES($1,'EPISODE_APPLIED',$2)", [row.id, { eventId: event.eventId, sequence: event.sequence, revision: result.state.revision }]);
      await client.query("COMMIT");
      transactionActive = false;
      this.databaseHealthy = true;
      return receipt;
    } catch (error) {
      if (transactionActive) await client.query("ROLLBACK");
      if (error instanceof RepositoryConflict) {
        await client.query("INSERT INTO audit_events(agent_id,code,details) VALUES($1,$2,'{}'::jsonb)", [resolvedAgentId, error.code]).catch(() => undefined);
      }
      throw error;
    } finally { client.release(); }
  }

  async metrics(): Promise<RepositoryMetrics> {
    const result = await this.pool.query<{ agents: string; configured: string; episodes: string; memories: string; invalid: number }>(`SELECT
      (SELECT count(*) FROM agents)::text agents,
      (SELECT count(*) FROM agents WHERE configured)::text configured,
      (SELECT count(*) FROM agent_episodes)::text episodes,
      (SELECT count(*) FROM agent_memories)::text memories,
      COALESCE((SELECT (value->>'invalidCandidates')::int FROM system_status WHERE key='enrollment'),0) invalid`);
    const row = result.rows[0]!;
    return { agents: Number(row.agents), configuredAgents: Number(row.configured), episodes: Number(row.episodes), memories: Number(row.memories), invalidCandidates: row.invalid };
  }
  async readiness(): Promise<RepositoryReadiness> {
    try {
      const migrated = await this.pool.query("SELECT 1 FROM schema_migrations WHERE version=1");
      const metrics = await this.metrics();
      this.databaseHealthy = true;
      return { database: true, migrated: migrated.rowCount === 1, enrollmentHealthy: metrics.invalidCandidates === 0, invalidCandidates: metrics.invalidCandidates };
    } catch {
      this.databaseHealthy = false;
      return { database: false, migrated: false, enrollmentHealthy: false, invalidCandidates: 0 };
    }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
