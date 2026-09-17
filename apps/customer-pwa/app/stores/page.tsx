import { CustomerChrome } from '../customer-chrome';
import { HomeFeed } from '../home-feed';
import { RequireCustomerSession } from '../require-customer-session';

export default function StoresPage() {
  return (
    <CustomerChrome>
      <RequireCustomerSession>
        <HomeFeed view="stores" />
      </RequireCustomerSession>
    </CustomerChrome>
  );
}
