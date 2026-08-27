import { SignInPanel } from './sign-in-panel';
import { CheckoutPanel } from './checkout-panel';

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
          The first identity boundary is ready for local synthetic testing. It rejects real phone
          numbers and never sends an external message.
        </p>
      </section>

      <SignInPanel />

      <CheckoutPanel />

      <section className="money-strip" aria-label="Synthetic payment recovery state">
        <span>Test checkout</span>
        <div>
          <strong>Checking payment</strong>
          <small>SYNTH-PAY-AUTH-0002</small>
        </div>
        <p>
          Do not pay again. An unknown result stays under the same reference until finance
          reconciles it.
        </p>
      </section>

      <p className="boundary">
        Local company test only. No real customers, phone numbers, messages, OTP delivery or
        sessions are used.
      </p>
    </main>
  );
}
