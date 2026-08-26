'use client';

import { useState } from 'react';

const stops = [
  { action: 'Confirm arrival', label: 'Vendor arrival', state: 'ASSIGNED' },
  { action: 'Verify 2 packages', label: 'Pickup check', state: 'AT_VENDOR' },
  { action: 'Begin route', label: 'In your custody', state: 'PICKED_UP' },
  { action: 'Confirm arrival', label: 'Customer area', state: 'EN_ROUTE_TO_CUSTOMER' },
  { action: 'Record delivery', label: 'Handoff', state: 'ARRIVED' },
] as const;

export default function PartnerHome() {
  const [step, setStep] = useState(2);
  const current = stops[step];
  const delivered = step === stops.length;

  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark" aria-hidden="true">
          DP
        </span>
        <div>
          <p className="eyebrow">Delivery Partner · Internal build</p>
          <p className="product-name">Custody desk</p>
        </div>
        <span className="local-badge">LOCAL · SYNTH</span>
      </header>

      <section className="job-head" aria-labelledby="page-title">
        <div>
          <p className="assignment-ref">SYNTH-JOB-302020-055</p>
          <h1 id="page-title">
            Two packages.
            <br />
            One accountable handoff.
          </h1>
          <p className="summary">
            Approximate areas only. Exact route, customer identity, phone number, proof and payout
            data are not used in this company test build.
          </p>
        </div>
        <div
          className={`custody-seal ${delivered ? 'is-closed' : ''}`}
          aria-label={delivered ? 'Custody closed' : 'Custody active'}
        >
          <span className="seal-count">02</span>
          <span className="seal-label">{delivered ? 'Custody closed' : 'In your custody'}</span>
          <span className="seal-rule" />
          <span className="seal-meta">Count verified</span>
        </div>
      </section>

      <section className="workbench" aria-label="Synthetic active assignment">
        <div className="route-strip">
          <div>
            <p className="route-label">Pick up near</p>
            <strong>SYNTH Mansarovar sector</strong>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <p className="route-label">Drop near</p>
            <strong>SYNTH Ajmer Road sector</strong>
          </div>
        </div>

        <ol className="custody-lane">
          {stops.map((stop, index) => {
            const status = delivered || index < step ? 'done' : index === step ? 'active' : 'next';
            return (
              <li className={status} key={stop.state}>
                <span className="node" aria-hidden="true">
                  {status === 'done' ? '✓' : index + 1}
                </span>
                <span>
                  <small>{stop.state}</small>
                  <strong>{stop.label}</strong>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="action-dock">
          <div>
            <p className="dock-label">Current custody state</p>
            <strong>{delivered ? 'DELIVERED' : current?.state}</strong>
          </div>
          {delivered ? (
            <button type="button" onClick={() => setStep(0)}>
              Reset synthetic job
            </button>
          ) : (
            <button type="button" onClick={() => setStep((value) => value + 1)}>
              {current?.action}
            </button>
          )}
        </div>
      </section>

      <aside className="failure-note">
        <strong>Delivery cannot be completed?</strong>
        <span>
          Record failure first. A return starts only after operations authorizes its synthetic
          destination.
        </span>
      </aside>
      <section className="money-strip" aria-label="Synthetic trip earnings">
        <div>
          <span>Outbound</span>
          <strong>₹39.00</strong>
        </div>
        <div>
          <span>Wait</span>
          <strong>₹0.00</strong>
        </div>
        <div>
          <span>Tip</span>
          <strong>₹10.00</strong>
        </div>
        <div>
          <span>Trip earning</span>
          <strong>₹49.00</strong>
        </div>
        <small>Eligible 24 hours after completion · fake payout only</small>
      </section>
      <p className="boundary">Interactive local fixture only · Buttons do not send API commands</p>
    </main>
  );
}
