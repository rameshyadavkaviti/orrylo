import { CreateSharedTokenForm } from "../../components/create-shared-token-form";
import { cookies } from "next/headers";
import type { StellarNetwork } from "../../lib/config/public-env";
import { MAINNET_SHARED_ISSUER_PUBLIC_KEY, MAINNET_TREASURY_PUBLIC_KEY } from "../../lib/stellar/mainnet-creation";

export function CreateTokenPage({ network = "testnet" }: { network?: StellarNetwork } = {}) {
  const mainnet = network === "public";
  const mainnetActivationEnabled = mainnet &&
    process.env.ORRYLO_MAINNET_CREATION_ENABLED === "true" &&
    process.env.ORRYLO_MAINNET_SHARED_ISSUER_PUBLIC_KEY === MAINNET_SHARED_ISSUER_PUBLIC_KEY &&
    process.env.ORRYLO_MAINNET_TREASURY_PUBLIC_KEY === MAINNET_TREASURY_PUBLIC_KEY &&
    process.env.ORRYLO_MAINNET_TREASURY_VERIFIED === "true" &&
    Boolean(process.env.ORRYLO_MAINNET_ISSUER_FEE_STROOPS) &&
    Boolean(process.env.ORRYLO_MAINNET_CUSTOMER_TRUSTLINE_MAX_FEE_STROOPS) &&
    Boolean(process.env.ORRYLO_MAINNET_SIGNER_PRIVATE_URL) &&
    Boolean(process.env.ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET);
  return (
    <div className="page-stack">
      <div className="page-heading builder-page-heading">
        <span className="eyebrow">Product studio</span>
        <h1>Create your product.</h1>
        <p>
          {mainnet
            ? "Design a Stellar-powered product and review its token details. Mainnet creation costs 10 XLM plus network fees and reserves when activated. Mainnet payments and issuance remain disabled until activation is complete."
            : "Give your product an identity, preview its token and supply, then connect Albedo to approve the Testnet trustline and issuance."}
        </p>
      </div>

      <div className="builder-assurances" aria-label="Token creation highlights">
        <span>✓ Design and preview for free</span>
        <span>✓ Guided step-by-step creation</span>
        <span>{mainnet ? (mainnetActivationEnabled ? "✓ 10 XLM creation fee" : "Mainnet creation not yet enabled") : "✓ Testnet wallet approval"}</span>
      </div>

      <CreateSharedTokenForm key={network} network={network} mainnetActivationEnabled={mainnetActivationEnabled} />
    </div>
  );
}

/** Network selection is a preference, never payment authorization. */
export default async function CreateProductPage({
  searchParams,
}: {
  searchParams?: Promise<{ network?: string }>;
}) {
  const requested = (await searchParams)?.network;
  const remembered = (await cookies()).get("orrylo-network")?.value;
  const network: StellarNetwork = requested === "public" || requested === "testnet"
    ? requested
    : remembered === "public" ? "public" : "testnet";
  return <CreateTokenPage network={network} />;
}
