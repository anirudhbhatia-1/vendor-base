import { CustomerChrome } from '../../customer-chrome';
import { StorePage } from '../../store-page';

export default async function StoreRoute({
  params,
}: {
  params: Promise<{ vendorLocationId: string }>;
}) {
  const { vendorLocationId } = await params;
  return (
    <CustomerChrome>
      <StorePage vendorLocationId={vendorLocationId} />
    </CustomerChrome>
  );
}
