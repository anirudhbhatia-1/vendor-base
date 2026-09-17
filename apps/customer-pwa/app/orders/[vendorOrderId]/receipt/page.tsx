import { CustomerChrome } from '../../../customer-chrome';
import { OrdersPanel } from '../../../orders-panel';
import { RequireCustomerSession } from '../../../require-customer-session';

export default async function ReceiptRoute({
  params,
}: {
  params: Promise<{ vendorOrderId: string }>;
}) {
  const { vendorOrderId } = await params;
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <OrdersPanel initialView="receipt" vendorOrderId={vendorOrderId} />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
