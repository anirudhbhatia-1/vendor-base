'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { VendorLocationSettings } from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Panel,
  StatusPill,
  formatMoneyMinor,
  parseRupeesToMinor,
} from '@neighbourhood-store/ui';
import { vendorApiClient } from './authenticated-api';
import { displayName } from './display';

/**
 * Store profile, hours, ordering rules and availability (VEN-05, VEN-06, VEN-08).
 *
 * Rebuilt around a read that did not exist. The previous form had no way to
 * learn the store's current values, so it opened on hardcoded defaults —
 * "20 minutes", "₹50", Sunday 08:00–21:00 — and *wrote them over* the real
 * settings on save, wiping the rest of the week's hours in the process. It also
 * asked the shopkeeper to type `expected_version`, an optimistic-concurrency
 * token they had no way of knowing, which is why saving mostly produced a
 * version conflict.
 */
const WEEKDAYS = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [0, 'Sunday'],
] as const;

type DayHours = { readonly open: boolean; readonly opens_at: string; readonly closes_at: string };

function hoursFrom(settings: VendorLocationSettings): Record<number, DayHours> {
  const byDay: Record<number, DayHours> = {};
  for (const [weekday] of WEEKDAYS) {
    const found = settings.hours.find((hour) => hour.weekday === weekday);
    byDay[weekday] = found
      ? { open: true, opens_at: found.opens_at, closes_at: found.closes_at }
      : { open: false, opens_at: '09:00', closes_at: '21:00' };
  }
  return byDay;
}

