/** Informational only; issuance state remains owned by the existing builder. */
export function TokenBuilderSteps() {
  const steps = [
    { number: "01", title: "Design", detail: "Choose a name, code and supply." },
    { number: "02", title: "Review", detail: "Check the exact asset details." },
    { number: "03", title: "Approve", detail: "Connect Albedo and establish trustline." },
    { number: "04", title: "Verify", detail: "Confirm the on-chain Testnet result." },
  ];
  return (
    <section aria-label="Asset creation overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step) => (
        <div key={step.number} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <span className="text-xs font-bold tracking-widest text-[var(--violet)]">{step.number}</span>
          <h2 className="mt-2 text-base font-semibold text-[var(--text)]">{step.title}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.detail}</p>
        </div>
      ))}
    </section>
  );
}
