const MAINNET_ISSUER =
  "GBR7SEZD4ITXQPAWEVBX2BULS76ERDRTRMIS3LUYKZ7DNLGZZ6ASSETS";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("mainnet_signer_connectivity_failed");
  return value;
}

function healthUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("mainnet_signer_connectivity_failed");
  }
  if (
    url.protocol !== "http:" ||
    !url.hostname.endsWith(".railway.internal") ||
    url.hostname === "railway.internal" ||
    !url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("mainnet_signer_connectivity_failed");
  }
  return new URL("/healthz", url);
}

async function main() {
  const issuer = required("ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY");
  const auth = required("ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET");
  if (issuer !== MAINNET_ISSUER || Buffer.byteLength(auth, "utf8") < 32) {
    throw new Error("mainnet_signer_connectivity_failed");
  }
  const response = await fetch(
    healthUrl(required("ORRYLO_MAINNET_SIGNER_PRIVATE_URL")),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    },
  );
  const body = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.ok !== true ||
    body.ready !== true ||
    body.service !== "orrylo-mainnet-signer" ||
    body.network !== "public" ||
    body.issuerPublicKey !== MAINNET_ISSUER ||
    body.signerPublicKey !== MAINNET_ISSUER ||
    typeof body.signingEnabled !== "boolean" ||
    Object.keys(body).sort().join(",") !==
      "issuerPublicKey,network,ok,ready,service,signerPublicKey,signingEnabled"
  ) {
    throw new Error("mainnet_signer_connectivity_failed");
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      service: body.service,
      network: body.network,
      issuerPublicKey: body.issuerPublicKey,
      signerPublicKey: body.signerPublicKey,
      signingEnabled: body.signingEnabled,
    })}\n`,
  );
}

main().catch(() => {
  process.stderr.write("Mainnet signer private connectivity check failed.\n");
  process.exitCode = 1;
});
