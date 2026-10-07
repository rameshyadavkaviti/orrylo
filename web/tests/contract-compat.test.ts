import assert from "node:assert/strict";
import test from "node:test";

import {
  FOUNDATION_INTERFACE_VERSION,
  UnsupportedFoundationInterfaceError,
  assertFoundationInterfaceCompatible,
  mapFoundationContractError,
  readCompatibleFoundationSnapshot,
} from "../lib/contracts/foundation-v1";

test("accepts Contract Interface v1", () => {
  assert.doesNotThrow(() =>
    assertFoundationInterfaceCompatible(FOUNDATION_INTERFACE_VERSION),
  );
});

test("rejects unsupported interface versions", () => {
  assert.throws(
    () => assertFoundationInterfaceCompatible(2),
    UnsupportedFoundationInterfaceError,
  );
});

test("maps the two known foundation contract errors", () => {
  assert.equal(mapFoundationContractError(1)?.name, "AlreadyInitialized");
  assert.equal(mapFoundationContractError(2)?.name, "StateUnavailable");
  assert.equal(mapFoundationContractError(99), null);
});

test("reads version and state only after compatibility passes", async () => {
  const snapshot = await readCompatibleFoundationSnapshot({
    async interfaceVersion() {
      return 1;
    },
    async version() {
      return 1;
    },
    async state() {
      return { initializer: "GDEMO", stateVersion: 1 };
    },
  });

  assert.deepEqual(snapshot, {
    interfaceVersion: 1,
    stateVersion: 1,
    state: { initializer: "GDEMO", stateVersion: 1 },
  });
});

test("does not read state or schema after an incompatible interface", async () => {
  let versionReads = 0;
  let stateReads = 0;

  await assert.rejects(
    () =>
      readCompatibleFoundationSnapshot({
        async interfaceVersion() {
          return 2;
        },
        async version() {
          versionReads += 1;
          return 1;
        },
        async state() {
          stateReads += 1;
          return { initializer: "GDEMO", stateVersion: 1 };
        },
      }),
    UnsupportedFoundationInterfaceError,
  );

  assert.equal(versionReads, 0);
  assert.equal(stateReads, 0);
});
