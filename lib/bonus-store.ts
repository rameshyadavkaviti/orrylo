import "server-only";
import { Pool } from "pg";
import { BONUS_THRESHOLD_RYLO, bonusForQuantity } from "./bonus";

export const BONUS_CAMPAIGN_ID = "rylo_bonus_v1";
const maximumCampaignRylo = process.env.RYLO_BONUS_CAMPAIGN_MAX_RYLO || "0";
export const BONUS_ENABLED = process.env.RYLO_BONUS_CAMPAIGN_ACTIVE === "true"
  && process.env.RYLO_BONUS_FULFILLMENT_READY === "true"
  && Boolean(process.env.DATABASE_URL) && Number(maximumCampaignRylo) > 0;

declare global { var __orryloBonusPool: Pool | undefined; var __orryloBonusInit: Promise<void> | undefined; }

function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("Bonus database unavailable.");
  if (!globalThis.__orryloBonusPool) {
    globalThis.__orryloBonusPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4, connectionTimeoutMillis: 4000, idleTimeoutMillis: 15000,
      application_name: "orrylo_bonus_web"
    });
  }
  return globalThis.__orryloBonusPool;
}

const schema = [
  "CREATE TABLE IF NOT EXISTS rylo_bonus_purchases (",
  "purchase_hash TEXT PRIMARY KEY CHECK (purchase_hash ~ '^[a-f0-9]{64}$'),",
  "campaign_id TEXT NOT NULL,",
  "buyer TEXT NOT NULL CHECK (length(buyer) = 56),",
  "quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1001 AND 10000),",
  "bonus_amount TEXT NOT NULL,",
  "status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','verified','paying','paid','review','rejected','expired')),",
  "payout_hash TEXT UNIQUE, payout_xdr TEXT, rejection_reason TEXT,",
  "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
  "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS rylo_bonus_pending_idx ON rylo_bonus_purchases(created_at) WHERE status IN ('prepared','verified','paying')",
  "CREATE UNIQUE INDEX IF NOT EXISTS rylo_bonus_one_wallet_per_campaign ON rylo_bonus_purchases(campaign_id, buyer) WHERE status IN ('verified','paying','paid','review')"
];

async function ready() {
  if (!globalThis.__orryloBonusInit) {
    globalThis.__orryloBonusInit = (async () => {
      for (const statement of schema) await db().query(statement);
    })().catch((error) => { globalThis.__orryloBonusInit = undefined; throw error; });
  }
  await globalThis.__orryloBonusInit;
}

export function eligibleBonus(quantity: number) {
  return Number.isSafeInteger(quantity) && quantity > BONUS_THRESHOLD_RYLO
    ? bonusForQuantity(quantity).toFixed(7) : null;
}

export async function recordWebsitePurchase(purchaseHash: string, buyer: string, quantity: number) {
  if (!BONUS_ENABLED) return { bonusRegistered: false, bonusAmount: null };
  const bonus = eligibleBonus(quantity);
  if (!bonus) return { bonusRegistered: false, bonusAmount: null };
  if (!/^[a-f0-9]{64}$/.test(purchaseHash) || !/^G[A-Z2-7]{55}$/.test(buyer)) {
    throw new Error("Invalid bonus purchase record.");
  }
  await ready();
  const excluded = new Set((process.env.RYLO_BONUS_EXCLUDED_PUBLIC_KEYS || "").split(",").map(x=>x.trim()).filter(Boolean));
  if (excluded.has(buyer)) throw new Error("This wallet is excluded from the bonus promotion.");
  const conn = await db().connect();
  try {
    await conn.query("BEGIN");
    await conn.query("SELECT pg_advisory_xact_lock(98754633)");
    await conn.query("UPDATE rylo_bonus_purchases SET status='expired',updated_at=NOW() WHERE status='prepared' AND created_at < NOW() - INTERVAL '15 minutes'");
    const current = await conn.query(
      "SELECT COALESCE(SUM(bonus_amount::numeric),0)::text AS reserved FROM rylo_bonus_purchases WHERE campaign_id=$1 AND status IN ('prepared','verified','paying','paid','review')",
      [BONUS_CAMPAIGN_ID]
    );
    if (Number(current.rows[0].reserved) + Number(bonus) > Number(maximumCampaignRylo)) {
      throw new Error("Bonus campaign allocation is currently fully reserved.");
    }
    await conn.query(
      "INSERT INTO rylo_bonus_purchases (purchase_hash, campaign_id, buyer, quantity, bonus_amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (purchase_hash) DO NOTHING",
      [purchaseHash, BONUS_CAMPAIGN_ID, buyer, quantity, bonus]
    );
    await conn.query("COMMIT");
  } catch (error) {
    await conn.query("ROLLBACK");
    throw error;
  } finally {
    conn.release();
  }
  return { bonusRegistered: true, bonusAmount: bonus };
}

export async function lookupBonus(purchaseHash: string) {
  if (!/^[a-f0-9]{64}$/.test(purchaseHash) || !process.env.DATABASE_URL) return null;
  await ready();
  const rows = await db().query(
    "SELECT status, bonus_amount, payout_hash, rejection_reason FROM rylo_bonus_purchases WHERE purchase_hash=$1 AND campaign_id=$2",
    [purchaseHash, BONUS_CAMPAIGN_ID]
  );
  return rows.rows[0] || null;
}
