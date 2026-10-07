#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, Bytes, BytesN, Env,
};
use std::{fs, path::PathBuf};

#[contract]
struct InitializationHarness;

#[contractimpl]
impl InitializationHarness {
    pub fn initialize(env: Env, initializer: Address) -> Result<(), Error> {
        super::initialize(&env, initializer)
    }
}

#[contract]
struct WasmDeploymentHarness;

#[contractimpl]
impl WasmDeploymentHarness {
    pub fn deploy(env: Env, wasm_hash: BytesN<32>, initializer: Address) -> Address {
        env.deployer()
            .with_current_contract([7_u8; 32])
            .deploy_v2(wasm_hash, (initializer,))
    }
}

fn built_foundation_wasm(env: &Env) -> Bytes {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/wasm32v1-none/release/orrylo_foundation.wasm");
    let wasm = fs::read(&path)
        .unwrap_or_else(|error| panic!("failed to read built foundation Wasm at {path:?}: {error}"));
    Bytes::from_slice(env, &wasm)
}

#[test]
fn constructor_sets_versioned_state() {
    let env = Env::default();
    let initializer = Address::generate(&env);
    let contract_id = env.register(OrryloFoundation, (initializer.clone(),));
    let client = OrryloFoundationClient::new(&env, &contract_id);

    assert_eq!(client.version(), FOUNDATION_STATE_VERSION);
    assert_eq!(
        client.state(),
        FoundationState {
            state_version: FOUNDATION_STATE_VERSION,
            initializer,
        }
    );
}

#[test]
fn initialization_logic_rejects_missing_authorization() {
    let env = Env::default();
    let initializer = Address::generate(&env);
    let contract_id = env.register(InitializationHarness, ());
    let client = InitializationHarnessClient::new(&env, &contract_id);

    assert!(client.try_initialize(&initializer).is_err());
}

#[test]
fn initialization_logic_accepts_authorized_initializer_and_rejects_duplicate() {
    let env = Env::default();
    env.mock_all_auths();

    let initializer = Address::generate(&env);
    let contract_id = env.register(InitializationHarness, ());
    let client = InitializationHarnessClient::new(&env, &contract_id);

    client.initialize(&initializer);

    let stored = env.as_contract(&contract_id, || super::read_state(&env).unwrap());
    assert_eq!(
        stored,
        FoundationState {
            state_version: FOUNDATION_STATE_VERSION,
            initializer: initializer.clone(),
        }
    );

    assert_eq!(
        client.try_initialize(&initializer),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn state_reads_are_deterministic() {
    let env = Env::default();
    let initializer = Address::generate(&env);
    let contract_id = env.register(OrryloFoundation, (initializer,));
    let client = OrryloFoundationClient::new(&env, &contract_id);

    let first = client.state();
    let second = client.state();

    assert_eq!(first, second);
    assert_eq!(client.version(), client.version());
}

#[test]
fn missing_state_returns_explicit_error() {
    let env = Env::default();
    let initializer = Address::generate(&env);
    let contract_id = env.register(OrryloFoundation, (initializer,));
    let client = OrryloFoundationClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        env.storage().instance().remove(&DataKey::State);
    });

    assert_eq!(client.try_state(), Err(Ok(Error::StateUnavailable)));
}

#[test]
#[ignore = "requires `stellar contract build` first"]
fn wasm_deployment_enforces_constructor_auth_and_rolls_back_failed_deploy() {
    let env = Env::default();
    let initializer = Address::generate(&env);
    let harness_id = env.register(WasmDeploymentHarness, ());
    let harness = WasmDeploymentHarnessClient::new(&env, &harness_id);
    let wasm = built_foundation_wasm(&env);
    let wasm_hash = env.deployer().upload_contract_wasm(wasm);

    // Real deploy_v2 path: the Wasm constructor must reject an initializer
    // that has not authorized this deployment.
    assert!(harness.try_deploy(&wasm_hash, &initializer).is_err());

    // The failed deployment must roll back fully so the exact same deterministic
    // deployment address remains available once authorization is provided.
    env.mock_all_auths();
    let foundation_id = harness.deploy(&wasm_hash, &initializer);
    let foundation = OrryloFoundationClient::new(&env, &foundation_id);

    assert_eq!(
        foundation.state(),
        FoundationState {
            state_version: FOUNDATION_STATE_VERSION,
            initializer,
        }
    );

    // After successful deployment, repeating the same deployment (same
    // deployer + salt) must fail rather than recreate/reinitialize the instance.
    assert!(harness.try_deploy(&wasm_hash, &foundation.state().initializer).is_err());
}
