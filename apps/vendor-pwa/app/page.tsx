const checkpoints = [
  ['Shell', 'Running locally'],
  ['Order queue', 'Not connected'],
  ['Real store actions', 'Disabled'],
] as const;

export default function VendorHome() {
  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark" aria-hidden="true">
          VS
        </span>
        <div>
          <p className="eyebrow">Vendor PWA · Internal build</p>
          <p className="product-name">Shop desk</p>
        </div>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="local-note">Company test workspace · Synthetic vendors only</p>
        <h1 id="page-title">The shop stays in charge.</h1>
        <p className="summary">
          This is the vendor web foundation. Orders, catalogue changes, handoffs and settlements are
          intentionally not active yet.
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
      <p className="boundary">
        No real vendors, catalogues, alerts, orders or settlements are used.
      </p>
    </main>
  );
}
