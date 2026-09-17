import { CustomerChrome } from '../../customer-chrome';
import { RequireCustomerSession } from '../../require-customer-session';
import { SignInPanel } from '../../sign-in-panel';
import { PageHeader } from '@neighbourhood-store/ui';

export default function PreferencesPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <PageHeader
          title="Profile and preferences"
          description="Manage your name, language, alerts and this device’s access."
        />
        <div className="preferences-column">
          <SignInPanel />
        </div>
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
