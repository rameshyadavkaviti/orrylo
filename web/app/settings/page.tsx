import { DemoBanner } from "../../components/demo-banner";
import { networkLabel, readPublicRuntimeConfig } from "../../lib/config/public-env";

export function SettingsPage() {
  const config = readPublicRuntimeConfig();

  return (
    <div className="page-stack">
      <DemoBanner />
      <div className="page-heading">
        <span className="eyebrow">Settings</span>
        <h1>Minimal environment visibility.</h1>
        <p>
          These values describe application configuration only. They are not
          evidence of a deployment or active wallet connection.
        </p>
      </div>

      <article className="surface-card settings-list">
        <SettingRow label="Data mode" value="Demo" />
        <SettingRow label="Network" value={networkLabel(config.network)} />
        <SettingRow
          label="Foundation contract"
          value={config.foundationContractId ?? "Not configured"}
        />
        <SettingRow label="Wallet adapter" value="Not enabled" />
      </article>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default SettingsPage;
