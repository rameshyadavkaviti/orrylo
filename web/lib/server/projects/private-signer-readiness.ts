import {
  PrivateRailwaySharedIssuerSigningPrimitive,
  PrivateRailwaySignerPrimitiveError,
  type PrivateRailwaySignerIdentityMismatchField,
} from "../../stellar/private-railway-signer";

/** Startup observation only: no DB, envelope, signer key or Horizon access. */
export async function checkPrivateSignerReadiness(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{
  ok: boolean;
  code: string;
  mismatchField?: PrivateRailwaySignerIdentityMismatchField;
}> {
  try {
    if (env.NEXT_PUBLIC_STELLAR_NETWORK?.trim() !== "testnet") {
      throw new PrivateRailwaySignerPrimitiveError("invalid_configuration");
    }
    const primitive = new PrivateRailwaySharedIssuerSigningPrimitive(
      {
        privateBaseUrl: env.ORRYLO_TESTNET_SIGNER_PRIVATE_URL?.trim() ?? "",
        requestAuthSecret:
          env.ORRYLO_TESTNET_SIGNER_REQUEST_AUTH_SECRET?.trim() ?? "",
        issuerPublicKey:
          env.ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY ?? "",
        signerPublicKey: env.ORRYLO_TESTNET_SHARED_ISSUER_SIGNER_PUBLIC_KEY,
      },
      fetchImpl,
    );
    await primitive.assertReady();
    return { ok: true, code: "signer_ready" };
  } catch (error) {
    if (
      error instanceof PrivateRailwaySignerPrimitiveError &&
      error.code === "signer_identity_mismatch" &&
      error.mismatchField
    ) {
      return {
        ok: false,
        code: error.code,
        mismatchField: error.mismatchField,
      };
    }
    return {
      ok: false,
      code:
        error instanceof PrivateRailwaySignerPrimitiveError
          ? error.code
          : "signer_unavailable",
    };
  }
}
