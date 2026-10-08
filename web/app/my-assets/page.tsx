import Link from "next/link";

export function MyAssetsPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">My Assets</span>
        <h1>Your Orrylo assets will live here.</h1>
        <p>
          There are no issued assets to show in the current prototype. You can
          create and preview a token draft without fabricating on-chain ownership.
        </p>
      </div>

      <div className="empty-state">
        <strong>No issued assets yet</strong>
        <p>
          Token issuance is not enabled. Start with a draft and preview the
          identity and Shared Issuer model.
        </p>
        <Link className="button button-primary" href="/create-token">
          Create Token
        </Link>
      </div>
    </div>
  );
}

export default MyAssetsPage;
