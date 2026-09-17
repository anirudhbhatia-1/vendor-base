'use client';

import { CheckoutPanel } from '../checkout-panel';
import { CustomerChrome } from '../customer-chrome';
import { GuestBasket } from '../guest-basket';
import { useCustomerSignedIn } from '../require-customer-session';

/**
 * The basket is visible to everyone; paying is not.
 *
 * This route used to demand a session outright, so the basket a visitor had
 * just been encouraged to fill was itself behind the sign-in wall.
 */
export default function CartPage() {
  const signedIn = useCustomerSignedIn();
  return (
    <CustomerChrome>{signedIn ? <CheckoutPanel mode="cart" /> : <GuestBasket />}</CustomerChrome>
  );
}
