'use client';

import type { WhoAmI } from '@neighbourhood-store/contracts';
import { revokeAndSignOut } from '@neighbourhood-store/pwa-auth';
import { RequireWorkspaceRole } from '@neighbourhood-store/pwa-auth/guard';
import {
  AppShell,
  Button,
  ErrorState,
  Icon,
  LoadingState,
  Notice,
  TabBar,
  TopBar,
} from '@neighbourhood-store/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiUrl, vendorRequest } from './authenticated-api';
import { CatalogueImportPanel } from './catalogue-import-panel';
import { CatalogueStudio } from './catalogue-studio';
import { InsightsPanel } from './insights-panel';
import { InventoryPanel } from './inventory-panel';
import { OrdersPanel } from './orders-panel';
import { ServiceAreaPanel } from './service-area-panel';
import { StaffPanel } from './staff-panel';
import { PayoutsPanel } from './payouts-panel';
import { StoreSettingsPanel } from './store-settings-panel';
import { VendorOnboardingPanel } from './onboarding-panel';
import { displayName } from './display';
import { getSupabase, supabaseConfigured } from './supabase-client';
import { WorkspaceTaskNavigation } from './workspace-task-navigation';
import type { VendorView } from './workspace-navigation';

export type { VendorView } from './workspace-navigation';

type LocationSummary = {
  readonly vendor_location_id: string;
  readonly location_name: string;
};

const STORAGE_KEY = 'neighbourhood.vendor.location';

const tabs = [
  { href: '/', glyph: <Icon name="clock" />, label: 'Orders' },
  { href: '/catalogue', glyph: <Icon name="grid" />, label: 'Catalogue' },
  { href: '/store', glyph: <Icon name="store" />, label: 'Store' },
  { href: '/payouts', glyph: <Icon name="basket" />, label: 'Payouts' },
  { href: '/more', glyph: <Icon name="person" />, label: 'More', relatedPaths: ['/onboarding'] },
];

/**
 * The workspace shell is gated in the browser, not only in `proxy.ts`: the
 * Cloudflare Pages build is a static export where no proxy runs, and the proxy
 * never checked the caller's role in any build.
 */
export function VendorWorkspace({ view }: { view: VendorView }) {
  return (
    <RequireWorkspaceRole
      apiUrl={apiUrl}
      client={getSupabase()}
      configured={supabaseConfigured()}
      workspaceRole="vendor"
    >
      <VendorWorkspaceContent view={view} />
    </RequireWorkspaceRole>
  );
}

