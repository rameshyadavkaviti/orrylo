import { CreateSharedTokenForm } from "../../components/create-shared-token-form";
import { readPublicRuntimeConfig } from "../../lib/config/public-env";

export function CreateTokenPage() {
  const network = readPublicRuntimeConfig().network;
  const mainnet = network === "public";
  return (
    <div className="page-stack">
      <div className="page-heading builder-page-heading">
        <span className="eyebrow">Create Token</span>
        <h1>{mainnet ? "Create your Stellar Mainnet token." : "Create your Stellar Testnet token."}</h1>
        <p>
          {mainnet
            ? "Review your token, connect Albedo, and create a 10 XLM order. Payments and issuance remain disabled until Mainnet activation is complete."
            : "Start without a wallet. Choose your token details, review the exact supply, then connect Albedo to establish the trustline and confirm issuance on Testnet."}
        </p>
      </div>

      <div className="builder-assurances" aria-label="Builder availability">
        <span>✓ No wallet needed to explore</span>
        <span>✓ Live token preview</span>
        <span>✓ Shared Issuer model explained</span>
      </div>

      <CreateSharedTokenForm network={network} />
    </div>
  );
}

export default CreateTokenPage;
