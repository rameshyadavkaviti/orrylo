import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";

test("client modules do not import server persistence or database credentials", async () => {
  const root = resolve(process.cwd());
  const files = await collectTypeScriptFiles(
    join(root, "app"),
    join(root, "components"),
  );

  for (const file of files) {
    const source = await readFile(file, "utf8");

    if (
      !source.startsWith('"use client"') &&
      !source.startsWith("'use client'")
    ) {
      continue;
    }

    assert.doesNotMatch(
      source,
      /(?:lib\/server|DATABASE_URL|TEST_DATABASE_URL)/,
      `server-only persistence leaked into client module ${relative(root, file)}`,
    );
  }
});

async function collectTypeScriptFiles(...roots: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const root of roots) {
    await walk(root, files);
  }

  return files;
}

async function walk(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await walk(path, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
}
