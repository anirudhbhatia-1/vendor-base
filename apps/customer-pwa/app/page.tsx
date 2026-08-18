const checkpoints = [
  ['Shell', 'Running locally'],
  ['Marketplace API', 'Not connected'],
  ['Real shopping', 'Disabled'],
] as const;

export default function CustomerHome() {
  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark" aria-hidden="true">
          NS
        </span>
        <div>
          <p className="eyebrow">Customer PWA · Internal build</p>
          <p className="product-name">Neighbourhood Store</p>
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="local-note">Jaipur test workspace · Synthetic data only</p>
        <h1 id="page-title">Your neighbourhood, by name.</h1>
        <p className="summary">
          This is the customer web foundation. Store discovery, prices, orders, sign-in and payments
          are intentionally not active yet.
        </p>
      </section>

      <section className="market-lane" aria-label="Build readiness">
        {checkpoints.map(([label, value], index) => (
          <div className="checkpoint" key={label}>
            <span className="stop" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </section>

      <p className="boundary">No real customers, shops, messages, OTPs or money are used.</p>
    </main>
  );
}
