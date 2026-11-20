import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { RepositoryConflict, type AgentRepository } from "../db/repository.js";
import type { AgentEvent, EventType } from "../evolution/types.js";
import { isAuthorized } from "./auth.js";

interface ServerOptions {
  config: AppConfig;
  repository: AgentRepository;
  logger?: boolean;
}

const eventTypes = new Set<EventType>(["market_observation", "decision_outcome", "social_signal", "operator_feedback", "evaluation_probe"]);
const allowedEventKeys = new Set(["eventId", "agentId", "publicKey", "type", "sequence", "occurredAt", "source", "context", "outcome"]);
const commonContext = ["contextTag", "uncertainty", "stakes", "goalConflict", "accountability", "timePressure"] as const;
const marketContext = ["priceChange", "scarcity", "rivalGain", "liquidityStress"] as const;
const contextKeys: Record<EventType, ReadonlySet<string>> = {
  market_observation: new Set([...commonContext, ...marketContext]),
  decision_outcome: new Set([...commonContext, ...marketContext]),
  social_signal: new Set([...commonContext, "socialReliability", "rivalGain"]),
  operator_feedback: new Set([...commonContext, "valence"]),
  evaluation_probe: new Set([...commonContext, ...marketContext, "socialReliability", "valence"]),
};
const unitFields = new Set(["uncertainty", "stakes", "goalConflict", "accountability", "timePressure", "scarcity", "rivalGain", "liquidityStress"]);
const signedFields = new Set(["priceChange", "socialReliability", "valence"]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeContext(type: EventType, value: unknown): Record<string, unknown> | undefined {
  if (!object(value)) return undefined;
  const allowed = contextKeys[type];
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "contextTag") {
      if (typeof raw !== "string" || raw.length < 1 || raw.length > 64) return undefined;
      sanitized[key] = raw;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
    if (unitFields.has(key) && (raw < 0 || raw > 1)) return undefined;
    if (signedFields.has(key) && (raw < -1 || raw > 1)) return undefined;
    sanitized[key] = raw;
  }
  return sanitized;
}

function sanitizeOutcome(type: EventType, value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return {};
  if (!object(value)) return undefined;
  const rewardAllowed = type === "decision_outcome" || type === "operator_feedback" || type === "evaluation_probe";
  if (Object.keys(value).some((key) => key !== "reward") || (!rewardAllowed && Object.keys(value).length > 0)) return undefined;
  if (value.reward === undefined) return {};
  if (typeof value.reward !== "number" || !Number.isFinite(value.reward) || value.reward < -1 || value.reward > 1) return undefined;
  return { reward: value.reward };
}

function parseEvent(body: unknown): { target: string; event: AgentEvent } | undefined {
  if (!object(body) || Object.keys(body).some((key) => !allowedEventKeys.has(key))) return undefined;
  const { eventId, agentId, publicKey, type, sequence, occurredAt, source, context, outcome } = body;
  const targets = [agentId, publicKey].filter((value) => typeof value === "string" && value.length > 0);
  if (targets.length !== 1) return undefined;
  if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 128) return undefined;
  if (typeof type !== "string" || !eventTypes.has(type as EventType)) return undefined;
  if (!Number.isInteger(sequence) || (sequence as number) < 1) return undefined;
  if (typeof occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) return undefined;
  if (typeof source !== "string" || source.length < 1 || source.length > 64) return undefined;
  const cleanContext = sanitizeContext(type as EventType, context);
  const cleanOutcome = sanitizeOutcome(type as EventType, outcome);
  if (!cleanContext || !cleanOutcome) return undefined;
  return {
    target: targets[0] as string,
    event: { eventId, type: type as EventType, sequence: sequence as number, occurredAt, source, context: cleanContext, ...(Object.keys(cleanOutcome).length ? { outcome: cleanOutcome } : {}) },
  };
}

export function buildServer({ config, repository, logger = true }: ServerOptions): FastifyInstance {
  const server = Fastify({ logger, bodyLimit: 65_536 });

  server.get("/healthz", async () => ({ ok: true, service: "orrylo-agent-core" }));
  server.get("/readyz", async (_request, reply) => {
    const readiness = await repository.readiness();
    const ready = readiness.database && readiness.migrated && readiness.enrollmentHealthy && !config.paused;
    return reply.code(ready ? 200 : 503).send({
      ready,
      database: readiness.database,
      migrated: readiness.migrated,
      enrollmentHealthy: readiness.enrollmentHealthy,
      invalidCandidates: readiness.invalidCandidates,
      paused: config.paused,
    });
  });

  void server.register(async (privateServer) => {
    privateServer.addHook("onRequest", async (request, reply) => {
      if (!isAuthorized(request.headers.authorization, config.internalApiKey, config.internalApiKeyPrevious)) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
    });
    privateServer.get("/agents", async () => ({ agents: await repository.list() }));
    privateServer.get<{ Params: { id: string } }>("/agents/:id", async (request, reply) => {
      const agent = await repository.get(request.params.id);
      return agent ? { agent } : reply.code(404).send({ error: "AGENT_NOT_FOUND" });
    });
    privateServer.get("/metrics", async () => ({ metrics: await repository.metrics() }));
    privateServer.post("/events", async (request, reply) => {
      if (config.paused) return reply.code(503).send({ error: "PAUSED" });
      const parsed = parseEvent(request.body);
      if (!parsed) return reply.code(400).send({ error: "INVALID_EVENT" });
      try {
        const receipt = await repository.applyEvolution(parsed.target, parsed.event);
        return reply.code(receipt.duplicate ? 200 : 201).send(receipt);
      } catch (error) {
        if (error instanceof RepositoryConflict) {
          const status = error.code === "AGENT_NOT_FOUND" ? 404 : 409;
          return reply.code(status).send({ error: error.code });
        }
        request.log.error({ err: error instanceof Error ? error.name : "unknown" }, "event ingestion failed");
        return reply.code(500).send({ error: "INTERNAL_ERROR" });
      }
    });
  }, { prefix: "/v1" });

  server.setErrorHandler((error, _request, reply) => {
    const candidate = object(error) && typeof error.statusCode === "number" ? error.statusCode : 500;
    const status = candidate >= 400 && candidate < 500 ? candidate : 500;
    reply.code(status).send({ error: status === 413 ? "PAYLOAD_TOO_LARGE" : status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST" });
  });
  return server;
}
