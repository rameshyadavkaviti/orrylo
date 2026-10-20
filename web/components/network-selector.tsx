/** Visible network selection is informational until Mainnet is supported. */
export function NetworkSelector() {
  return (
    <div role="group" aria-label="Stellar network" className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5">
      <span aria-current="true" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--violet-soft)] px-3 text-sm font-bold text-[var(--text)] ring-1 ring-[var(--violet)]">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
        Testnet
      </span>
      <button type="button" disabled aria-label="Mainnet coming soon" title="Mainnet is not available yet" className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--muted)] opacity-60">
        Mainnet <span className="hidden text-[10px] sm:inline">Soon</span>
      </button>
    </div>
  );
}
