#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

#[contract]
struct InitializationHarness;

#[contractimpl]
impl InitializationHarness {
    pub fn initialize(env: Env, initializer: Address) -> Result<(), Error> {
        super::initialize(&env, initializer)
    }
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
