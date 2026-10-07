#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env,
};

pub const FOUNDATION_STATE_VERSION: u32 = 1;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    State,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FoundationState {
    pub state_version: u32,
    /// Deployment provenance only. This address has no post-deployment
    /// administrative, issuer, mint, burn, upgrade, or authorization power.
    pub initializer: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    StateUnavailable = 2,
}

#[contract]
pub struct OrryloFoundation;

#[contractimpl]
impl OrryloFoundation {
    /// Initializes the contract atomically at deployment.
    ///
    /// The initializer must authorize the initialization. The stored address is
    /// provenance only and is intentionally not an Orrylo/RYLO administrator.
    pub fn __constructor(env: Env, initializer: Address) {
        if let Err(error) = initialize(&env, initializer) {
            panic_with_error!(&env, error);
        }
    }

    /// Returns the schema version of the foundation state.
    pub fn version() -> u32 {
        FOUNDATION_STATE_VERSION
    }

    /// Returns the complete policy-neutral foundation state.
    pub fn state(env: Env) -> Result<FoundationState, Error> {
        read_state(&env)
    }
}

fn initialize(env: &Env, initializer: Address) -> Result<(), Error> {
    initializer.require_auth();

    if env.storage().instance().has(&DataKey::State) {
        return Err(Error::AlreadyInitialized);
    }

    env.storage().instance().set(
        &DataKey::State,
        &FoundationState {
            state_version: FOUNDATION_STATE_VERSION,
            initializer,
        },
    );

    Ok(())
}

fn read_state(env: &Env) -> Result<FoundationState, Error> {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .ok_or(Error::StateUnavailable)
}

#[cfg(test)]
mod test;
