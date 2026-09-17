'use client';

import type { ReactNode } from 'react';
import { cx } from './classnames.js';

export type ShellRole = 'customer' | 'vendor' | 'partner' | 'admin';

export type TabItem = {
  readonly href: string;
  readonly label: string;
  /** An `<Icon />`, not a text codepoint — see the icon module for why. */
  readonly glyph: ReactNode;
  /** Unread or action-required count. Zero and undefined both render nothing. */
  readonly badge?: number | undefined;
  readonly relatedPaths?: readonly string[] | undefined;
};

export type AppShellProps = {
  readonly children: ReactNode;
  /**
   * Which product surface this is. Selects the accent tokens and the touch
   * target floor. Named `surface` rather than `role`: a JSX prop called `role`
   * is indistinguishable from the ARIA attribute, to a reader and to the a11y
   * linter alike.
   */
  readonly surface: ShellRole;
  readonly topBar: ReactNode;
  readonly tabs?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  /** Pinned above the tab bar — the cart summary, or a partner's active job. */
  readonly dock?: ReactNode | undefined;
  readonly className?: string | undefined;
};

/**
 * The frame every surface shares.
 *
 * Four near-identical copies of this existed, each with its own header, tab bar
 * and footer CSS. `surface` selects the accent tokens and the touch-target
 * floor rather than swapping stylesheets.
 */
export function AppShell({
  children,
  className,
  dock,
  footer,
  surface,
  tabs,
  topBar,
}: AppShellProps) {
  return (
    <div className={cx('ns-shell', className)} data-role={surface}>
      {topBar}
      {tabs}
      <main className="ns-shell__main" id="main" tabIndex={-1}>
        {children}
      </main>
      {footer ? <footer className="ns-shell__footer">{footer}</footer> : null}
      {dock ? <div className="ns-shell__dock">{dock}</div> : null}
    </div>
  );
}

export type TopBarProps = {
  readonly brand: ReactNode;
  readonly actions?: ReactNode | undefined;
  /** A second row: the delivery address switcher, the vendor's store selector. */
  readonly context?: ReactNode | undefined;
  readonly className?: string | undefined;
};

/** Sticky header: identity on the left, a small set of actions on the right. */
export function TopBar({ actions, brand, className, context }: TopBarProps) {
  return (
    <header className={cx('ns-topbar', className)}>
      <div className="ns-topbar__row">
        <div className="ns-topbar__brand">{brand}</div>
        {actions ? <div className="ns-topbar__actions">{actions}</div> : null}
      </div>
      {context ? <div className="ns-topbar__context">{context}</div> : null}
    </header>
  );
}

export type TabBarProps = {
  readonly items: readonly TabItem[];
  readonly currentPath: string;
  /** Injected so the package stays framework-agnostic and pulls in no router. */
  readonly renderLink: (item: TabItem, active: boolean, content: ReactNode) => ReactNode;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
};

/** Bottom navigation on a phone, a horizontal rail on a wide screen. */
export function TabBar({
  className,
  currentPath,
  items,
  label = 'Primary',
  renderLink,
}: TabBarProps) {
  // A detail route may match both a broad section and a more specific tab.
  // Select the closest owner rather than highlighting two destinations.
  const activeHref = items
    .flatMap((item) =>
      [item.href, ...(item.relatedPaths ?? [])]
        .filter(
          (path) => currentPath === path || (path !== '/' && currentPath.startsWith(`${path}/`)),
        )
        .map((path) => ({ href: item.href, length: path.length })),
    )
    .sort((a, b) => b.length - a.length)[0]?.href;
  return (
    <nav aria-label={label} className={cx('ns-tabbar', className)}>
      {items.map((item) => {
        const active = item.href === activeHref;
        const content = (
          <>
            <span aria-hidden="true" className="ns-tabbar__glyph">
              {item.glyph}
            </span>
            <span className="ns-tabbar__label">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 ? (
              <span className="ns-tabbar__badge">
                {item.badge > 99 ? '99+' : item.badge}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </>
        );
        return <div key={item.href}>{renderLink(item, active, content)}</div>;
      })}
    </nav>
  );
}

/**
 * A persistent summary bar above the tabs.
 *
 * The customer's basket total lives here; on the partner app it is the resume
 * control for an active job, which DLP-20 requires to be always reachable.
 */
export function ActionDock({
  action,
  className,
  detail,
  title,
}: {
  readonly title: ReactNode;
  readonly detail?: ReactNode | undefined;
  readonly action: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cx('ns-dock', className)}>
      <div className="ns-dock__copy">
        <strong className="ns-dock__title">{title}</strong>
        {detail ? <span className="ns-dock__detail">{detail}</span> : null}
      </div>
      <div className="ns-dock__action">{action}</div>
    </div>
  );
}

/** A page heading block: eyebrow, h1, supporting line, optional actions. */
export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  id = 'page-heading',
  title,
}: {
  readonly title: ReactNode;
  readonly eyebrow?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cx('ns-page-header', className)}>
      <div>
        {eyebrow ? <p className="ns-eyebrow">{eyebrow}</p> : null}
        <h1 className="ns-page-header__title" id={id}>
          {title}
        </h1>
        {description ? <p className="ns-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ns-page-header__actions">{actions}</div> : null}
    </div>
  );
}
