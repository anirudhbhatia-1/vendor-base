'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Field,
  LocationPicker,
  Notice,
  Panel,
  type GeoPoint,
  type LocationSource,
} from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { useLocale } from './locale';
import { useMapsConfig } from './maps-config';

/**
 * First-run address capture.
 *
 * Nothing can be shown before this: stores, fees, promises and eligibility are
 * all computed for a selected address (MKT-03, CUS-13).
 */
export function AddressSetup({ onSaved }: { readonly onSaved: () => void }) {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [source, setSource] = useState<LocationSource>('MAP');
  // The PIN the map read off the place the pin landed on. Filled in for the
  // person, who used to read it from the map's own caption and type it back;
  // once they have typed one themselves it is theirs.
  const [pinCode, setPinCode] = useState('');
  const [pinTyped, setPinTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  const maps = useMapsConfig();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const client = await customerApiClient();
      if (!point) throw new Error('Choose your delivery location on the map first.');
      // The address record distinguishes a device fix from a pin a person placed;
      // a searched place and a typed coordinate are both placed by a person.
      const located = {
        latitude: point.latitude,
        longitude: point.longitude,
        coordinate_source:
          source === 'DEVICE' ? ('DEVICE_LOCATION' as const) : ('MANUAL_PIN' as const),
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
        <LocationPicker
          accessToken={maps?.access_token ?? null}
          copy={{
            searchLabel: t(
              'customer.address.map.search',
              'Search for your street, building or landmark',
            ),
            searchPlaceholder: t('customer.address.map.placeholder', 'e.g. Vaishali Nagar, Jaipur'),
            deviceLabel: t('customer.address.map.device', 'Use my current location'),
            mapHint: t('customer.address.map.hint', 'Tap the map or drag the pin to your door.'),
            chosenLabel: t('customer.address.map.chosen', 'Delivery point'),
            manualSummary: t('customer.address.map.manual', 'Enter coordinates by hand'),
            unavailable: t(
              'customer.address.map.unavailable',
              'Maps are not available here. Enter the coordinates by hand.',
            ),
          }}
          hint={t(
            'customer.address.map.description',
            'Delivery fees and arrival times are worked out from this exact point.',
          )}
          initialCentre={maps?.default_centre}
          label={t('customer.address.map.label', 'Where should we deliver?')}
          onPlace={(place) => {
            if (!pinTyped && place?.postcode && /^[1-9][0-9]{5}$/.test(place.postcode))
              setPinCode(place.postcode);
          }}
          onChange={(next, how) => {
            setPoint(next);
            setSource(how);
            setError(null);
          }}
          value={point}
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
          onChange={(event) => {
            setPinTyped(true);
            setPinCode(event.target.value);
          }}
          pattern="[1-9][0-9]{5}"
          required
          value={pinCode}
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
