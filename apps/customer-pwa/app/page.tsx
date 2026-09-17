import { CustomerChrome } from './customer-chrome';
import { HomeFeed } from './home-feed';

export default function CustomerHome() {
  return (
    <CustomerChrome>
      <HomeFeed view="home" />
    </CustomerChrome>
  );
}
