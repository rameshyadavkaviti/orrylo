import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("issuance migration extends the existing payment order instead of duplicating it", async () => {
  const sql = await readFile(
    new URL("../db/migrations/016_mainnet_token_issuance.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ALTER TABLE mainnet_token_orders/);
  assert.doesNotMatch(sql, /CREATE TABLE mainnet_creation_orders/);
  assert.match(sql, /CREATE TABLE mainnet_issuance_attempts/);
  assert.match(sql, /state = 'reconciling'/);
  assert.match(sql, /Mainnet ledger evidence is append-only/);
});
