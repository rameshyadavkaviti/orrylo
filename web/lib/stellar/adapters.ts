import type { StellarNetwork } from "../config/public-env";

export interface WalletConnection {
  walletId: string;
  publicKey: string;
}

export interface WalletAdapter {
  readonly id: string;
  connect(): Promise<WalletConnection>;
  disconnect(): Promise<void>;
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
  wallet: WalletAdapter | null;
  contractReads: ContractReadAdapter | null;
  transactions: TransactionSubmissionAdapter | null;
};