export function StoreSettingsPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [settings, setSettings] = useState<VendorLocationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prepMinutes, setPrepMinutes] = useState('');
  const [minimum, setMinimum] = useState('');
  const [minimumError, setMinimumError] = useState<string | null>(null);
  const [hours, setHours] = useState<Record<number, DayHours>>({});

  const adopt = useCallback((next: VendorLocationSettings) => {
    setSettings(next);
    setName(displayName(next.location_name));
    setDescription(next.profile_description ?? '');
    setPrepMinutes(
      next.preparation_seconds === null ? '' : String(Math.round(next.preparation_seconds / 60)),
    );
    setMinimum((next.minimum_order_minor / 100).toFixed(2));
    setHours(hoursFrom(next));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const client = await vendorApiClient();
      adopt(await client.vendor.settings.readLocation(vendorLocationId));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Your settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [adopt, vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError(null);
    setMinimumError(null);

    // Integer minor units from the typed digits, never a float multiply.
    const minimumMinor = parseRupeesToMinor(minimum);
    if (minimumMinor === null) {
      setMinimumError('Enter an amount like 50 or 49.50.');
      return;
    }
    const prep = Number(prepMinutes);
    if (prepMinutes !== '' && (!Number.isSafeInteger(prep) || prep <= 0)) {
      setError('Preparation time must be a whole number of minutes.');
      return;
    }
    for (const [weekday, label] of WEEKDAYS) {
      const day = hours[weekday];
      if (day?.open && day.closes_at <= day.opens_at) {
        setError(`${label} closes before it opens.`);
        return;
      }
    }

    setBusy(true);
    try {
      const client = await vendorApiClient();
      const result = await client.vendor.settings.updateLocation(vendorLocationId, {
        // The version comes from the read, not from a box the shopkeeper types.
        expected_version: settings.version,
        location_name: `SYNTH ${name.trim()}`,
        profile_description: description.trim() || null,
        minimum_order_minor: minimumMinor,
        ...(prepMinutes === '' ? {} : { preparation_seconds: prep * 60 }),
        // Every open day, so saving no longer deletes the rest of the week.
        hours: WEEKDAYS.filter(([weekday]) => hours[weekday]?.open).map(([weekday]) => ({
          weekday,
          opens_at: hours[weekday]?.opens_at ?? '09:00',
          closes_at: hours[weekday]?.closes_at ?? '21:00',
        })),
      });
      setMessage('Saved. Customers see this from their next search.');
      // Re-read rather than patch: the write returns only a version, and the
      // server may have normalised what it stored.
      setSettings({ ...settings, version: result.version });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your settings could not be saved. Reload and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function setLifecycle(state: 'ACTIVE' | 'PAUSED') {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const client = await vendorApiClient();
      const result = await client.vendor.settings.setLifecycle(vendorLocationId, {
        state,
        expected_version: settings.version,
      });
      setMessage(
        result.lifecycle_state === 'PAUSED'
          ? 'Your store is paused. Customers cannot place new orders; orders you already accepted are unaffected.'
          : 'Your store is open again and will appear in customer searches.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading your store settings…" lines={4} />;
  if (loadError || !settings) {
    return <ErrorState onRetry={() => void load()} title={loadError ?? 'Settings unavailable'} />;
  }

  const paused = settings.lifecycle_state === 'PAUSED';

  return (
    <Panel
      actions={
        <StatusPill
          label={paused ? 'Paused — not taking orders' : 'Open for orders'}
          state={paused ? 'CLOSED' : 'AVAILABLE'}
        />
      }
      description="What customers see, when you are open, and the smallest order you will take."
      eyebrow="Your store"
      id="store-settings"
      level={2}
      title={displayName(settings.location_name)}
    >
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <form className="ns-stack" onSubmit={save}>
        <Card tone="sunken">
          <p className="eyebrow">How you appear</p>
          <Field
            label="Store name"
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          <label className="ns-field">
            <span className="ns-field__label">Description</span>
            <textarea
              className="ns-input settings-description"
              maxLength={280}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
            <span className="ns-field__hint">
              Shown on your store page. Say what you are known for.
            </span>
          </label>
        </Card>

        <Card tone="sunken">
          <p className="eyebrow">Ordering</p>
          <Field
            hint="How long you realistically need to pack an order. Customers are quoted this."
            inputMode="numeric"
            label="Preparation time (minutes)"
            onChange={(event) => setPrepMinutes(event.target.value)}
            value={prepMinutes}
          />
          <Field
            error={minimumError}
            hint={`Currently ${formatMoneyMinor(settings.minimum_order_minor)}. Orders below this cannot be placed.`}
            inputMode="decimal"
            label="Minimum order (₹)"
            onChange={(event) => setMinimum(event.target.value)}
            value={minimum}
          />
        </Card>

        <Card tone="sunken">
          <p className="eyebrow">Opening hours</p>
          <p className="field-help">
            Discovery and checkout both use these, so a day left closed takes you out of results for
            that day.
          </p>
          <ul className="hours-list">
            {WEEKDAYS.map(([weekday, label]) => {
              const day = hours[weekday] ?? { open: false, opens_at: '09:00', closes_at: '21:00' };
              return (
                <li className="hours-row" key={weekday}>
                  <label className="checkbox-row hours-row__day">
                    <input
                      checked={day.open}
                      onChange={(event) =>
                        setHours((current) => ({
                          ...current,
                          [weekday]: { ...day, open: event.target.checked },
                        }))
                      }
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                  {day.open ? (
                    <span className="hours-row__times">
                      <input
                        aria-label={`${label} opens at`}
                        className="ns-input"
                        onChange={(event) =>
                          setHours((current) => ({
                            ...current,
                            [weekday]: { ...day, opens_at: event.target.value },
                          }))
                        }
                        type="time"
                        value={day.opens_at}
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        aria-label={`${label} closes at`}
                        className="ns-input"
                        onChange={(event) =>
                          setHours((current) => ({
                            ...current,
                            [weekday]: { ...day, closes_at: event.target.value },
                          }))
                        }
                        type="time"
                        value={day.closes_at}
                      />
                    </span>
                  ) : (
                    <span className="hours-row__closed">Closed</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Button block busy={busy} size="large" type="submit">
          Save store settings
        </Button>
      </form>

      <Card tone="sunken">
        <p className="eyebrow">Availability</p>
        <p className="field-help">
          {paused
            ? 'Pausing stops new orders only. Anything you already accepted still has to be packed and handed over.'
            : 'Pause when you cannot take orders — a supply problem, a rush, an early close.'}
        </p>
        <Button
          busy={busy}
          onClick={() => void setLifecycle(paused ? 'ACTIVE' : 'PAUSED')}
          variant={paused ? 'primary' : 'secondary'}
        >
          {paused ? 'Reopen the store' : 'Pause new orders'}
        </Button>
      </Card>
    </Panel>
  );
}
