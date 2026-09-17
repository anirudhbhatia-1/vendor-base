import { CustomerChrome } from '../customer-chrome';
import { PrivacyPanel } from '../privacy-panel';
import { RequireCustomerSession } from '../require-customer-session';

export default function PrivacyPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <PrivacyPanel />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
