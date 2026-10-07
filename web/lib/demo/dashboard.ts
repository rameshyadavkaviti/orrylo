export interface DashboardDemoState {
  source: "demo";
  wallet: { status: "disconnected"; publicKey: null };
  membership: { status: "unverified" };
  rylo: { balance: null; authorization: "unknown" };
  buildCredit: { status: "not-issued"; amount: null };
  recentActivity: readonly [];
}

export const DASHBOARD_DEMO_STATE: DashboardDemoState = {
  source: "demo",
  wallet: { status: "disconnected", publicKey: null },
  membership: { status: "unverified" },
  rylo: { balance: null, authorization: "unknown" },
  buildCredit: { status: "not-issued", amount: null },
  recentActivity: [],
};
