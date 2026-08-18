const checkpoints = [
  ['Shell', 'Running locally'],
  ['Operations queues', 'Not connected'],
  ['Protected actions', 'Disabled'],
] as const;

export default function AdminHome() {
  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark" aria-hidden="true">
          AO
        </span>
        <div>
          <p className="eyebrow">Admin PWA · Internal build</p>
          <p className="product-name">Operations desk</p>
        </div>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="local-note">Company test workspace · Synthetic cases only</p>
        <h1 id="page-title">See risk first. Act with a record.</h1>
        <p className="summary">
          This is the admin web foundation. Monitoring, approvals, refunds, restrictions and
          incident controls are intentionally not active yet.
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
        No real users, cases, financial actions or production controls are used.
      </p>
    </main>
  );
}
