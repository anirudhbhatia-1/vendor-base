import { CheckoutPanel } from '../checkout-panel';
import { CustomerChrome } from '../customer-chrome';
import { RequireCustomerSession } from '../require-customer-session';

export default function CheckoutPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <CheckoutPanel mode="checkout" />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
