'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { WhoAmI } from '@neighbourhood-store/contracts';
import { revokeAndSignOut } from '@neighbourhood-store/pwa-auth';
import { RequireWorkspaceRole } from '@neighbourhood-store/pwa-auth/guard';
import {
  actionErrorText,
  AppShell,
  Button,
  ConfirmDialog,
  DataTable,
  formatMoneyMinor,
  Notice as StatusNotice,
  StatusPill,
  TopBar,
  type DataTableColumn,
} from '@neighbourhood-store/ui';
import { adminRequest, apiUrl } from './authenticated-api';
import { CorrectionsPanel } from './corrections-panel';
import { FinanceQueuesPanel } from './finance-queues-panel';
import { IncidentsPanel } from './incidents-panel';
import { OperationsHealthPanel } from './operations-health-panel';
import { OrderInterventionPanel } from './order-intervention-panel';
import { PartnerExceptionsPanel } from './partner-exceptions-panel';
import { PartnerDocumentsPanel } from './partner-documents-panel';
import { PolicyPanel } from './policy-panel';
import { ZoneControlsPanel } from './zone-controls-panel';
import { VerificationPanel } from './verification-panel';
import { ReportingPanel } from './reporting-panel';
import { SupportPanel } from './support-panel';
import { TrustPanel } from './trust-panel';
import { OnboardingPanel } from './onboarding-panel';
import { getSupabase, supabaseConfigured } from './supabase-client';
import { LifecyclePanel } from './lifecycle-panel';
import { AdminModuleNavigation } from './module-menu';

type Publication = {
  publication_case_id: string;
  lifecycle_state: string;
  version: number;
  vendor_location_id: string;
};
/** One row of the operator's ranked work (11.1), as the server ranked it. */
export type WorkItem = {
  rank: number;
  kind: string;
  tier: 'SAFETY_SECURITY' | 'LEDGER' | 'LIVE_ORDER' | 'COMPLIANCE' | 'ROUTINE';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  object_kind: string;
  object_id: string;
  title: string;
  owner: string;
  next_action: string;
  risk_minor: number;
  custody_risk: 'NONE' | 'GOODS_IN_CUSTODY';
  created_at: string;
  sla_due_at: string;
  age_seconds: number;
  overdue: boolean;
  escalation_due: boolean;
  escalation_owner: string;
};

type DashboardTrace = { request_id: string; correlation_id: string; audit_event_id: string };

const TIER_LABEL: Record<WorkItem['tier'], string> = {
  SAFETY_SECURITY: 'Safety & security',
  LEDGER: 'Ledger',
  LIVE_ORDER: 'Live orders',
  COMPLIANCE: 'Compliance',
  ROUTINE: 'Routine',
};

/**
 * A refused request, said safely (11.1): a queue outside the operator's role
 * is named as such, and nothing about its contents is implied.
 */
export function accessDeniedMessage(error: unknown, label: string): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return 'Your session has ended. Sign in again to see your work.';
  if (status === 403 || status === 404) return `${label} is not part of your role.`;
  return error instanceof Error ? error.message : `${label} could not be loaded.`;
}

/** When a row is due, in the operator's terms. */
export function dueSentence(
  item: Pick<WorkItem, 'sla_due_at' | 'overdue' | 'escalation_due' | 'escalation_owner'>,
  now: Date,
): string {
  const minutes = Math.round((new Date(item.sla_due_at).getTime() - now.getTime()) / 60_000);
  if (item.overdue)
    return `overdue by ${Math.abs(minutes)} min · escalate to ${item.escalation_owner.toLowerCase().replaceAll('_', ' ')}`;
  return `due in ${minutes} min${item.escalation_due ? ` · escalate to ${item.escalation_owner.toLowerCase().replaceAll('_', ' ')}` : ''}`;
}
type Moderation = {
  moderation_case_id: string;
  moderation_state: 'PENDING' | 'CLEARED' | 'CORRECTION_REQUIRED' | 'RESTRICTED';
  product_reference: string;
  display_name: string;
  reason_code: string;
  correction_reason: string | null;
  version: number;
};
type Notice = { in_app_notification_id: string; template_key: string; read_at: string | null };

export type AdminView =
  | 'overview'
  | 'finance'
  | 'trust'
  | 'incidents'
  | 'vendors'
  | 'partners'
  | 'orders'
  | 'catalogue'
  | 'zones'
  | 'support'
  | 'access'
  | 'onboarding'
  | 'reporting'
  | 'audit';

/**
 * The workspace shell is gated in the browser, not only in `proxy.ts`: the
 * Cloudflare Pages build is a static export where no proxy runs, and the proxy
 * never checked the caller's role in any build.
 */
/** Reads the first present string field, so rows from either finance surface render. */
function rowText(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '—';
}

function rowMoney(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return formatMoneyMinor(value);
  }
  return '—';
}

/**
 * The finance exception queue as a table (design.md admin rules), in place of
 * the JSON dump operators were reading. Field names are read defensively so
 * the v2 exception shape and older rows both render.
 */
