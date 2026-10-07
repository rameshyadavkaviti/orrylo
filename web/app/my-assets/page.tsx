import { AssetListStateView } from "../../components/asset-list-state";
import { DemoBanner } from "../../components/demo-banner";

export function MyAssetsPage() {
  return (
    <div className="page-stack">
      <DemoBanner />
      <div className="page-heading">
        <span className="eyebrow">My Assets</span>
        <h1>Your asset workspace, ready for real data later.</h1>
        <p>
          The UI supports loading, empty, and explicitly labeled demo records
          without fabricating on-chain ownership.
        </p>
      </div>
      <AssetListStateView state={{ status: "empty" }} />
    </div>
  );
}

export default MyAssetsPage;
