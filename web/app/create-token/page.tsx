import { CreateSharedTokenForm } from "../../components/create-shared-token-form";

export function CreateTokenPage() {
  return (
    <div className="page-stack">
      <div className="page-heading builder-page-heading">
        <span className="eyebrow">Create Token</span>
        <h1>Build a Stellar token before you connect anything.</h1>
        <p>
          Explore Orrylo anonymously: shape the identity, brand, infrastructure,
          and metadata presentation, then see the result update live. A wallet
          is only needed at a future identity or on-chain execution boundary.
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
