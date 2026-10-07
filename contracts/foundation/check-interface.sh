#!/usr/bin/env bash
set -euo pipefail

wasm="${1:-target/wasm32v1-none/release/orrylo_foundation.wasm}"
expected="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/interface.expected.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to verify the generated Soroban interface" >&2
  exit 2
fi

raw="$(mktemp)"
actual="$(mktemp)"
expected_normalized="$(mktemp)"
trap 'rm -f "$raw" "$actual" "$expected_normalized"' EXIT

stellar contract info interface --wasm "$wasm" --output json >"$raw"

jq '{
  functions: (
    [
      .[]
      | select(has("function_v0"))
      | .function_v0
      | {
          name,
          inputs: ([.inputs[]? | {name, type}]),
          outputs
        }
    ]
    | sort_by(.name)
  ),
  errors: (
    [
      .[]
      | select(has("udt_error_enum_v0"))
      | .udt_error_enum_v0
      | select(.name == "Error")
      | .cases[]
      | {name, value}
    ]
    | sort_by(.value)
  ),
  types: (
    [
      .[]
      | select(has("udt_struct_v0"))
      | .udt_struct_v0
      | select(.name == "FoundationState")
      | {
          name,
          fields: ([.fields[] | {name, type}])
        }
    ]
    | sort_by(.name)
  )
}' "$raw" | jq -S . >"$actual"

jq -S . "$expected" >"$expected_normalized"

if ! diff -u "$expected_normalized" "$actual"; then
  echo "Generated Soroban interface differs from the locked application boundary." >&2
  echo "Review the ABI change explicitly; do not update the expectation mechanically." >&2
  exit 1
fi

echo "Foundation Soroban interface matches the locked application boundary."
