const checkpoints = [
  ['Shell', 'Running locally'],
  ['Assignment feed', 'Not connected'],
  ['Real delivery', 'Disabled'],
] as const;

export default function PartnerHome() {
  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark" aria-hidden="true">
          DP
        </span>
        <div>
          <p className="eyebrow">Delivery Partner PWA · Internal build</p>
          <p className="product-name">Route desk</p>
        </div>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="local-note">Company test workspace · Synthetic routes only</p>
        <h1 id="page-title">One clear job. Every handoff accounted for.</h1>
        <p className="summary">
          This is the partner web foundation. Availability, offers, navigation, proof and earnings
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
      <p className="boundary">No real partners, locations, routes, proofs or payouts are used.</p>
    </main>
  );
}
