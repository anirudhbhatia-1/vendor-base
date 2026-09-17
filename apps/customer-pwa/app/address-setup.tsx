'use client';

import { useState, type FormEvent } from 'react';
import { Button, Field, Notice, Panel } from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { useLocale } from './locale';

/**
 * Reads the device location when the customer allows it (CUS-08).
 *
 * Permission is optional. A declined request requires an explicit manual pin;
 * never substitute a guessed neighbourhood centroid for the delivery point.
 */
export async function deviceCoordinates(): Promise<{
  latitude: number;
  longitude: number;
  coordinate_source: 'DEVICE_LOCATION' | 'MANUAL_PIN';
}> {
  if (typeof navigator === 'undefined' || !navigator.geolocation)
    throw new Error('Location is unavailable. Enter your delivery coordinates manually.');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          coordinate_source: 'DEVICE_LOCATION',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () =>
        reject(
          new Error('Location permission was declined. Enter your delivery coordinates manually.'),
        ),
      { maximumAge: 60_000, timeout: 5_000 },
    );
  });
}

/**
 * First-run address capture.
 *
 * Nothing can be shown before this: stores, fees, promises and eligibility are
 * all computed for a selected address (MKT-03, CUS-13).
 */
export function AddressSetup({ onSaved }: { readonly onSaved: () => void }) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const client = await customerApiClient();
      if (!latitude.trim() || !longitude.trim())
        throw new Error('Choose your delivery location first.');
      const located = {
        latitude: Number(latitude),
        longitude: Number(longitude),
        coordinate_source: 'MANUAL_PIN' as const,
      };
      const created = await client.addresses.create({
        address_reference: `ADDRESS-${crypto.randomUUID().toUpperCase()}`,
        label: String(data.get('label') ?? 'Home').trim(),
        pin_code: String(data.get('pin_code') ?? ''),
        latitude: located.latitude,
        longitude: located.longitude,
        coordinate_source: located.coordinate_source,
        landmark: String(data.get('landmark') ?? '').trim() || null,
        delivery_instructions: String(data.get('delivery_instructions') ?? '').trim() || null,
      });
      await client.addresses.select(created.customer_address_id);
      window.dispatchEvent(new Event('neighbourhood:customer-address'));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That address could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      description={t(
        'customer.address.setup.description',
        'Stores, delivery fees and arrival windows are all worked out for this address.',
      )}
      eyebrow={t('customer.address.setup.eyebrow', 'Where are we delivering?')}
      id="address-setup"
      level={2}
      title={t('customer.address.setup.title', 'Add a delivery address')}
    >
      <form className="ns-stack" onSubmit={save}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void deviceCoordinates()
              .then((point) => {
                setLatitude(String(point.latitude));
                setLongitude(String(point.longitude));
                setError(null);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Location unavailable.'),
              );
          }}
        >
          Use current location
        </Button>
        <Field
          label="Delivery latitude"
          name="latitude"
          type="number"
          step="any"
          min={-90}
          max={90}
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
          required
        />
        <Field
          label="Delivery longitude"
          name="longitude"
          type="number"
          step="any"
          min={-180}
          max={180}
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
          required
        />
        <Field
          defaultValue="Home"
          hint={t(
            'customer.address.label.hint',
            'Home, work, a relative — whatever you will recognise.',
          )}
          label={t('customer.address.label', 'Name this address')}
          name="label"
          required
        />
        <Field
          hint={t(
            'customer.address.pin.hint',
            'Six digits. This decides which shops can reach you.',
          )}
          inputMode="numeric"
          label={t('customer.address.pin', 'PIN code')}
          name="pin_code"
          pattern="[1-9][0-9]{5}"
          required
        />
        <Field
          label={t('customer.address.landmark', 'Landmark (optional)')}
          maxLength={160}
          name="landmark"
        />
        <Field
          hint={t(
            'customer.address.instructions.hint',
            'Only shown to the person delivering, and only once they are on the way.',
          )}
          label={t('customer.address.instructions', 'Delivery instructions (optional)')}
          maxLength={240}
          name="delivery_instructions"
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button block busy={busy} size="large" type="submit">
          {t('customer.address.save', 'Save and find stores')}
        </Button>
      </form>
    </Panel>
  );
}
