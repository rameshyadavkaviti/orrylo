import Link from "next/link";

const PRODUCTS = [
  {
    title: "Token Draft",
    description:
      "Shape a Shared Issuer token identity and preview it before anything goes on-chain.",
    status: "Prototype available",
    href: "/create-token",
  },
  {
    title: "Metadata & Domain",
    description:
      "Publish clear asset and project metadata through Orrylo-managed domain infrastructure.",
    status: "Coming soon",
  },
  {
    title: "Dedicated Issuer",
    description:
      "Separate contract-controlled issuer infrastructure for projects that need their own policy model.",
    status: "Coming soon",
  },
  {
    title: "Custom Stellar Services",
    description:
      "Scoped Stellar product, contract, and infrastructure work for needs beyond the standard paths.",
    status: "Coming soon",
  },
] as const;

export function ProductsPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">Products &amp; Services</span>
        <h1>Start simple, then add infrastructure when you need it.</h1>
        <p>
          Orrylo is growing beyond token creation. Every card below says clearly
          whether you can use it in this prototype or whether it is still ahead.
        </p>
      </div>

      <section className="card-grid product-grid">
        {PRODUCTS.map((product) => (
          <article className="surface-card product-card" key={product.title}>
            <div className="card-title-row">
              <h2>{product.title}</h2>
              <span className="availability-badge">{product.status}</span>
            </div>
            <p className="muted">{product.description}</p>
            {"href" in product ? (
              <Link className="button button-primary" href={product.href}>
                Open token draft
              </Link>
            ) : (
              <button
                className="button button-secondary"
                type="button"
                disabled
              >
                Coming soon
              </button>
            )}
          </article>
        ))}
      </section>

      <section className="prototype-boundary">
        <div>
          <span className="eyebrow">Prototype promise</span>
          <strong>Unavailable services stay visibly unavailable.</strong>
        </div>
        <p>
          Orrylo does not simulate provisioning, token issuance, contract
          deployment, or payment success when those execution paths do not
          exist.
        </p>
      </section>
    </div>
  );
}

export default ProductsPage;
