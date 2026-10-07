import { DemoBanner } from "../../components/demo-banner";

const PRODUCTS = [
  {
    title: "Domain Link",
    description: "Connect approved project metadata to a domain workflow.",
  },
  {
    title: "Metadata Setup",
    description: "Prepare transparent project and asset metadata.",
  },
  {
    title: "Dedicated Issuer",
    description: "Premium contract-controlled issuer infrastructure target.",
  },
  {
    title: "Custom Service",
    description: "Future scoped Stellar product and infrastructure work.",
  },
] as const;

export function ProductsPage() {
  return (
    <div className="page-stack">
      <DemoBanner />
      <div className="page-heading">
        <span className="eyebrow">Products & Services</span>
        <h1>Product surfaces without pretending they are live.</h1>
        <p>
          Pricing and transaction actions remain unavailable until their
          approved implementation and policy dependencies exist.
        </p>
      </div>

      <section className="card-grid">
        {PRODUCTS.map((product) => (
          <article className="surface-card product-card" key={product.title}>
            <div className="card-title-row">
              <h2>{product.title}</h2>
              <span className="availability-badge">Coming later</span>
            </div>
            <p>{product.description}</p>
            <button className="button button-secondary" type="button" disabled>
              Unavailable
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

export default ProductsPage;
