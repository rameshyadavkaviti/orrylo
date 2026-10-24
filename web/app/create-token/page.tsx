import { CreateSharedTokenForm } from "../../components/create-shared-token-form";
import { readPublicRuntimeConfig } from "../../lib/config/public-env";

export function CreateTokenPage() {
  const network = readPublicRuntimeConfig().network;
  const mainnet = network === "public";
  return (
    <div className="page-stack">
      <div className="page-heading builder-page-heading">
        <span className="eyebrow">Product studio</span>
        <h1>Create your product.</h1>
        <p>
          {mainnet
            ? "Design a Stellar-powered product and review its token details. Mainnet payments and issuance remain disabled until activation is complete."
            : "Give your product an identity, preview its token and supply, then connect Albedo to approve the Testnet trustline and issuance."}
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
