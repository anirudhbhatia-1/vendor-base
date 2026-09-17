import { CustomerChrome } from '../customer-chrome';
import { OrdersPanel } from '../orders-panel';
import { RequireCustomerSession } from '../require-customer-session';

export default function OrdersPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <OrdersPanel />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
