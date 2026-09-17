import { CustomerChrome } from '../../../../customer-chrome';
import { ProductPage } from '../../../../product-page';

export default async function ProductRoute({
  params,
}: {
  params: Promise<{ productId: string; vendorLocationId: string }>;
}) {
  const { productId, vendorLocationId } = await params;
  return (
    <CustomerChrome>
      <ProductPage productId={productId} vendorLocationId={vendorLocationId} />
    </CustomerChrome>
  );
}