const FINANCE_EXCEPTION_COLUMNS: readonly DataTableColumn<Record<string, unknown>>[] = [
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => rowText(row, ['exception_kind', 'kind', 'exception_type']),
  },
  {
    key: 'state',
    header: 'State',
    render: (row) => rowText(row, ['exception_state', 'state', 'status']),
  },
  {
    key: 'reference',
    header: 'Payment / order',
    render: (row) =>
      // The queue row's references (11.5); the old reads always showed a dash.
      rowText(row, ['business_reference', 'provider_reference', 'operation_reference']),
  },
  {
    key: 'amount',
    header: 'Amount',
    numeric: true,
    render: (row) => rowMoney(row, ['amount_at_risk_minor', 'expected_minor']),
  },
  {
    key: 'opened',
    header: 'Opened',
    render: (row) => {
      const opened = rowText(row, ['opened_at', 'created_at', 'recorded_at']);
      return opened === '—' ? opened : new Date(opened).toLocaleString();
    },
  },
];

export function AdminWorkspace({ view }: { view: AdminView }) {
  return (
    <RequireWorkspaceRole
      apiUrl={apiUrl}
      client={getSupabase()}
      configured={supabaseConfigured()}
      workspaceRole="admin"
    >
      <AdminWorkspaceContent view={view} />
    </RequireWorkspaceRole>
  );
}

