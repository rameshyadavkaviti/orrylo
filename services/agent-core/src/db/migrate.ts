import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./migrations/001_initial.sql", import.meta.url), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    const existing = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE version = 1");
    if (existing.rows[0] && existing.rows[0].checksum !== checksum) throw new Error("Migration 1 checksum mismatch");
    await client.query(
      "INSERT INTO schema_migrations(version, checksum) VALUES(1, $1) ON CONFLICT (version) DO NOTHING",
      [checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
