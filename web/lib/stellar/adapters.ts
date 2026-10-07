import type { StellarNetwork } from "../config/public-env";

export interface WalletAuthenticationProof {
  publicKey: string;
  signedMessage: string;
  signature: string;
}

export interface WalletAuthenticationAdapter {
  readonly id: string;
  authenticate(challenge: string): Promise<WalletAuthenticationProof>;
}

export interface ContractReadRequest {
  contractId: string;
  method: string;
  args: readonly unknown[];
  network: StellarNetwork;
}

export interface ContractReadAdapter {
  read<T>(request: ContractReadRequest): Promise<T>;
}

export interface TransactionSubmissionResult {
  hash: string;
}

export interface TransactionSubmissionAdapter {
  submitSignedEnvelope(
    envelopeXdr: string,
    network: StellarNetwork,
  ): Promise<TransactionSubmissionResult>;
}

export type StellarAdapters = {
  walletAuthentication: WalletAuthenticationAdapter | null;
  contractReads: ContractReadAdapter | null;
  transactions: TransactionSubmissionAdapter | null;
};
