export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    !process.env.ORRYLO_TESTNET_SIGNER_PRIVATE_URL
  )
    return;
  const { checkPrivateSignerReadiness } =
    await import("./lib/server/projects/private-signer-readiness");
  const result = await checkPrivateSignerReadiness();
  // Never log runtime configuration, headers, response bodies, errors or XDR.
  console.info(
    JSON.stringify({ event: "private_signer_readiness", ...result }),
  );
}
