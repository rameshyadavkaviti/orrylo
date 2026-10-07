import { DemoBanner } from "../../components/demo-banner";

export function ActivityPage() {
  return (
    <div className="page-stack">
      <DemoBanner />
      <div className="page-heading">
        <span className="eyebrow">Activity</span>
        <h1>Transaction history will begin with evidence.</h1>
        <p>
          Future records can track pending, submitted, confirmed, failed, retry,
          and user-action states. This phase creates no fake transaction
          history.
        </p>
      </div>

      <div className="empty-state">
        <strong>No activity records</strong>
        <p>
          There are no supported application transactions or persisted workflow
          events yet.
        </p>
      </div>
    </div>
  );
}

export default ActivityPage;
