import type {
  WalletAuthenticationAdapter,
  WalletAuthenticationProof,
} from "../stellar/adapters";

export const albedoAuthAdapter: WalletAuthenticationAdapter = {
  id: "albedo",

  async authenticate(challenge: string): Promise<WalletAuthenticationProof> {
    const { default: albedo } = await import("@albedo-link/intent");
    const result = await albedo.publicKey({ token: challenge });

    return {
      publicKey: result.pubkey,
      signedMessage: result.signed_message,
      signature: result.signature,
    };
  },
};
