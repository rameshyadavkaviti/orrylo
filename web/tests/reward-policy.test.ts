import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_TOKEN_REWARD_AMOUNT,
  OfficialLaunchConfigurationError,
  REWARD_WINDOW_MS,
  evaluateRewardWindow,
  parseOfficialLaunchAt,
} from "../lib/server/rewards/policy";

test("missing official launch time is explicitly unconfigured", () => {
  assert.deepEqual(parseOfficialLaunchAt(undefined), { configured: false });
  assert.deepEqual(parseOfficialLaunchAt("   "), { configured: false });
});

test("invalid official launch configuration fails explicitly", () => {
  for (const value of [
    "2026-10-08",
    "2026-10-08T12:00:00+00:00",
    "2026-02-30T12:00:00Z",
    "not-a-date",
  ]) {
    assert.throws(
      () => parseOfficialLaunchAt(value),
      OfficialLaunchConfigurationError,
    );
  }
});

test("reward window is half-open from launch inclusive to end exclusive", () => {
  const config = parseOfficialLaunchAt("2026-10-08T12:00:00Z");

  assert.equal(config.configured, true);

  if (!config.configured) {
    return;
  }

  assert.equal(
    evaluateRewardWindow(config.launchAt - 1, config),
    "before_launch",
  );
  assert.equal(evaluateRewardWindow(config.launchAt, config), "inside_window");
  assert.equal(
    evaluateRewardWindow(config.launchAt + REWARD_WINDOW_MS / 2, config),
    "inside_window",
  );
  assert.equal(
    evaluateRewardWindow(config.windowEnd, config),
    "after_window",
  );
  assert.equal(
    evaluateRewardWindow(config.windowEnd + 1, config),
    "after_window",
  );
});

test("first-token reward amount is fixed at 150 RYLO", () => {
  assert.equal(FIRST_TOKEN_REWARD_AMOUNT, "150.0000000");
});