function AdminWorkspaceContent({ view }: { view: AdminView }) {
  const pathname = usePathname();
  const router = useRouter();
  const [publications, setPublications] = useState<Publication[]>([]);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [workQueues, setWorkQueues] = useState<string[]>([]);
  const [workTrace, setWorkTrace] = useState<DashboardTrace | null>(null);
  const [workNotice, setWorkNotice] = useState('');
  const [moderation, setModeration] = useState<Moderation[]>([]);
  const [output, setOutput] = useState('Refresh queues to load current operational work.');
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accessUserId, setAccessUserId] = useState('');
  const [accessRole, setAccessRole] = useState('SUPPORT_AGENT');
  const [roleAssignmentId, setRoleAssignmentId] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [partnerApplicationId, setPartnerApplicationId] = useState('');
  const [partnerApplicationVersion, setPartnerApplicationVersion] = useState(1);
  const [financeExceptions, setFinanceExceptions] = useState<Record<string, unknown>[]>([]);
  const [payments, setPayments] = useState<Record<string, unknown>[]>([]);
  const [ownAccess, setOwnAccess] = useState<WhoAmI | null>(null);
  const [eligiblePartners, setEligiblePartners] = useState<Record<string, unknown>[]>([]);
  const [dispatchPartnerId, setDispatchPartnerId] = useState('');
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundOrderReference, setRefundOrderReference] = useState('');
  const [refundMinor, setRefundMinor] = useState('');
  const [refundId, setRefundId] = useState('');
  const [refundVersion, setRefundVersion] = useState(1);
  // The decision modal for refund actions: which action is being confirmed,
  // whether it is running, and its failure — kept inside the dialog so the
  // operator's context survives the error (design.md §12).
  const [refundConfirm, setRefundConfirm] = useState<'create' | 'approve' | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [ordersMonitor, setOrdersMonitor] = useState<Record<string, unknown>[]>([]);
  const [zones, setZones] = useState<
    readonly {
      service_zone_id: string;
      vendor_location_id: string;
      zone_name: string;
      lifecycle_state: 'ACTIVE' | 'RETIRED';
      operating_timezone: string;
      location_name: string;
      location_lifecycle_state: string;
      latitude: number;
      longitude: number;
    }[]
  >([]);

  async function request(path: string, init?: RequestInit) {
    return adminRequest<unknown>(path, init);
  }
  async function signOut() {
    setSigningOut(true);
    try {
      const client = getSupabase();
      if (client) await revokeAndSignOut({ apiUrl, client });
      router.replace('/login');
      router.refresh();
    } catch {
      setOutput('Sign-out could not be completed. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    // Each queue loads on its own (11.1): one outside the operator's role
    // used to fail the whole refresh, so a finance operator saw nothing at all.
    try {
      const [p, d, m] = await Promise.allSettled([
        request('admin/vendor-publications'),
        request('admin/control/dashboard'),
        request('admin/catalogue/moderation'),
      ]);
      const notices: string[] = [];
      if (p.status === 'fulfilled')
        setPublications((p.value as { cases: Publication[] }).cases ?? []);
      else setPublications([]);
      if (d.status === 'fulfilled') {
        const dashboard = d.value as {
          items?: WorkItem[];
          queues?: string[];
          trace?: DashboardTrace;
        };
        setWork(dashboard.items ?? []);
        setWorkQueues(dashboard.queues ?? []);
        setWorkTrace(dashboard.trace ?? null);
        setWorkNotice(
          (dashboard.queues ?? []).length === 0 ? 'No work queues are part of your role.' : '',
        );
      } else {
        setWork([]);
        setWorkQueues([]);
        setWorkTrace(null);
        setWorkNotice(accessDeniedMessage(d.reason, 'The operations dashboard'));
      }
      if (m.status === 'fulfilled')
        setModeration((m.value as { cases?: Moderation[] }).cases ?? []);
      else setModeration([]);
      if (d.status === 'rejected')
        notices.push(accessDeniedMessage(d.reason, 'The operations dashboard'));
      setOutput(
        notices.length > 0
          ? notices.join(' ')
          : 'Server queues refreshed. No local decision state is used.',
      );
    } finally {
      setRefreshing(false);
    }
  }
  async function partnerReview(action: 'start-review' | 'approve' | 'reject') {
    if (!partnerApplicationId) {
      setOutput('Enter a partner application ID first.');
      return;
    }
    try {
      const body =
        action === 'approve'
          ? {
              expected_version: partnerApplicationVersion,
              reviewer_note: 'Company-test review completed.',
            }
          : action === 'reject'
            ? {
                expected_version: partnerApplicationVersion,
                reason_note: 'Company-test rejection.',
              }
            : { expected_version: partnerApplicationVersion };
      await request(`admin/partner-applications/${partnerApplicationId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPartnerApplicationVersion((v) => v + 1);
      setOutput(`Partner application ${action} completed.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : `Partner ${action} failed.`);
    }
  }

  async function publicationAction(
    item: Publication,
    action: 'readiness' | 'submit' | 'publish' | 'decision',
  ) {
    try {
      const body =
        action === 'decision'
          ? {
              expected_version: item.version,
              decision: 'APPROVED',
              evidence_reference: `PUBLICATION-EVIDENCE-${Date.now().toString(36).toUpperCase()}`,
              note: 'Company-test checks reviewed.',
              reason_code: 'COMPANY_TEST_APPROVAL',
            }
          : {
              expected_version: item.version,
              note: 'Company-test transition.',
              reason_code: 'COMPANY_TEST_TRANSITION',
            };
      await request(`admin/vendor-publications/${item.publication_case_id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refresh();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Action failed.');
    }
  }
  /**
   * ADM-02. An operator who cannot see their own scope has to discover it by
   * hitting a 403, so this reads the same `whoami` the API authorises against.
   */
  async function loadOwnAccess() {
    try {
      const result = await request('auth/whoami');
      setOwnAccess(result as WhoAmI);
      setOutput('Your effective roles are listed below.');
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Your access summary failed to load.');
    }
  }

  async function grantMembership() {
    try {
      const result = (await request(`admin/access/users/${accessUserId}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ role: accessRole, scope_kind: 'GLOBAL' }),
      })) as { role_assignment_id: string };
      setRoleAssignmentId(result.role_assignment_id);
      setOutput(`Membership granted: ${result.role_assignment_id}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Membership grant failed.');
    }
  }
  async function revokeMembership() {
    try {
      await request(`admin/access/users/${accessUserId}/memberships/${roleAssignmentId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason_code: 'ADMIN_ACCESS_REVOKED' }),
      });
      setOutput(`Membership revoked: ${roleAssignmentId}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Membership revoke failed.');
    }
  }
  async function loadNotifications() {
    try {
      setNotices((await request('notifications?unread_only=true')) as Notice[]);
      setOutput('Unread notification inbox refreshed.');
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Notification inbox failed.');
    }
  }
  async function loadZones() {
    try {
      const result = (await request('admin/zones')) as { zones?: unknown };
      const list = Array.isArray(result.zones) ? (result.zones as typeof zones) : [];
      setZones(list);
      setOutput(`Loaded ${list.length} service zone(s).`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Zones failed.');
    }
  }

  // A control room shows its work on arrival. Every view used to open empty
  // -- "Refresh queues to load current operational work." -- until a button
  // was pressed, and the catalogue view said "0 live cases" over a queue that
  // was not empty. The loaders are plain closures on this component, so the
  // effect runs on mount and whenever the view changes.
  useEffect(() => {
    void refresh();
    if (view === 'orders') void loadOrdersMonitor();
    if (view === 'zones') void loadZones();
    if (view === 'finance') {
      void loadFinanceExceptions();
      void loadPayments();
    }
    if (view === 'access') void loadOwnAccess();
  }, [view]);

  async function loadOrdersMonitor() {
    try {
      const result = await request('admin/control/orders');
      const parsed = (result ?? {}) as {
        checkout_groups?: unknown[];
        vendor_orders?: unknown[];
        delivery_assignments?: unknown[];
        orders?: unknown[];
      };
      const combined = [
        ...(parsed.checkout_groups ?? []),
        ...(parsed.vendor_orders ?? []),
        ...(parsed.delivery_assignments ?? []),
        ...(parsed.orders ?? []),
      ] as Record<string, unknown>[];
      setOrdersMonitor(combined);
      setOutput(`Order monitor: ${combined.length} entries.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Order monitor failed.');
    }
  }

  async function loadFinanceExceptions() {
    try {
      const result = await request('admin/finance/queues');
      const list = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
      setFinanceExceptions(list as Record<string, unknown>[]);
      setOutput(`Finance exceptions loaded: ${list.length} items.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Finance exceptions failed.');
    }
  }

  async function decideModeration(
    item: Moderation,
    nextState: 'CLEARED' | 'CORRECTION_REQUIRED' | 'RESTRICTED',
  ) {
    try {
      await request(`admin/catalogue/moderation/${item.moderation_case_id}/decision`, {
        method: 'PUT',
        body: JSON.stringify({
          expected_version: item.version,
          moderation_state: nextState,
          reason_code: 'ADMIN_MODERATION_DECISION',
          ...(nextState === 'CORRECTION_REQUIRED'
            ? { correction_reason: 'Listing needs correction before it can be cleared.' }
            : {}),
        }),
      });
      setOutput(`Case ${item.product_reference} set to ${nextState}.`);
      await refresh();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Moderation decision failed.');
    }
  }

  /**
   * Manual dispatch (ADM-29).
   *
   * `POST admin/delivery/assignments/:id/offer` and the eligible-partner lookup
   * existed with no caller, so when automatic dispatch had nobody to offer to,
   * operations had no way to intervene.
   */
  async function loadEligiblePartners(vendorLocationId: string) {
    try {
      const result = (await request(`admin/delivery/eligible-partners/${vendorLocationId}`)) as {
        partners?: Record<string, unknown>[];
      };
      const list = Array.isArray(result) ? result : (result.partners ?? []);
      setEligiblePartners(list as Record<string, unknown>[]);
      setOutput(`Eligible partners: ${list.length}.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Eligible partner lookup failed.');
    }
  }

  async function offerAssignment(entry: Record<string, unknown>) {
    if (!dispatchPartnerId) {
      setOutput('Choose a partner to offer this assignment to.');
      return;
    }
    try {
      await request(`admin/delivery/assignments/${String(entry['delivery_assignment_id'])}/offer`, {
        method: 'POST',
        body: JSON.stringify({
          command_reference: `SYNTH-CMD-MANUAL-OFFER-${Date.now().toString(36).toUpperCase()}`,
          expected_version: Number(entry['version'] ?? 1),
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          partner_user_id: dispatchPartnerId,
          reason_code: 'ADMIN_MANUAL_DISPATCH',
        }),
      });
      setOutput('Assignment offered to the selected partner.');
      await loadOrdersMonitor();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Manual dispatch failed.');
    }
  }

  /**
   * Manual reassignment (9.3). An operator takes an attempt off the partner
   * holding it -- offered, accepted or at the store, nothing collected -- with
   * a reason and the compensation decided for the partner displaced. The
   * attempt returns to the pool; that partner is not offered it again.
   */
  async function reassignAssignment(entry: Record<string, unknown>) {
    const rupees = window.prompt(
      'Compensation for the partner this is taken from, in rupees (0 for none)?',
      '0',
    );
    if (rupees === null) return;
    const compensationMinor = Math.round(Number(rupees) * 100);
    if (!Number.isFinite(compensationMinor) || compensationMinor < 0) {
      setOutput('Enter the compensation in rupees.');
      return;
    }
    const reason = window.prompt(
      'Reason (PARTNER_VEHICLE_BREAKDOWN, PARTNER_UNREACHABLE, OPERATOR_REASSIGNED)?',
      'OPERATOR_REASSIGNED',
    );
    if (!reason) return;
    try {
      await request(
        `admin/delivery/assignments/${String(entry['delivery_assignment_id'])}/end-before-pickup`,
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `SYNTH-CMD-REASSIGN-${Date.now().toString(36).toUpperCase()}`,
            compensation_minor: compensationMinor,
            expected_version: Number(entry['version'] ?? 1),
            reason_code: reason
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '_'),
            resulting_state: 'REASSIGNED',
          }),
        },
      );
      setOutput('Attempt returned to the pool; the compensation is on the partner’s record.');
      await loadOrdersMonitor();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Reassignment failed.');
    }
  }

  async function loadPayments() {
    try {
      const result = (await request('admin/finance/payments')) as {
        payments?: Record<string, unknown>[];
      };
      const list = result.payments ?? [];
      setPayments(list);
      setOutput(`Payments loaded: ${list.length}.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Payment list failed.');
    }
  }

  // A refund applies to a payment transaction, not to a vendor order: payments
  // are keyed by checkout reference and cover the whole checkout group. The
  // operator therefore picks the payment and states the item component; tax,
  // delivery, tip and discount reversal are separate ledger components.
  async function createRefund() {
    const reference = `REFUND-${Date.now().toString(36).toUpperCase()}`;
    const result = (await request('admin/finance/refunds', {
      method: 'POST',
      body: JSON.stringify({
        command_reference: reference,
        delivery_minor: 0,
        discount_reversal_minor: 0,
        item_minor: Number(refundMinor),
        payment_transaction_id: refundPaymentId,
        provider_operation_reference: `SYNTH-REFUND-${reference}`,
        provider_scenario: 'SUCCESS',
        source_order_reference: refundOrderReference,
        tax_minor: 0,
        tip_minor: 0,
        trigger_code: 'PARTIAL_ITEM_REFUND',
      }),
    })) as { refund_id: string; version?: number };
    setRefundId(result.refund_id);
    setRefundVersion(result.version ?? 1);
    setOutput(`Refund created: ${result.refund_id}`);
  }

  async function approveRefund() {
    const result = (await request(`admin/finance/refunds/${refundId}/approve-submit`, {
      method: 'POST',
      body: JSON.stringify({
        command_reference: `APPROVE-${Date.now().toString(36).toUpperCase()}`,
        expected_version: refundVersion,
      }),
    })) as { version?: number; refund_state?: string };
    setRefundVersion(result.version ?? refundVersion + 1);
    setOutput(`Refund ${refundId} ${result.refund_state ?? 'approved and submitted'}.`);
  }

  /** Runs the confirmed refund action; a failure stays inside the dialog. */
  async function confirmRefundAction() {
    if (!refundConfirm) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      if (refundConfirm === 'create') await createRefund();
      else await approveRefund();
      setRefundConfirm(null);
    } catch (cause) {
      setRefundError(actionErrorText(cause, 'The refund action failed.'));
    } finally {
      setRefundBusy(false);
    }
  }

  return (
    <AppShell
      className="admin-workbench"
      surface="admin"
      tabs={<AdminModuleNavigation pathname={pathname} />}
      topBar={
        <TopBar
          actions={
            <>
              <StatusPill label="Secure session" state="AVAILABLE" />
              <Button
                busy={signingOut}
                onClick={() => void signOut()}
                size="small"
                variant="secondary"
              >
                Sign out
              </Button>
            </>
          }
          brand={
            <span className="workspace-brand">
              <span aria-hidden="true" className="workspace-mark">
                AO
              </span>
              <span>
                <strong>Marketplace control room</strong>
                <small>Admin operations</small>
              </span>
            </span>
          }
        />
      }
    >
      {view === 'overview' && (
        <section className="command-header">
          <div>
            <p className="eyebrow">ACCOUNTABLE OPERATIONS</p>
            <h1>Act on server truth.</h1>
            <p>
              Publication, catalogue, support, trust, incident, finance and audit work stay
              capability-scoped.
            </p>
          </div>
        </section>
      )}
      <div className="admin-status-bar">
        <p role="status" aria-live="polite">
          {output}
        </p>
        <Button busy={refreshing} variant="secondary" onClick={() => void refresh()}>
          Refresh queues
        </Button>
      </div>
      {view === 'overview' && (
        <section className="workspace" id="risk-work">
          <aside className="queue">
            <div className="queue-heading">
              <strong>Risk-ranked work</strong>
              <span>{work.length}</span>
            </div>
            {workNotice && <p role="status">{workNotice}</p>}
            {work.map((item) => (
              <div className="queue-row" key={`${item.kind}-${item.object_id}`}>
                <span>
                  <strong>
                    {item.rank}. {TIER_LABEL[item.tier]} · {item.severity.toLowerCase()} ·{' '}
                    {item.title}
                  </strong>
                  <small>
                    {item.next_action.toLowerCase().replaceAll('_', ' ')} · owner {item.owner} ·{' '}
                    {dueSentence(item, new Date())} · open {Math.round(item.age_seconds / 60)} min
                  </small>
                  <small>
                    {item.object_kind.toLowerCase().replaceAll('_', ' ')}{' '}
                    {item.object_id.slice(0, 8)}
                    {item.risk_minor ? ` · ₹${(item.risk_minor / 100).toFixed(2)} at risk` : ''}
                    {item.custody_risk === 'GOODS_IN_CUSTODY'
                      ? ' · goods in a partner’s custody'
                      : ''}
                  </small>
                </span>
              </div>
            ))}
            {workTrace && (
              <small>
                Queues: {workQueues.join(', ').toLowerCase().replaceAll('_', ' ')}. This view was
                recorded as audit event {workTrace.audit_event_id.slice(0, 8)} under request{' '}
                {workTrace.request_id.slice(0, 8)}.
              </small>
            )}
          </aside>
          <article className="case-workbench">
            <p className="eyebrow">SHIFT PRIORITY</p>
            <h2>{work.length ? 'Open the highest-risk item' : 'No risk-ranked work loaded'}</h2>
            <p>Safety and money risks stay ahead of routine pipeline work.</p>
          </article>
        </section>
      )}
      {view === 'onboarding' && (
        <section className="admin-route-page" aria-labelledby="onboarding-title">
          <div className="admin-route-heading">
            <p className="eyebrow">ONBOARD NEW ROLES</p>
            <h1 id="onboarding-title">Create vendors and partners with working credentials.</h1>
            <p>
              Provisioned accounts can sign in immediately with the one-time email and temporary
              password issued here.
            </p>
          </div>
          <OnboardingPanel />
        </section>
      )}
      {view === 'vendors' && (
        <section className="admin-route-page" aria-labelledby="vendors-title">
          <div className="admin-route-heading">
            <p className="eyebrow">VENDOR PIPELINE</p>
            <h1 id="vendors-title">Move trustworthy stores toward live.</h1>
            <p>Review readiness, evidence and publication as separate accountable decisions.</p>
          </div>
          <article className="case-workbench" id="vendor-publication">
            <p className="eyebrow">VENDOR PUBLICATION</p>
            <h2>{publications.length} persisted cases</h2>
            {publications.map((item) => (
              <div className="catalogue-flag" key={item.publication_case_id}>
                <strong>
                  {item.lifecycle_state} · v{item.version}
                </strong>
                <span>{item.vendor_location_id}</span>
                <div className="actions">
                  <button onClick={() => void publicationAction(item, 'readiness')}>
                    Evaluate
                  </button>
                  <button onClick={() => void publicationAction(item, 'submit')}>Submit</button>
                  <button onClick={() => void publicationAction(item, 'decision')}>Approve</button>
                  <button onClick={() => void publicationAction(item, 'publish')}>Publish</button>
                </div>
              </div>
            ))}
          </article>
          <LifecyclePanel kind="vendors" />
        </section>
      )}
      {(view === 'vendors' || view === 'partners') && <VerificationPanel />}
      {view === 'partners' && (
        <section className="admin-route-page" aria-labelledby="partners-title">
          <div className="admin-route-heading">
            <p className="eyebrow">DELIVERY PARTNERS</p>
            <h1 id="partners-title">Verify people before dispatch.</h1>
            <p>Identity, vehicle, bank and training checks form one review trail.</p>
          </div>
          <article className="case-workbench" id="partner-application-review">
            <p className="eyebrow">PARTNER APPLICATION REVIEW</p>
            <div className="catalogue-flag">
              <label>
                Partner application ID
                <input
                  value={partnerApplicationId}
                  onChange={(e) => setPartnerApplicationId(e.target.value)}
                  placeholder="UUID"
                />
              </label>
              <label>
                Expected version
                <input
                  type="number"
                  value={partnerApplicationVersion}
                  onChange={(e) => setPartnerApplicationVersion(Number(e.target.value))}
                  min={1}
                />
              </label>
              <div className="actions">
                <button onClick={() => void partnerReview('start-review')}>Start review</button>
                <button onClick={() => void partnerReview('approve')}>Approve</button>
                <button onClick={() => void partnerReview('reject')}>Reject</button>
              </div>
            </div>
          </article>
          <PartnerDocumentsPanel />
          <LifecyclePanel kind="partners" />
        </section>
      )}
      {view === 'orders' && <PartnerExceptionsPanel />}
      {view === 'orders' && <OperationsHealthPanel />}
      {view === 'orders' && (
        <section className="admin-route-page" aria-labelledby="orders-title">
          <div className="admin-route-heading">
            <p className="eyebrow">LIVE OPERATIONS</p>
            <h1 id="orders-title">Keep every order moving honestly.</h1>
            <p>Live order monitor with acceptance, custody, and delivery state.</p>
          </div>
          <div className="admin-card-grid">
            <article>
              <span>Active exceptions</span>
              <strong>{work.filter((item) => item.kind.includes('ORDER')).length}</strong>
              <p>Server-ranked after queue refresh.</p>
            </article>
            <article>
              <span>Loaded orders</span>
              <strong>{ordersMonitor.length}</strong>
              <p>Refresh loads latest checkout groups and their status.</p>
            </article>
          </div>
          <button onClick={() => void loadOrdersMonitor()}>Refresh order monitor</button>
          <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
            {ordersMonitor.length === 0 && <p>No orders loaded yet. Click refresh.</p>}
            {ordersMonitor.map((entry, idx) => (
              <article key={idx}>
                <span>
                  {/* A group is what its orders are (7.7); the payment's own
                      state follows in brackets when the two differ. */}
                  {String(
                    entry['derived_lifecycle_state'] ??
                      entry['lifecycle_state'] ??
                      entry['assignment_state'] ??
                      'PENDING',
                  )}
                  {typeof entry['derived_lifecycle_state'] === 'string' &&
                  entry['derived_lifecycle_state'] !== entry['lifecycle_state']
                    ? ` (payment ${String(entry['lifecycle_state'])})`
                    : ''}
                </span>
                <strong>
                  {String(
                    entry['order_reference'] ??
                      entry['checkout_reference'] ??
                      entry['delivery_assignment_id'] ??
                      '—',
                  )}
                </strong>
                <p>
                  {typeof entry['total_minor'] === 'number' ||
                  typeof entry['total_minor'] === 'string'
                    ? `₹${(Number(entry['total_minor']) / 100).toFixed(2)}`
                    : ''}
                  {entry['vendor_location_id']
                    ? ` · vendor ${String(entry['vendor_location_id']).slice(0, 8)}…`
                    : ''}
                </p>
                {Boolean(entry['delivery_assignment_id']) &&
                  String(entry['assignment_state'] ?? '') === 'UNASSIGNED' && (
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() =>
                          void loadEligiblePartners(String(entry['vendor_location_id'] ?? ''))
                        }
                      >
                        Find partners
                      </button>
                      <button type="button" onClick={() => void offerAssignment(entry)}>
                        Offer to selected partner
                      </button>
                    </div>
                  )}
                {Boolean(entry['delivery_assignment_id']) &&
                  ['OFFERED', 'ASSIGNED', 'AT_VENDOR'].includes(
                    String(entry['assignment_state'] ?? ''),
                  ) && (
                    <div className="actions">
                      <button type="button" onClick={() => void reassignAssignment(entry)}>
                        Take off this partner and re-offer
                      </button>
                    </div>
                  )}
              </article>
            ))}
          </div>
          <section className="catalogue-oversight" style={{ marginTop: '1.5rem' }}>
            <div>
              <p className="eyebrow">MANUAL DISPATCH</p>
              <h2>{eligiblePartners.length} eligible partners</h2>
              <p>
                Automatic dispatch retries every worker tick. Use this when an order needs a named
                partner sooner.
              </p>
            </div>
            <label>
              Partner
              <select
                value={dispatchPartnerId}
                onChange={(event) => setDispatchPartnerId(event.target.value)}
              >
                <option value="">Load eligible partners, then choose one</option>
                {eligiblePartners.map((partner) => (
                  <option
                    key={String(partner['partner_user_id'])}
                    value={String(partner['partner_user_id'])}
                  >
                    {String(partner['partner_user_id']).slice(0, 8)}… ·{' '}
                    {String(partner['distance_meters'] ?? '?')} m
                  </option>
                ))}
              </select>
            </label>
          </section>
        </section>
      )}
      {view === 'catalogue' && (
        <section className="catalogue-oversight" id="catalogue-moderation">
          <div>
            <p className="eyebrow">CATALOGUE MODERATION</p>
            <h2>{moderation.length} live cases</h2>
          </div>
          {moderation.length === 0 && <p>No open moderation cases.</p>}
          {moderation.map((item) => (
            <div className="catalogue-flag" key={item.moderation_case_id}>
              <strong>{item.display_name || item.product_reference}</strong>
              <span>
                {item.moderation_state} · {item.reason_code}
              </span>
              {item.correction_reason && <p>{item.correction_reason}</p>}
              <div className="actions">
                <button type="button" onClick={() => void decideModeration(item, 'CLEARED')}>
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => void decideModeration(item, 'CORRECTION_REQUIRED')}
                >
                  Request correction
                </button>
                <button type="button" onClick={() => void decideModeration(item, 'RESTRICTED')}>
                  Restrict
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {view === 'zones' && (
        <>
          <section className="catalogue-oversight" id="zones" style={{ marginBottom: '1.5rem' }}>
            <div>
              <p className="eyebrow">SERVICE ZONES</p>
              <h2>
                {zones.length} zone{zones.length === 1 ? '' : 's'} across all vendor locations
              </h2>
            </div>
            <div className="actions">
              <button type="button" onClick={() => void loadZones()}>
                Refresh zones
              </button>
            </div>
            {zones.map((z) => (
              <div className="catalogue-flag" key={z.service_zone_id}>
                <strong>
                  {z.zone_name} · {z.location_name}
                </strong>
                <span>
                  {z.lifecycle_state} · location {z.location_lifecycle_state} · store at{' '}
                  {z.latitude.toFixed(4)}, {z.longitude.toFixed(4)} · {z.operating_timezone}
                </span>
              </div>
            ))}
            {zones.length === 0 && (
              <p>
                No zones loaded yet — refresh to fetch every service zone the server knows about.
              </p>
            )}
          </section>
        </>
      )}
      {view === 'zones' && <ZoneControlsPanel />}
      {view === 'zones' && <PolicyPanel />}
      {view === 'incidents' && (
        <>
          <h1>Incidents</h1>
          <IncidentsPanel />
        </>
      )}
      {view === 'access' && (
        <section className="catalogue-oversight" id="controlled-access">
          <div>
            <p className="eyebrow">CONTROLLED ACCESS</p>
            <h2>Provision scoped admin memberships</h2>
            <p>Requires CONFIG_APPROVER. Self-grants and conflicting maker/checker roles fail.</p>
          </div>
          <div className="catalogue-flag">
            <label>
              Target user UUID
              <input
                value={accessUserId}
                onChange={(event) => setAccessUserId(event.target.value)}
              />
            </label>
            <label>
              Admin role
              <select value={accessRole} onChange={(event) => setAccessRole(event.target.value)}>
                {[
                  'SUPPORT_AGENT',
                  'DELIVERY_OPERATOR',
                  'CATALOGUE_MODERATOR',
                  'FINANCE_OPERATOR',
                  'FINANCE_APPROVER',
                  'TRUST_OPERATOR',
                  'TRUST_APPROVER',
                  'VENDOR_ONBOARDING_OPERATOR',
                  'VENDOR_ONBOARDING_REVIEWER',
                  'VENDOR_PUBLICATION_OPERATOR',
                  'VENDOR_PUBLICATION_REVIEWER',
                  'CONFIG_OPERATOR',
                  'CONFIG_APPROVER',
                  'INCIDENT_COMMANDER',
                ].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <button onClick={() => void grantMembership()}>Grant global membership</button>
            <label>
              Assignment UUID
              <input
                value={roleAssignmentId}
                onChange={(event) => setRoleAssignmentId(event.target.value)}
              />
            </label>
            <button onClick={() => void revokeMembership()}>Revoke membership</button>
          </div>
          <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
            <p className="eyebrow">YOUR OWN ACCESS</p>
            <p>
              What the server will actually let you do. Hidden buttons are not permissions; this is
              read from the same roles the API enforces on every request.
            </p>
            <div className="actions">
              <button onClick={() => void loadOwnAccess()}>Show my permissions</button>
            </div>
            {ownAccess && (
              <>
                <p>
                  Signed in as {ownAccess.primary_role}
                  {ownAccess.email ? ` · ${ownAccess.email}` : ''}
                </p>
                <ul>
                  {ownAccess.roles.map((role) => (
                    <li key={role.role_assignment_id}>
                      {role.role_key}
                      {role.scope_id ? ` · scope ${role.scope_id.slice(0, 8)}…` : ' · global'}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
      {view === 'support' && (
        <section className="admin-route-page" aria-labelledby="support-title">
          <div className="admin-route-heading">
            <p className="eyebrow">SUPPORT & DISPUTES</p>
            <h1 id="support-title">Resolve the issue. Preserve the trail.</h1>
            <p>
              Order, payment, quality and safety cases keep evidence and customer impact together.
            </p>
          </div>
          <div className="admin-card-grid">
            <article>
              <span>Urgent</span>
              <strong>
                {
                  work.filter(
                    (item) =>
                      item.kind.toLowerCase().includes('safety') ||
                      item.kind.toLowerCase().includes('escalat'),
                  ).length
                }{' '}
                safety cases
              </strong>
              <p>Safety work always outranks routine tickets. Refresh queues to update.</p>
            </article>
            <article>
              <span>Money</span>
              <strong>
                {
                  work.filter(
                    (item) =>
                      item.kind.toLowerCase().includes('money') ||
                      item.kind.toLowerCase().includes('refund') ||
                      item.kind.toLowerCase().includes('payout'),
                  ).length
                }{' '}
                disputes
              </strong>
              <p>Refund and payout actions require controlled authority.</p>
            </article>
            <article>
              <span>Routine</span>
              <strong>
                {work.filter((item) => item.kind.toUpperCase() === 'SUPPORT').length} support cases
              </strong>
              <p>Refresh queues to load SLAs and ownership from the server.</p>
            </article>
          </div>
          <SupportPanel />
          <nav className="actions" aria-label="Related workspaces">
            <Link href="/trust">Trust and safety</Link>
            <Link href="/finance">Finance and refunds</Link>
          </nav>
        </section>
      )}
      {view === 'trust' && (
        <section className="admin-route-page">
          <h1>Trust and safety</h1>
          <TrustPanel />
        </section>
      )}
      {view === 'finance' && (
        <section className="admin-route-page" aria-labelledby="finance-title">
          <div className="admin-route-heading">
            <p className="eyebrow">FINANCE</p>
            <h1 id="finance-title">Exceptions, payouts and refunds</h1>
            <p>
              Review the affected payment and order before proposing an action. Server permissions
              and independent approval rules apply.
            </p>
          </div>
          <section
            className="catalogue-oversight"
            style={{ marginTop: '1.5rem' }}
            aria-label="Finance exceptions"
          >
            <div>
              <p className="eyebrow">FINANCE EXCEPTIONS</p>
              <h2>
                {financeExceptions.length} exception{financeExceptions.length !== 1 ? 's' : ''}
              </h2>
            </div>
            <div className="actions">
              <button type="button" onClick={() => void loadFinanceExceptions()}>
                Load finance exceptions
              </button>
            </div>
            {financeExceptions.length > 0 && (
              <DataTable
                caption="Finance exceptions"
                columns={FINANCE_EXCEPTION_COLUMNS}
                rows={financeExceptions}
                rowKey={(row) =>
                  rowText(row, ['finance_exception_id', 'exception_id']) !== '—'
                    ? rowText(row, ['finance_exception_id', 'exception_id'])
                    : JSON.stringify(row)
                }
              />
            )}
          </section>
          <OrderInterventionPanel />
          <FinanceQueuesPanel />
          <CorrectionsPanel />
          <section
            className="catalogue-oversight"
            style={{ marginTop: '1.5rem' }}
            aria-label="Refund maker-checker"
          >
            <div>
              <p className="eyebrow">REFUND APPROVAL</p>
              <h2>Maker/checker refund</h2>
            </div>
            <div className="catalogue-flag">
              <label>
                Payment transaction
                <select
                  value={refundPaymentId}
                  onChange={(e) => setRefundPaymentId(e.target.value)}
                >
                  <option value="">Load payments, then choose one</option>
                  {payments.map((payment) => (
                    <option
                      key={String(payment['payment_transaction_id'])}
                      value={String(payment['payment_transaction_id'])}
                    >
                      {String(payment['source_checkout_reference'])} ·{' '}
                      {String(payment['payment_state'])} · ₹
                      {(Number(payment['amount_minor']) / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Order reference
                <input
                  list="admin-orders-list"
                  value={refundOrderReference}
                  onChange={(e) => setRefundOrderReference(e.target.value)}
                  placeholder="Order reference the refund applies to"
                />
                <datalist id="admin-orders-list">
                  {ordersMonitor
                    .filter((o) => typeof o['order_reference'] === 'string')
                    .map((o, idx) => (
                      <option key={idx} value={String(o['order_reference'])}>
                        {String(o['lifecycle_state'] ?? '')}
                      </option>
                    ))}
                </datalist>
              </label>
              <label>
                Item amount (paise)
                <input
                  type="number"
                  value={refundMinor}
                  onChange={(e) => setRefundMinor(e.target.value)}
                  placeholder="e.g. 5000"
                  min={1}
                />
              </label>
              <div className="actions">
                <button type="button" onClick={() => void loadPayments()}>
                  Load payments
                </button>
                <button type="button" onClick={() => void loadOrdersMonitor()}>
                  Refresh order list
                </button>
                <button
                  type="button"
                  disabled={!refundPaymentId || !refundOrderReference || !refundMinor}
                  onClick={() => {
                    setRefundError(null);
                    setRefundConfirm('create');
                  }}
                >
                  Create refund…
                </button>
                <button
                  type="button"
                  disabled={!refundId}
                  onClick={() => {
                    setRefundError(null);
                    setRefundConfirm('approve');
                  }}
                >
                  Approve &amp; submit…
                </button>
              </div>
              {refundId && (
                <small>
                  Refund ID: {refundId} (version {refundVersion})
                </small>
              )}
            </div>
          </section>
          <ConfirmDialog
            busy={refundBusy}
            confirmLabel={refundConfirm === 'approve' ? 'Approve and submit' : 'Create refund'}
            error={refundError}
            onCancel={() => setRefundConfirm(null)}
            onConfirm={() => void confirmRefundAction()}
            open={refundConfirm !== null}
            title={
              refundConfirm === 'approve'
                ? 'Approve this refund and submit it to the provider'
                : `Propose a refund of ${refundMinor ? formatMoneyMinor(Number(refundMinor)) : 'the entered amount'}`
            }
            tone="danger"
          >
            {refundConfirm === 'approve' ? (
              <p>
                Refund {refundId} will be submitted to the payment provider and posted to the
                ledger. This is the independent second approval; it cannot be withdrawn once
                submitted.
              </p>
            ) : (
              <p>
                A refund proposal of {refundMinor ? formatMoneyMinor(Number(refundMinor)) : '—'} on
                order {refundOrderReference || '—'} will be created against the selected payment. It
                moves no money until a second person approves it, and it holds part of the order's
                refund cap while open.
              </p>
            )}
          </ConfirmDialog>
        </section>
      )}
      {(view === 'reporting' || view === 'audit') && (
        <>
          <ReportingPanel view={view} />
          <section className="catalogue-oversight" style={{ marginTop: '1.5rem' }}>
            <div>
              <p className="eyebrow">NOTIFICATIONS</p>
              <h2>Operational alerts addressed to you</h2>
            </div>
            <div className="actions">
              <button onClick={() => void loadNotifications()}>Unread notifications</button>
            </div>
            {notices.map((notice) => (
              <p key={notice.in_app_notification_id}>{notice.template_key.replaceAll('.', ' ')}</p>
            ))}
            <StatusNotice tone="information">{output}</StatusNotice>
          </section>
        </>
      )}
      <p className="boundary">Authorized operations only · every sensitive action is audited</p>
    </AppShell>
  );
}
