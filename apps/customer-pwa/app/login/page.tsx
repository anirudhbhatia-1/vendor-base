import { SignInPanel } from '../sign-in-panel';
import Link from 'next/link';
import { customerLoginReturn } from '../login-return';

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const returnTo = customerLoginReturn((await searchParams).next);
  return (
    <main className="login-page" id="main">
      <div className="login-copy">
        <p className="eyebrow">Customer access</p>
        <h1>Sign in with your mobile number.</h1>
        <p>Sign in to save addresses, place orders, and keep track of your deliveries.</p>
      </div>
      <SignInPanel redirectAfterSignIn returnTo={returnTo} />
      <Link href="/">Continue browsing</Link>
    </main>
  );
}
