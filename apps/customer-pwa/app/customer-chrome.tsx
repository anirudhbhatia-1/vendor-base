'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { bannersFor, type Address } from '@neighbourhood-store/contracts';
import {
  ActionDock,
  AppShell,
  LiveServiceBanners,
  Button,
  Icon,
  TabBar,
  TopBar,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import type { TabItem } from '@neighbourhood-store/ui';
import { CartProvider, useCart } from './cart-store';
import { displayLabel } from './display';
import { LocaleProvider, useLocale } from './locale';
import {
  anonymousCustomerClient,
  customerApiClient,
  readCustomerSession,
} from './customer-session';
import { createRequestScope, showBasketDock } from './shell-policy';

const tabs = (t: (key: string, fallback: string) => string): readonly TabItem[] => [
  { href: '/', glyph: <Icon name="home" />, label: t('customer.nav.home', 'Home') },
  {
    href: '/categories',
    glyph: <Icon name="grid" />,
    label: t('customer.nav.categories', 'Categories'),
  },
  { href: '/orders', glyph: <Icon name="clock" />, label: t('customer.nav.orders', 'Orders') },
  { href: '/stores', glyph: <Icon name="heart" />, label: t('customer.nav.stores', 'My stores') },
  {
    href: '/account',
    glyph: <Icon name="person" />,
    label: t('customer.nav.account', 'Account'),
    relatedPaths: ['/addresses', '/notifications', '/sessions', '/support', '/privacy'],
  },
];

/**
 * The delivery address the whole session is scoped to.
 *
 * Discovery, fees, eligibility and every store promise are computed for one
 * selected address (MKT-03), so it belongs in the chrome where it is always
 * visible and always changeable — not buried inside the marketplace panel,
 * where it was previously the only place to see or change it.
 */
function AddressContext() {
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [status, setStatus] = useState<'guest' | 'loading' | 'ready' | 'error'>('guest');
  const [selectionError, setSelectionError] = useState(false);
  const scope = useRef(createRequestScope());
  const { t } = useLocale();

  const load = useCallback(async () => {
    const current = scope.current.begin();
    setAddresses([]);
    setSelecting(false);
    setSelectionError(false);
    if (!readCustomerSession()) {
      setStatus('guest');
      return;
    }
    setStatus('loading');
    try {
      const client = await customerApiClient();
      if (!current()) return;
      const body = await client.addresses.list();
      if (!current()) return;
      setAddresses(body.addresses);
      setStatus('ready');
    } catch {
      if (current()) setStatus('error');
    }
  }, []);

  useEffect(() => {
    let sessionId = readCustomerSession()?.session_id;
    const requests = scope.current;
    void load();
    const onSession = () => {
      const next = readCustomerSession()?.session_id;
      if (next === sessionId) return;
      sessionId = next;
      void load();
    };
    const onAddress = () => void load();
    window.addEventListener('neighbourhood:customer-session', onSession);
    window.addEventListener('neighbourhood:customer-address', onAddress);
    return () => {
      requests.invalidate();
      window.removeEventListener('neighbourhood:customer-session', onSession);
      window.removeEventListener('neighbourhood:customer-address', onAddress);
    };
  }, [load]);

  if (status === 'loading')
    return (
      <span role="status">{t('customer.address.loading', 'Finding your delivery address…')}</span>
    );
  if (status === 'error')
    return (
      <div className="address-context">
        <span role="status">
          {t('customer.address.unavailable', 'Delivery address unavailable.')}
        </span>
        <Button onClick={() => void load()}>{t('customer.retry', 'Try again')}</Button>
      </div>
    );
  if (addresses.length === 0)
    return (
      <Link className="address-context address-context--link" href="/addresses">
        <Icon name="pin" /> {t('customer.address.add', 'Choose delivery address')}
      </Link>
    );
  const selected = addresses.find((address) => address.is_selected) ?? addresses[0];
  if (!selected) return null;

  return (
    <div className="address-context-group">
      <label className="address-context">
        <span className="sr-only">{t('customer.address.deliver_to', 'Deliver to')}</span>
        <span className="address-context__glyph">
          <Icon name="pin" />
        </span>
        <select
          className="address-context__select"
          disabled={selecting}
          onChange={async (event) => {
            const id = event.target.value;
            const current = scope.current.begin();
            setSelecting(true);
            setSelectionError(false);
            try {
              const client = await customerApiClient();
              if (!current()) return;
              await client.addresses.select(id);
              if (!current()) return;
              setAddresses((current) =>
                current.map((address) => ({
                  ...address,
                  is_selected: address.customer_address_id === id,
                })),
              );
              // Discovery, fees and eligibility are all computed against the
              // selected address, so every open screen has to recompute.
              window.dispatchEvent(new Event('neighbourhood:customer-address'));
            } catch {
              if (current()) setSelectionError(true);
            } finally {
              if (current()) setSelecting(false);
            }
          }}
          value={selected.customer_address_id}
        >
          {addresses.map((address) => (
            <option key={address.customer_address_id} value={address.customer_address_id}>
              {displayLabel(address.label)} · {address.pin_code}
            </option>
          ))}
        </select>
      </label>
      {selectionError ? (
        <span role="alert">
          {t('customer.address.select_failed', 'Address was not changed. Please try again.')}
        </span>
      ) : null}
    </div>
  );
}

/** The basket summary, pinned above the tab bar wherever the shopper is. */
function BasketDock() {
  const { itemCount, totalMinor } = useCart();
  const pathname = usePathname();
  const { t } = useLocale();
  if (!showBasketDock(pathname, itemCount)) return null;
  return (
    <ActionDock
      action={
        <Link className="ns-button ns-button--primary ns-button--medium" href="/cart">
          <span className="ns-button__label">{t('customer.cart.view', 'View basket')}</span>
        </Link>
      }
      detail={
        totalMinor === null
          ? t('customer.cart.total_pending', 'Total confirmed at checkout')
          : formatMoneyMinor(totalMinor, 'compact')
      }
      title={
        itemCount === 1
          ? t('customer.cart.one_item', '1 item')
          : `${itemCount} ${t('customer.cart.items', 'items')}`
      }
    />
  );
}

/** What is paused that a customer would run into (11.7). */
const loadCustomerBanners = async () =>
  bannersFor((await anonymousCustomerClient().serviceStatus()).banners, { kind: 'customer' });

function Chrome({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { language, setLanguage, t } = useLocale();

  return (
    <AppShell
      dock={<BasketDock />}
      footer={
        <div className="customer-footer">
          <strong>Neighbourhood Store</strong>
          <span>
            {t('customer.footer.tagline', 'Built for named local shops — not anonymous inventory.')}
          </span>
        </div>
      }
      surface="customer"
      tabs={
        <TabBar
          currentPath={pathname}
          items={tabs(t).map((item) =>
            item.href === '/cart' ? { ...item, badge: itemCount } : item,
          )}
          label={t('customer.nav.label', 'Customer navigation')}
          renderLink={(item, active, content) => (
            <Link aria-current={active ? 'page' : undefined} href={item.href}>
              {content}
            </Link>
          )}
        />
      }
      topBar={
        <TopBar
          className="customer-topbar"
          actions={
            <>
              {/* A real switch, not a link to the account page. */}
              <div
                className="language-switch"
                role="group"
                aria-label={t('customer.language', 'Language')}
              >
                {(['en', 'hi'] as const).map((code) => (
                  <button
                    aria-pressed={language === code}
                    className="language-switch__option"
                    key={code}
                    lang={code}
                    onClick={() => setLanguage(code)}
                    type="button"
                  >
                    {code === 'en' ? 'EN' : 'हिन्दी'}
                  </button>
                ))}
              </div>
              <Link className="ns-button ns-button--secondary ns-button--small" href="/cart">
                <span className="ns-button__label">
                  <Icon name="basket" /> {t('customer.cart.basket', 'Basket')}
                  {itemCount > 0 ? ` · ${itemCount}` : ''}
                </span>
              </Link>
              <Link className="ns-button ns-button--ghost ns-button--small" href="/search">
                <span className="ns-button__label">
                  <Icon name="search" /> {t('customer.search', 'Search')}
                </span>
              </Link>
            </>
          }
          brand={
            <Link className="customer-brand" href="/">
              <span aria-hidden="true" className="brand-mark">
                न
              </span>
              <span className="customer-brand__name">
                <strong>Neighbourhood</strong>
              </span>
            </Link>
          }
          context={<AddressContext />}
        />
      }
    >
      {[
        '/addresses',
        '/notifications',
        '/sessions',
        '/support',
        '/privacy',
        '/account/preferences',
      ].some((route) => pathname === route || pathname.startsWith(`${route}/`)) ? (
        <Link className="customer-back-link" href="/account">
          ← {t('customer.account.back', 'Your account')}
        </Link>
      ) : null}
      <LiveServiceBanners load={loadCustomerBanners} />
      {children}
    </AppShell>
  );
}

export function CustomerChrome({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <LocaleProvider>
      <CartProvider>
        <Chrome>{children}</Chrome>
      </CartProvider>
    </LocaleProvider>
  );
}
