import { Pool } from "pg";
import { Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const issuer = "GDG7SGYLJQBLSN55ASHD7VCXYBEPYDK4EUIUTW6XWTBUDUHXK6ORRYLO";
const network = "https://horizon.stellar.org";
const campaign = "rylo_bonus_v1";
const active = process.env.RYLO_BONUS_PAYOUT_ENABLED === "true";
const pollingMs = 15000;
const runOnce = process.env.RYLO_BONUS_RUN_ONCE === "true";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function units(amount) {
  const value = String(amount);
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("invalid stellar decimal");
  const [a,b=""] = value.split(".");
  return BigInt(a)*10000000n + BigInt(b.padEnd(7,"0"));
}
function expectedPublicKey() {
  const seed = process.env.RYLO_BONUS_SECRET;
  if (!seed) throw new Error("Missing RYLO_BONUS_SECRET");
  const kp = Keypair.fromSecret(seed);
  if (!process.env.RYLO_BONUS_PUBLIC_KEY || kp.publicKey() !== process.env.RYLO_BONUS_PUBLIC_KEY)
    throw new Error("Bonus source public key mismatch");
  if (kp.publicKey() === issuer) throw new Error("Do not distribute from issuer account");
  return kp;
}
async function horizon(url) {
  const r = await fetch(network + url, {signal: AbortSignal.timeout(10000),cache:"no-store"});
  if (r.status===404) return null;
  if (!r.ok) throw new Error("Horizon error " + r.status);
  return r.json();
}
async function receiptIsEligible(row) {
  const transaction = await horizon("/transactions/" + row.purchase_hash);
  if (!transaction) return null;
  if (transaction.successful !== true || transaction.source_account !== row.buyer) return false;
  const operations = await horizon("/transactions/" + row.purchase_hash + "/operations?limit=200");
  const records = operations?._embedded?.records;
  if (!Array.isArray(records) || records.length !== 1) return false;
  const op = records[0];
  return op.type === "path_payment_strict_receive"
    && op.from === row.buyer && op.to === row.buyer
    && op.source_asset_type === "native"
    && op.asset_type === "credit_alphanum4"
    && op.asset_code === "RYLO" && op.asset_issuer === issuer
    && units(op.amount) === BigInt(row.quantity)*10000000n
    && units(op.source_max) <= BigInt(row.quantity)*1000000n
    && units(op.source_amount) > 0n;
}
async function main() {
  if (!active) {
    console.log("RYLO bonus payout service disabled. No transaction signing.");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  if (process.env.RYLO_BONUS_CAMPAIGN_ACTIVE !== "true") throw new Error("Campaign activation flag is false");
  const budget = process.env.RYLO_BONUS_CAMPAIGN_MAX_RYLO;
  if (!budget || units(budget) <= 0n) throw new Error("Campaign cap required");
  const signer = expectedPublicKey();
  const server = new Horizon.Server(network);
  const asset = new Asset("RYLO",issuer);
  const excluded = new Set((process.env.RYLO_BONUS_EXCLUDED_PUBLIC_KEYS || "").split(",").map((s)=>s.trim()).filter(Boolean));
  excluded.add(issuer); excluded.add(signer.publicKey());
  const db = new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,application_name:"orrylo_bonus_payout"});
  console.log("RYLO bonus worker ready; source "+signer.publicKey().slice(0,8)+"…, capped campaign, no source secrets in logs.");
  let stopped = false;
  for (const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>{stopped=true;});
  while(!stopped) {
    let client;
    try {
      client = await db.connect();
      const {rows} = await client.query("SELECT pg_try_advisory_lock(98754632) AS acquired");
      if (rows[0]?.acquired) {
        try {
          const pending = await client.query(
            "SELECT * FROM rylo_bonus_purchases WHERE campaign_id=$1 AND status='prepared' ORDER BY created_at LIMIT 40",
            [campaign]
          );
          for(const record of pending.rows) {
            try {
              const verified=await receiptIsEligible(record);
              if(verified === null) {
                if(Date.now()-new Date(record.created_at).getTime()>900000) {
                  await client.query("UPDATE rylo_bonus_purchases SET status='expired',updated_at=NOW() WHERE purchase_hash=$1 AND status='prepared'",[record.purchase_hash]);
                }
                continue;
              }
              if(!verified || excluded.has(record.buyer)) {
                await client.query("UPDATE rylo_bonus_purchases SET status='rejected',rejection_reason=$2,updated_at=NOW() WHERE purchase_hash=$1 AND status='prepared'",[record.purchase_hash,verified?"Excluded account":"Purchase could not be verified"]);
                continue;
              }
              try {
                await client.query("UPDATE rylo_bonus_purchases SET status='verified',updated_at=NOW() WHERE purchase_hash=$1 AND status='prepared'",[record.purchase_hash]);
              } catch (error) {
                if(error?.code!=="23505") throw error;
                await client.query("UPDATE rylo_bonus_purchases SET status='rejected',rejection_reason='One bonus per wallet per campaign',updated_at=NOW() WHERE purchase_hash=$1 AND status='prepared'",[record.purchase_hash]);
              }
            } catch(err) { console.error("RYLO bonus verification deferred",err?.message?.slice(0,160)); }
          }
          const inFlight=await client.query(
            "SELECT * FROM rylo_bonus_purchases WHERE campaign_id=$1 AND status='paying' ORDER BY updated_at LIMIT 30",[campaign]
          );
          for(const record of inFlight.rows) {
            try {
              const paid = await horizon("/transactions/"+record.payout_hash);
              if(paid?.successful === true && paid.source_account===signer.publicKey()) {
                await client.query("UPDATE rylo_bonus_purchases SET status='paid',payout_xdr=NULL,updated_at=NOW() WHERE purchase_hash=$1 AND status='paying'",[record.purchase_hash]);
              } else if(paid) {
                await client.query("UPDATE rylo_bonus_purchases SET status='review',updated_at=NOW() WHERE purchase_hash=$1 AND status='paying'",[record.purchase_hash]);
              } else if(Date.now()-new Date(record.updated_at).getTime()>175000) {
                await client.query("UPDATE rylo_bonus_purchases SET status='review',updated_at=NOW() WHERE purchase_hash=$1 AND status='paying'",[record.purchase_hash]);
              } else if(record.payout_xdr) {
                // Retry exactly the same signed envelope, never a newly signed payment.
                const tx=TransactionBuilder.fromXDR(record.payout_xdr,Networks.PUBLIC);
                try { await server.submitTransaction(tx); } catch {}
              }
            } catch(err) { console.error("RYLO payout reconciliation deferred",err?.message?.slice(0,160)); }
          }
          const eligible=await client.query(
            "SELECT * FROM rylo_bonus_purchases WHERE campaign_id=$1 AND status='verified' ORDER BY created_at LIMIT 20",[campaign]
          );
          for(const record of eligible.rows) {
            try {
              const {rows:totalRows}=await client.query(
                "SELECT COALESCE(SUM(bonus_amount::numeric),0)::text AS reserved FROM rylo_bonus_purchases WHERE campaign_id=$1 AND status IN ('paying','paid','review')",
                [campaign]
              );
              if(units(totalRows[0].reserved)+units(record.bonus_amount)>units(budget)) {
                console.error("RYLO campaign budget reached; retaining verified claim");
                continue;
              }
              const account=await server.loadAccount(signer.publicKey());
              const native=account.balances.find(b=>b.asset_type==="native");
              const token=account.balances.find(b=>b.asset_code==="RYLO" && b.asset_issuer===issuer);
              // Safety reserve for transaction fees and Stellar minimum account balance.
              if(!native || Number(native.balance)<2.0 || !token ||
                 units(token.balance)<units(record.bonus_amount) ||
                 token.is_authorized===false) {
                console.warn("RYLO bonus distributor balance, authorization or reserves insufficient");
                continue;
              }
              const tx=new TransactionBuilder(account,{fee:"100",networkPassphrase:Networks.PUBLIC})
                .addOperation(Operation.payment({destination:record.buyer,asset,amount:record.bonus_amount}))
                .addMemo(Memo.hash(Buffer.from(record.purchase_hash,"hex")))
                .setTimeout(150).build();
              tx.sign(signer);
              const xdr=tx.toXDR(), hash=tx.hash().toString("hex");
              await client.query("UPDATE rylo_bonus_purchases SET status='paying',payout_hash=$2,payout_xdr=$3,updated_at=NOW() WHERE purchase_hash=$1 AND status='verified'",[record.purchase_hash,hash,xdr]);
              try {
                const response=await server.submitTransaction(tx);
                if(response?.successful === true || response?.hash === hash) {
                  await client.query("UPDATE rylo_bonus_purchases SET status='paid',payout_xdr=NULL,updated_at=NOW() WHERE purchase_hash=$1 AND status='paying'",[record.purchase_hash]);
                }
              } catch(err) {
                // Remain in 'paying' until the identical signed transaction is reconciled.
                console.warn("RYLO payout submission uncertain; retaining exact signed transaction hash");
              }
            } catch(err) { console.error("RYLO bonus payout deferred",err?.message?.slice(0,180)); }
          }
        } finally {
          await client.query("SELECT pg_advisory_unlock(98754632)");
        }
      }
    } catch(error) { console.error("RYLO bonus worker cycle failed",error?.message?.slice(0,180)); }
    finally {client?.release();}
    if(runOnce) stopped = true;
    if(!stopped) await sleep(pollingMs);
  }
  await db.end();
}
main().catch(e=>{console.error("RYLO bonus worker refused to start:",e.message);process.exitCode=1;});
