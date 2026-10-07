import assert from "node:assert/strict";
import test from "node:test";

import {
  createExpiredSessionCookiePolicy,
  createSessionCookiePolicy,
} from "../lib/auth/cookies";
import { SESSION_COOKIE_NAME } from "../lib/auth/constants";

test("session cookie is HttpOnly, bounded, same-site, and secure in production", () => {
  const expiresAt = Date.parse("2026-10-07T20:00:00.000Z");
  const policy = createSessionCookiePolicy(expiresAt, "production");

  assert.equal(policy.name, SESSION_COOKIE_NAME);
  assert.equal(policy.httpOnly, true);
  assert.equal(policy.secure, true);
  assert.equal(policy.sameSite, "lax");
  assert.equal(policy.path, "/");
  assert.equal(policy.expires.getTime(), expiresAt);
});

test("logout policy expires the cookie", () => {
  assert.equal(
    createExpiredSessionCookiePolicy("development").expires.getTime(),
    0,
  );
});
