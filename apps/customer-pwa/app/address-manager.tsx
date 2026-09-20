'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Address } from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  LocationPicker,
  Notice,
  PageHeader,
} from '@neighbourhood-store/ui';
import { AddressSetup } from './address-setup';
import { useMapsConfig } from './maps-config';
import { customerApiClient } from './customer-session';
import { displayLabel } from './display';

export function AddressManager() {
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [editing, setEditing] = useState<Address | null>(null);
  const maps = useMapsConfig();
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const client = await customerApiClient();
      setAddresses((await client.addresses.list()).addresses);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Addresses could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function changeAddress(address: Address, action: 'select' | 'remove') {
    if (busy) return;
    if (action === 'remove' && !window.confirm(`Delete ${displayLabel(address.label)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const client = await customerApiClient();
      if (action === 'select') await client.addresses.select(address.customer_address_id);
      else await client.addresses.remove(address.customer_address_id);
      window.dispatchEvent(new Event('neighbourhood:customer-address'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Address could not be changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const client = await customerApiClient();
      await client.addresses.update(editing.customer_address_id, {
        coordinate_source: editing.coordinate_source,
        delivery_instructions: String(data.get('delivery_instructions') ?? '').trim() || null,
        expected_version: editing.version,
        label: String(data.get('label') ?? '').trim(),
        landmark: String(data.get('landmark') ?? '').trim() || null,
        latitude: editing.latitude,
        longitude: editing.longitude,
        pin_code: String(data.get('pin_code') ?? '').trim(),
      });
      setEditing(null);
      await load();
      window.dispatchEvent(new Event('neighbourhood:customer-address'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Address could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <LoadingState label="Loading saved addresses…" lines={3} />;
  if (error && addresses.length === 0)
    return <ErrorState onRetry={() => void load()} title={error} />;

  return (
    <div className="ns-stack">
      <PageHeader
        actions={
          <Button onClick={() => setAdding((value) => !value)}>
            {adding ? 'Close' : 'Add address'}
          </Button>
        }
        description="Choose exactly where nearby stores should deliver. Serviceability and fees are recalculated when you switch."
        eyebrow="Account"
        title="Delivery addresses"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {adding ? (
        <AddressSetup
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      ) : null}
      {editing ? (
        <Card tone="raised">
          <form className="ns-stack" onSubmit={saveEdit}>
            <h2>Edit {displayLabel(editing.label)}</h2>
            <Field
              defaultValue={displayLabel(editing.label)}
              label="Address name"
              name="label"
              required
            />
            <Field
              defaultValue={editing.pin_code}
              inputMode="numeric"
              label="PIN code"
              name="pin_code"
              pattern="[1-9][0-9]{5}"
              required
            />
            <LocationPicker
              accessToken={maps?.access_token ?? null}
              copy={{
                chosenLabel: 'Delivery point',
                deviceLabel: 'Use my current location',
                mapHint: 'Drag the pin if the door is somewhere else.',
              }}
              hint="Fees and arrival times follow this point."
              initialCentre={maps?.default_centre}
              label="Where should we deliver?"
              onChange={(next, how) =>
                setEditing({
                  ...editing,
                  latitude: next.latitude,
                  longitude: next.longitude,
                  coordinate_source: how === 'DEVICE' ? 'DEVICE_LOCATION' : 'MANUAL_PIN',
                })
              }
              value={{ latitude: editing.latitude, longitude: editing.longitude }}
            />
            <Field defaultValue={editing.landmark ?? ''} label="Landmark" name="landmark" />
            <Field
              defaultValue={editing.delivery_instructions ?? ''}
              label="Delivery instructions"
              name="delivery_instructions"
            />
            <div className="ns-row">
              <Button busy={busy} type="submit">
                Save changes
              </Button>
              <Button onClick={() => setEditing(null)} variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {addresses.length === 0 && !adding ? (
        <EmptyState glyph="⌖" title="No saved addresses" />
      ) : (
        addresses.map((address) => (
          <Card
            as="article"
            key={address.customer_address_id}
            tone={address.is_selected ? 'raised' : 'sunken'}
          >
            <div className="ns-row">
              <div>
                <strong>{displayLabel(address.label)}</strong>
                <p>
                  {address.pin_code}
                  {address.landmark ? ` · ${address.landmark}` : ''}
                </p>
                {address.delivery_instructions ? (
                  <small>{address.delivery_instructions}</small>
                ) : null}
              </div>
              {address.is_selected ? <strong>Delivering here</strong> : null}
            </div>
            <div className="ns-row">
              {!address.is_selected ? (
                <Button disabled={busy} onClick={() => void changeAddress(address, 'select')}>
                  Deliver here
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => setEditing(address)} variant="secondary">
                Edit
              </Button>
              <Button
                disabled={busy || address.is_selected}
                onClick={() => void changeAddress(address, 'remove')}
                variant="danger"
              >
                Delete
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
