/** Owner-operated Mainnet account configuration. Never run in a server. */
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const ISSUER = "GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS";
const HOME_DOMAIN = "assets.orrylo.com";
const secretFile = process.env.ORRYLO_MAINNET_ISSUER_SECRET_FILE;
if (!secretFile) throw Error("Set ORRYLO_MAINNET_ISSUER_SECRET_FILE to a local secret file.");
const keypair = Keypair.fromSecret(fs.readFileSync(secretFile, "utf8").trim());
if (keypair.publicKey() !== ISSUER) throw Error("Local key is not the Mainnet shared issuer.");
const horizon = new Horizon.Server("https://horizon.stellar.org");
const account = await horizon.loadAccount(ISSUER);
console.log("Issuer:", ISSUER);
console.log("Current home_domain:", account.home_domain || "(unset)");
if (account.home_domain === HOME_DOMAIN) {
  console.log("Already configured, nothing to submit.");
  process.exit(0);
}
const weight = account.signers.find((s) => s.key === ISSUER)?.weight ?? 0;
if (account.thresholds.high_threshold < 1 || weight < account.thresholds.high_threshold) {
  throw Error("Unsafe or unsupported issuer authority. Set Options requires a valid issuer signer and high threshold.");
}
const tx = new TransactionBuilder(account, {
  fee: "100", networkPassphrase: Networks.PUBLIC,
}).addOperation(Operation.setOptions({ homeDomain: HOME_DOMAIN }))
  .setTimeout(180).build();
console.log("Prepared: Stellar Mainnet Set Options home_domain=" + HOME_DOMAIN);
console.log("No payment, token issuance, signer or threshold changes.");
if (!process.argv.includes("--submit")) {
  console.log("DRY RUN. Add --submit to authorize transaction submission.");
  process.exit(0);
}
const rl = readline.createInterface({ input: stdin, output: stdout });
const confirmation = await rl.question("Type SET-HOME-DOMAIN to submit: ");
rl.close();
if (confirmation !== "SET-HOME-DOMAIN") process.exit(0);
tx.sign(keypair);
const submitted = await horizon.submitTransaction(tx);
console.log("Submitted transaction hash:", submitted.hash);
const updated = await horizon.loadAccount(ISSUER);
if (updated.home_domain !== HOME_DOMAIN) throw Error("Recheck ledger: home_domain not yet confirmed.");
console.log("Confirmed home_domain:", updated.home_domain);
