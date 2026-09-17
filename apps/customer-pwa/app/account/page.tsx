import { AccountPanel } from '../account-panel';
import { CustomerChrome } from '../customer-chrome';
import { RequireCustomerSession } from '../require-customer-session';

export default function AccountPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <AccountPanel />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
