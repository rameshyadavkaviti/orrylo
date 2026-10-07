export type AssetListState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "ready";
      source: "demo";
      assets: readonly {
        code: string;
        issuerType: "Shared Issuer" | "Dedicated Issuer";
      }[];
    };

export function AssetListStateView({ state }: { state: AssetListState }) {
  if (state.status === "loading") {
    return (
      <div className="empty-state" aria-busy="true">
        <strong>Loading assets…</strong>
        <p>Waiting for the future application data source.</p>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="empty-state">
        <strong>No assets yet</strong>
        <p>
          Real asset records will appear only after a supported creation flow is
          implemented and confirmed.
        </p>
        <a className="button button-primary" href="/create-token">
          Prepare a token draft
        </a>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {state.assets.map((asset) => (
        <article className="surface-card" key={asset.code}>
          <div className="card-title-row">
            <strong>{asset.code}</strong>
            <span className="availability-badge">Demo</span>
          </div>
          <p>{asset.issuerType}</p>
          <small>Explicit demo record — not on-chain evidence.</small>
        </article>
      ))}
    </div>
  );
}
