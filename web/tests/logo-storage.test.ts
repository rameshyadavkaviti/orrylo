import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { detectLogoType, logoObjectKey } from "../lib/server/projects/logo-storage";

test("accepts real supported image signatures", () => {
  assert.equal(detectLogoType(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])), "image/png");
  assert.equal(detectLogoType(Uint8Array.from([255,216,255,224,0,0,0,0,0,0,0,0])), "image/jpeg");
  assert.equal(detectLogoType(Buffer.from("RIFF0000WEBP")), "image/webp");
});
test("rejects forged and empty image payloads", () => {
  assert.equal(detectLogoType(Buffer.from("not an image")), null);
  assert.equal(detectLogoType(new Uint8Array(0)), null);
  assert.equal(detectLogoType(Buffer.alloc(2 * 1024 * 1024 + 1)), null);
});
test("logo keys are content-addressed, private-storage paths", () => {
  const hash = createHash("sha256").update("image").digest("hex");
  assert.equal(logoObjectKey("b478e97c-9365-4931-b6bb-c90507d6c8b1", hash, "image/png"),
    `logos/b478e97c-9365-4931-b6bb-c90507d6c8b1/${hash}.png`);
});
