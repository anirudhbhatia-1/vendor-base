import { CustomerChrome } from '../customer-chrome';
import { HomeFeed } from '../home-feed';

export default function CategoriesPage() {
  return (
    <CustomerChrome>
      <HomeFeed view="categories" />
    </CustomerChrome>
  );
}
