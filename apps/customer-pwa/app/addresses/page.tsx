import { AddressManager } from '../address-manager';
import { CustomerChrome } from '../customer-chrome';
import { RequireCustomerSession } from '../require-customer-session';

export default function AddressesPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <AddressManager />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
