import { CustomerChrome } from '../customer-chrome';
import { RequireCustomerSession } from '../require-customer-session';
import { SessionManager } from '../session-manager';

export default function SessionsPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <SessionManager />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
