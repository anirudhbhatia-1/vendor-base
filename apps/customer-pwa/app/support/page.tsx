import { CustomerChrome } from '../customer-chrome';
import { RequireCustomerSession } from '../require-customer-session';
import { SupportPanel } from '../support-panel';

export default function SupportPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <SupportPanel />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
