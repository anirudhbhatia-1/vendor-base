import { CustomerChrome } from '../../customer-chrome';
import { RequireCustomerSession } from '../../require-customer-session';
import { SupportPanel } from '../../support-panel';

export default async function SupportDetailPage({
  params,
}: {
  params: Promise<{ supportCaseId: string }>;
}) {
  const { supportCaseId } = await params;
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <SupportPanel supportCaseId={supportCaseId} />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
