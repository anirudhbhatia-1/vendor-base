import { CustomerChrome } from '../customer-chrome';
import { NotificationInbox } from '../notification-inbox';
import { RequireCustomerSession } from '../require-customer-session';
import { PageHeader } from '@neighbourhood-store/ui';

export default function NotificationsPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <div className="ns-stack">
          <PageHeader
            eyebrow="Account"
            title="Notifications"
            description="Order, refund, delivery and support updates."
          />
          <NotificationInbox />
        </div>
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