function VendorWorkspaceContent({ view }: { view: VendorView }) {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [locations, setLocations] = useState<readonly LocationSummary[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Resolves every location this account may work, not just the first.
   *
   * The shell previously took `who.vendor_location_ids[0]` and discarded the
   * rest, so an owner with two shops could only ever see one of them and had no
   * indication the other existed — which is why VEN-04 stood at backend-only
   * while the API had supported multiple locations all along. The choice is
   * remembered per device, because a manager works one shop at a time.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const who = await vendorRequest<WhoAmI>('auth/whoami');
      setIdentity(who);
      if (who.vendor_location_ids.length === 0) {
        throw new Error('Your account has no active store location. Contact an administrator.');
      }
      const resolved = await Promise.all(
        who.vendor_location_ids.map(async (id) => {
          try {
            // `GET .../settings` did not exist when this was written, so every
            // lookup fell through to the catch and the switcher listed raw
            // identifiers instead of store names.
            const settings = await vendorRequest<{ location_name?: string }>(
              `vendor/locations/${id}/settings`,
            );
            return { vendor_location_id: id, location_name: settings.location_name ?? id };
          } catch {
            // A location whose settings will not load is still a location the
            // account can work; naming it by id beats hiding it.
            return { vendor_location_id: id, location_name: id };
          }
        }),
      );
      setLocations(resolved);
      let remembered: string | null = null;
      try {
        remembered = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        /* Browser storage is optional. */
      }
      const chosen =
        remembered && who.vendor_location_ids.includes(remembered)
          ? remembered
          : (who.vendor_location_ids[0] ?? null);
      setLocationId(chosen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your store could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    setSigningOut(true);
    setActionError(null);
    try {
      const client = getSupabase();
      if (client) await revokeAndSignOut({ apiUrl, client });
      router.replace('/login');
      router.refresh();
    } catch {
      setActionError('Sign-out could not be completed. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  const activeName = locations.find((l) => l.vendor_location_id === locationId)?.location_name;

  return (
    <AppShell
      className="vendor-workbench"
      surface="vendor"
      tabs={
        <TabBar
          currentPath={pathname}
          items={tabs}
          label="Vendor workspace"
          renderLink={(item, active, content) => (
            <Link aria-current={active ? 'page' : undefined} href={item.href}>
              {content}
            </Link>
          )}
        />
      }
      topBar={
        <TopBar
          actions={
            <Button
              busy={signingOut}
              onClick={() => void signOut()}
              size="small"
              variant="secondary"
            >
              Sign out
            </Button>
          }
          brand={
            <span className="workspace-brand">
              <span aria-hidden="true" className="workspace-mark">
                NS
              </span>
              <span>
                <strong>{activeName ? displayName(activeName) : 'Vendor workspace'}</strong>
                <small>{identity?.email ?? 'Store management'}</small>
              </span>
            </span>
          }
          {...(locations.length > 1
            ? {
                context: (
                  <label className="location-switcher">
                    <span className="sr-only">Working store</span>
                    <span aria-hidden="true" className="location-switcher__glyph">
                      <Icon name="store" />
                    </span>
                    <select
                      onChange={(event) => {
                        setLocationId(event.target.value);
                        try {
                          window.localStorage.setItem(STORAGE_KEY, event.target.value);
                        } catch {
                          /* Store choice still works when browser storage is unavailable. */
                        }
                      }}
                      value={locationId ?? ''}
                    >
                      {locations.map((location) => (
                        <option
                          key={location.vendor_location_id}
                          value={location.vendor_location_id}
                        >
                          {displayName(location.location_name)}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              }
            : {})}
        />
      }
    >
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      {loading ? (
        <LoadingState label="Loading your store…" lines={4} />
      ) : error ? (
        <ErrorState onRetry={() => void load()} title={error} />
      ) : locationId === null ? (
        <Notice tone="warning">No store location is assigned to this account.</Notice>
      ) : (
        <section className="ns-stack" key={`${locationId}:${view}`}>
          <WorkspaceTaskNavigation view={view} />
          {view === 'orders' && (
            <>
              <div className="workspace-priority-strip">
                <span>Fulfilment desk</span>
                <Link href="/more/insights">Insights and open support cases →</Link>
              </div>
              <OrdersPanel vendorLocationId={locationId} />
            </>
          )}
          {view === 'catalogue' && (
            <>
              <CatalogueStudio vendorLocationId={locationId} />
            </>
          )}
          {view === 'store' && (
            <>
              <StoreSettingsPanel vendorLocationId={locationId} />
            </>
          )}
          {view === 'payouts' && <PayoutsPanel vendorLocationId={locationId} />}
          {view === 'inventory' && <InventoryPanel vendorLocationId={locationId} />}
          {view === 'imports' && <CatalogueImportPanel vendorLocationId={locationId} />}
          {view === 'service-area' && <ServiceAreaPanel vendorLocationId={locationId} />}
          {view === 'staff' && <StaffPanel vendorLocationId={locationId} />}
          {view === 'insights' && <InsightsPanel vendorLocationId={locationId} />}
          {view === 'onboarding' && <VendorOnboardingPanel />}
          {view === 'more' && (
            <section className="ns-stack">
              <p className="ns-eyebrow">Account</p>
              <h1>Store access and support</h1>
              <p>
                {locations.length > 1
                  ? `This account works ${locations.length} locations. Switch between them from the store selector above.`
                  : 'Your authenticated account controls the location shown in this workspace.'}
              </p>
              <Link className="ns-button ns-button--secondary ns-button--medium" href="/onboarding">
                <span className="ns-button__label">Open onboarding record</span>
              </Link>
            </section>
          )}
        </section>
      )}
    </AppShell>
  );
}
