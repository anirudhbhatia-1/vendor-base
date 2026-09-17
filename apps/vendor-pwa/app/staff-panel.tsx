'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  formatRelativeTime,
} from '@neighbourhood-store/ui';
import { vendorRequest } from './authenticated-api';

/**
 * Staff, roles and the store's own access record (VEN-10, VEN-11).
 *
 * The invitation field used to ask for a "user identifier" and the route
 * behind it required a UUIDv7. Nothing in this product ever shows one person
 * another person's internal id, so every value a shopkeeper could physically
 * type was rejected — which is the "Something in that request was not valid"
 * this screen answered with. Invitations are addressed by phone number now,
 * the same identifier the invitee signs in with.
 */
type StaffMember = {
  readonly user_id: string;
  readonly role: string;
  readonly granted_at: string;
};

type ActivityEntry = {
  readonly event_type: string;
  readonly actor_user_id: string;
  readonly target_user_id: string | null;
  readonly reason_code: string;
  readonly occurred_at: string;
};

type MyAccess = {
  readonly role: string;
  readonly capabilities: readonly string[];
  readonly user_id: string;
};

const ROLES = [
  {
    value: 'VENDOR_PICKER',
    label: 'Picker',
    detail: 'Can pick and pack orders. Cannot change prices, settings or staff.',
  },
  {
    value: 'VENDOR_MANAGER',
    label: 'Manager',
    detail: 'Can run the shop day to day — catalogue, orders and settings.',
  },
] as const;

const ROLE_LABEL: Record<string, string> = {
  VENDOR_OWNER: 'Owner',
  VENDOR_MANAGER: 'Manager',
  VENDOR_PICKER: 'Picker',
};

const ACTIVITY_LABEL: Record<string, string> = {
  SETTINGS_UPDATED: 'Settings changed',
  STAFF_INVITED: 'Person added',
  STAFF_REVOKED: 'Access removed',
};

/**
 * A stable, readable handle for someone whose name this store does not hold.
 *
 * The screen printed the first eight characters of a UUID followed by an
 * ellipsis, which reads as a truncation bug rather than a reference. Users are
 * addressed by phone at invite time and identified by role afterwards, so the
 * id only ever needs to distinguish two rows from each other.
 */
function personReference(userId: string): string {
  return `#${userId.replaceAll('-', '').slice(-6).toUpperCase()}`;
}

export function StaffPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [staff, setStaff] = useState<readonly StaffMember[]>([]);
  const [activity, setActivity] = useState<readonly ActivityEntry[]>([]);
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>('VENDOR_PICKER');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Relative times need an explicit clock so the server and the first client
  // render agree; the shared formatter takes it rather than reading Date.now().
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!vendorLocationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [list, history, mine] = await Promise.all([
        vendorRequest<{ staff: readonly StaffMember[] }>(
          `vendor/locations/${vendorLocationId}/staff`,
        ),
        vendorRequest<{ activity: readonly ActivityEntry[] }>(
          `vendor/locations/${vendorLocationId}/staff/activity?limit=25`,
        ),
        vendorRequest<MyAccess>(`vendor/locations/${vendorLocationId}/access/mine`),
      ]);
      setStaff(list.staff);
      setActivity(history.activity);
      setAccess(mine);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The staff list failed to load.');
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = access?.role === 'VENDOR_OWNER';

  async function invite() {
    const entered = phone.trim();
    if (!entered) {
      setNotice({ tone: 'danger', text: 'Enter the phone number they sign in with.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await vendorRequest(`vendor/locations/${vendorLocationId}/staff/invite`, {
        method: 'POST',
        body: JSON.stringify({ invitee_phone: entered, role }),
      });
      setPhone('');
      const named = ROLES.find((entry) => entry.value === role)?.label ?? 'staff member';
      setNotice({ tone: 'success', text: `Added as ${named.toLowerCase()}.` });
      await load();
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'The invitation failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(member: StaffMember) {
    setBusy(true);
    setNotice(null);
    try {
      await vendorRequest(`vendor/locations/${vendorLocationId}/staff/revoke`, {
        method: 'POST',
        body: JSON.stringify({
          target_user_id: member.user_id,
          role: member.role,
          reason_code: 'VENDOR_STAFF_REMOVED',
        }),
      });
      setNotice({
        tone: 'success',
        text: 'Access removed. They lose it on their next request, not on their next sign-in.',
      });
      await load();
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'The change could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      description={
        staff.length === 1 ? '1 person has access.' : `${staff.length} people have access.`
      }
      eyebrow="People"
      id="staff-panel"
      title="Who can act for this store"
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {isOwner ? (
        <Card className="staff-invite">
          <h3>Add someone</h3>
          <p className="staff-invite__hint">
            Use the phone number they sign in with. They need to have opened the app at least once
            before you can add them.
          </p>
          <Field
            autoComplete="tel"
            inputMode="tel"
            label="Phone number"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+91…"
            value={phone}
          />
          <SelectField
            hint={ROLES.find((entry) => entry.value === role)?.detail}
            label="What they can do"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            {ROLES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </SelectField>
          <Button onClick={() => void invite()} disabled={busy} variant="primary">
            Add to this store
          </Button>
        </Card>
      ) : (
        <Notice tone="information">
          Only the owner can add or remove people. You can see who has access.
        </Notice>
      )}

      {loading && <LoadingState label="Loading who has access…" />}
      {loadError && !loading && (
        <ErrorState
          description={loadError}
          onRetry={() => void load()}
          title="Cannot show access"
        />
      )}

      {!loading && !loadError && staff.length === 0 && (
        <EmptyState
          title="Nobody else yet"
          description="Add a picker so someone can pack orders while you serve the counter."
        />
      )}

      <div className="staff-list">
        {!loading &&
          !loadError &&
          staff.map((member) => {
            const you = member.user_id === access?.user_id;
            const owner = member.role === 'VENDOR_OWNER';
            return (
              <Card className="staff-row" key={member.user_id}>
                <div className="staff-row__identity">
                  <h3>
                    {ROLE_LABEL[member.role] ?? member.role}
                    {you ? ' · you' : ''}
                  </h3>
                  <p className="staff-row__reference">{personReference(member.user_id)}</p>
                </div>
                <div className="staff-row__meta">
                  <StatusPill state="ACTIVE" label="Has access" />
                  <span>Added {formatRelativeTime(member.granted_at, now)}</span>
                </div>
                {/*
                  The owner's own membership is what proves this store belongs to
                  someone, so the server refuses to revoke it. Offering the button
                  anyway produced a failure the shopkeeper could not act on.
                */}
                {isOwner && !owner && (
                  <Button
                    disabled={busy}
                    onClick={() => void revoke(member)}
                    size="small"
                    variant="danger"
                  >
                    Remove access
                  </Button>
                )}
                {owner && <p className="staff-row__note">The owner always keeps access.</p>}
              </Card>
            );
          })}
      </div>

      {activity.length > 0 && (
        <Card className="staff-activity">
          <h3>Recent access changes</h3>
          <ul>
            {activity.map((entry, index) => (
              <li key={`${entry.occurred_at}-${index}`}>
                <span>{ACTIVITY_LABEL[entry.event_type] ?? entry.event_type}</span>
                <span>
                  {entry.target_user_id ? personReference(entry.target_user_id) : ''}{' '}
                  {formatRelativeTime(entry.occurred_at, now)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Panel>
  );
}
