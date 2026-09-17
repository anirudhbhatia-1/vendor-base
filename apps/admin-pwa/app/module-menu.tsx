'use client';
import { useState } from 'react';
import Link from 'next/link';
import { activeAdminModule, adminModuleGroups } from './module-navigation';

export function AdminModuleNavigation({ pathname }: { readonly pathname: string }) {
  const [expanded, setExpanded] = useState(false);
  const active = activeAdminModule(pathname);
  return (
    <nav className="admin-module-nav" aria-label="Admin modules">
      <button
        type="button"
        className="admin-module-toggle"
        aria-expanded={expanded}
        aria-controls="admin-module-groups"
        onClick={() => setExpanded(!expanded)}
      >
        {active?.[1] ?? 'Admin workspace'} <span>{expanded ? 'Close menu' : 'All modules'}</span>
      </button>
      <div id="admin-module-groups" className="admin-module-groups" data-expanded={expanded}>
        {adminModuleGroups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.links.map(([href, label]) => (
              <Link
                href={href}
                key={href}
                aria-current={active?.[0] === href ? 'page' : undefined}
                onClick={() => setExpanded(false)}
              >
                {label}
              </Link>
            ))}
          </section>
        ))}
      </div>
    </nav>
  );
}
