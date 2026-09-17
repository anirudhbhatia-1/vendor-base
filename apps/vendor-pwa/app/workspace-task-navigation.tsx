import Link from 'next/link';
import { vendorSectionPages, type VendorView } from './workspace-navigation';

export function WorkspaceTaskNavigation({ view }: { readonly view: VendorView }) {
  const pages = vendorSectionPages(view);
  if (pages.length < 2) return null;
  return (
    <nav className="workspace-task-nav" aria-label="Tasks in this section">
      {pages.map(([key, page]) => (
        <Link key={key} href={page.href} aria-current={key === view ? 'page' : undefined}>
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
