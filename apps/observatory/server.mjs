import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { createBalanceReader } from "./balances.mjs";

const { Pool } = pg;
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const username = process.env.OBSERVATORY_USERNAME;
const password = process.env.OBSERVATORY_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const readBalances = createBalanceReader({
  horizonUrl: (process.env.ORRYLO_HORIZON_URL || "https://horizon.stellar.org").replace(/\/$/, ""),
  ryloCode: process.env.ORRYLO_RYLO_CODE || "RYLO",
  ryloIssuer: process.env.ORRYLO_RYLO_ISSUER || "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO"
});
if (!username || !password || password.length < 24 || !databaseUrl) {
  console.error("OBSERVATORY_CONFIG_MISSING: configure DATABASE_URL, OBSERVATORY_USERNAME, and a >=24-character OBSERVATORY_PASSWORD");
  process.exit(1);
}
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  options: "-c default_transaction_read_only=on -c statement_timeout=8000"
});
pool.on("error", (error) => console.error("OBSERVATORY_DB_IDLE_ERROR", error.name));
const fingerprint = (value) => createHash("sha256").update(value).digest();
const expected = fingerprint(username + "\0" + password);
const attempts = new Map();
function authorized(req) {
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Basic ")) return false;
  let credentials;
  try { credentials = Buffer.from(hdr.slice(6), "base64").toString("utf8"); }
  catch { return false; }
  const sep = credentials.indexOf(":");
  if (sep < 0) return false;
  const received = fingerprint(credentials.slice(0, sep) + "\0" + credentials.slice(sep + 1));
  return timingSafeEqual(expected, received);
}
function baseHeaders(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, baseHeaders(type));
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function json(res, status, body) { send(res, status, body); }
function clean(value) { return value instanceof Date ? value.toISOString() : value; }
async function snapshot() {
  const [counts, agents, events, audit, hourly, recentMarket] = await Promise.all([
    pool.query("SELECT (SELECT count(*)::int FROM agents) AS agents, (SELECT count(*)::int FROM agents WHERE configured) AS configured, (SELECT count(*)::int FROM agent_episodes) AS episodes, (SELECT count(*)::int FROM agent_memories) AS memories, (SELECT count(*)::int FROM agent_episodes WHERE created_at > now() - interval '1 hour') AS episodes_hour, (SELECT max(created_at) FROM agent_episodes) AS last_decision_at, (SELECT count(*)::int FROM agent_episodes WHERE created_at > now() - interval '5 minutes' AND event->>'type'='market_observation') AS recent_decisions, (SELECT count(*)::int FROM audit_events WHERE code='EXECUTION_SUBMITTED' AND created_at > now() - interval '24 hours') AS submitted_day, (SELECT count(*)::int FROM audit_events WHERE code NOT IN ('AGENT_ENROLLED','ENROLLMENT_RECONCILED','EPISODE_APPLIED') AND created_at > now() - interval '24 hours') AS alerts_day"),
    pool.query("SELECT a.id, a.alias, a.public_key, a.configured, a.updated_at, s.revision, s.state->>'affect' AS affect, s.state->>'stress' AS stress, s.state->>'confidence' AS confidence, s.state->>'urgency' AS urgency, s.state->>'feltSecurity' AS security, s.state->>'episodeCount' AS episode_count, last_episode.action, last_episode.last_decision, ev.metrics FROM agents a JOIN agent_states s ON s.agent_id=a.id LEFT JOIN agent_evaluations ev ON ev.agent_id=a.id LEFT JOIN LATERAL (SELECT e.result->>'actionTendency' AS action, e.created_at AS last_decision FROM agent_episodes e WHERE e.agent_id=a.id ORDER BY e.sequence DESC LIMIT 1) last_episode ON true ORDER BY a.alias ASC"),
    pool.query("SELECT e.id, e.created_at, a.alias, a.id AS agent_id, e.sequence, e.event->>'type' AS type, e.event->>'source' AS source, e.result->>'actionTendency' AS action, e.trace->>'deliberated' AS deliberated, e.trace->>'decisionLatencyMs' AS latency_ms, e.trace->'appraisal' AS appraisal FROM agent_episodes e JOIN agents a ON a.id=e.agent_id ORDER BY e.created_at DESC, e.sequence DESC LIMIT 250"),
    pool.query("SELECT ae.created_at, coalesce(a.alias,'system') AS alias, ae.code FROM audit_events ae LEFT JOIN agents a ON a.id=ae.agent_id WHERE ae.code NOT IN ('AGENT_ENROLLED','ENROLLMENT_RECONCILED','EPISODE_APPLIED') ORDER BY ae.created_at DESC LIMIT 35"),
    pool.query("SELECT date_trunc('hour',created_at) AS bucket, count(*)::int AS episodes, count(*) FILTER (WHERE result->>'actionTendency'='buy')::int AS buy, count(*) FILTER (WHERE result->>'actionTendency'='sell')::int AS sell, count(*) FILTER (WHERE result->>'actionTendency'='hold')::int AS hold FROM agent_episodes WHERE created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 1 ASC"),
    pool.query("SELECT created_at, event->'context' AS context FROM agent_episodes WHERE event->>'type'='market_observation' ORDER BY created_at DESC LIMIT 1")
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    counters: counts.rows[0],
    agents: agents.rows,
    events: events.rows,
    alerts: audit.rows,
    hourly: hourly.rows,
    market: recentMarket.rows[0] || null,
    decisionStatus: { stored: Number(counts.rows[0].episodes || 0), lastPersistedAt: counts.rows[0].last_decision_at, recent5m: counts.rows[0].recent_decisions, submitted24h: counts.rows[0].submitted_day },
    execution: { status: "partial", note: "EXECUTION_SUBMITTED records track submitted transactions, not confirmed fills. Blocked attempts are not yet individually persisted." }
  };
}
async function agentDetail(id) {
  const [profile, episodes, memories] = await Promise.all([
    pool.query("SELECT a.id,a.alias,a.public_key,a.configured,a.created_at,a.updated_at,s.revision,s.state,se.seed,ev.metrics FROM agents a JOIN agent_states s ON s.agent_id=a.id LEFT JOIN agent_seeds se ON se.agent_id=a.id LEFT JOIN agent_evaluations ev ON ev.agent_id=a.id WHERE a.id=$1", [id]),
    pool.query("SELECT created_at,sequence,event,trace,result FROM agent_episodes WHERE agent_id=$1 ORDER BY sequence DESC LIMIT 20", [id]),
    pool.query("SELECT kind,context_tag,occurred_at,valence,salience,memory FROM (SELECT kind,context_tag,occurred_at,(memory->>'valence') AS valence,(memory->>'salience') AS salience,memory FROM agent_memories WHERE agent_id=$1 ORDER BY occurred_at DESC LIMIT 15) x", [id])
  ]);
  return profile.rows.length ? { agent: profile.rows[0], episodes: episodes.rows, memories: memories.rows } : null;
}
const assets = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"]
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, service: "orrylo-observatory" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
    const addr = req.socket.remoteAddress || "unknown";
    const entry = attempts.get(addr);
    if (entry && entry.until < Date.now()) attempts.delete(addr);
    if (entry && entry.count > 35 && entry.until >= Date.now()) return json(res, 429, { error: "TOO_MANY_ATTEMPTS" });
    if (!authorized(req)) {
      const current = attempts.get(addr) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
      attempts.set(addr, { count: current.count + 1, until: current.until });
      res.writeHead(401, { ...baseHeaders("application/json; charset=utf-8"), "WWW-Authenticate": 'Basic realm="ORRYLO Observatory", charset="UTF-8"' });
      return res.end(JSON.stringify({ error: "AUTH_REQUIRED" }));
    }
    attempts.delete(addr);
    if (url.pathname === "/api/snapshot") return json(res, 200, await snapshot());
    if (url.pathname === "/api/balances") {
      const list = await pool.query("SELECT public_key FROM agents ORDER BY alias");
      return json(res, 200, await readBalances(list.rows));
    }
    if (url.pathname === "/api/agent") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json(res, 400, { error: "INVALID_AGENT_ID" });
      const detail = await agentDetail(id);
      return detail ? json(res, 200, detail) : json(res, 404, { error: "AGENT_NOT_FOUND" });
    }
    if (!(url.pathname in assets)) return json(res, 404, { error: "NOT_FOUND" });
    const [path, type] = assets[url.pathname];
    const buffer = await readFile(join(root, path));
    res.writeHead(200, baseHeaders(type));
    return res.end(req.method === "HEAD" ? "" : buffer);
  } catch (error) {
    console.error("OBSERVATORY_REQUEST_ERROR", error instanceof Error ? error.name : "UnknownError");
    if (!res.headersSent) return json(res, 503, { error: "DATA_UNAVAILABLE", message: "Read-only telemetry is temporarily unavailable." });
    res.end();
  }
}).listen(port, "0.0.0.0", () => console.log("ORRYLO_OBSERVATORY_READY port=" + port));
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });

// Startup self-test exercises every dashboard SELECT before declaring telemetry usable.
snapshot().then((data) => console.log("OBSERVATORY_DB_VERIFIED agents=" + data.counters.agents + " episodes=" + data.counters.episodes)).catch((error) => {
  console.error("OBSERVATORY_DB_CHECK_FAILED", error instanceof Error ? error.message : "UnknownError");
  process.exit(1);
});
