import { CreateSharedTokenForm } from "../../components/create-shared-token-form";

export function CreateTokenPage() {
  return (
    <div className="page-stack">
      <div className="page-heading builder-page-heading">
        <span className="eyebrow">Create Token</span>
        <h1>Create your Stellar Testnet token.</h1>
        <p>
          Start without a wallet. Choose your token details, review the exact supply,
          then connect Albedo to establish the trustline and confirm issuance on Testnet.
        </p>
      </div>

      <div className="builder-assurances" aria-label="Builder availability">
        <span>✓ No wallet needed to explore</span>
        <span>✓ Live token preview</span>
        <span>✓ Shared Issuer model explained</span>
      </div>

      <CreateSharedTokenForm />
    </div>
  );
}

export default CreateTokenPage;
