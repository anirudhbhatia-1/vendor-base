'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@neighbourhood-store/contracts';
import { LocationPicker, type GeoPoint } from '@neighbourhood-store/ui';
import { adminApiClient } from './authenticated-api';
import { useMapsConfig } from './maps-config';

type VendorResult = {
  user_id: string;
  vendor_id: string;
  vendor_location_id: string;
  role_assignment_id: string;
  password_set: boolean;
  temporary_password: string;
};

type PartnerResult = {
  user_id: string;
  role_assignment_id: string;
  password_set: boolean;
  temporary_password: string;
};

/**
 * The shop categories the server takes: a free-text box let an operator type
 * one it refuses ("all mart"), and the refusal read only as an invalid request.
 */
/**
 * The longest name the server takes (120) less the "SYNTH " the console puts
 * in front. A pasted street address ran past it and was refused.
 */
export const NAME_MAX_LENGTH = 114;

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Temporary password',
  business_name: 'Business name',
  location_name: 'Store name',
  latitude: 'Store location',
  longitude: 'Store location',
  category: 'Category',
  phone_identifier: 'Phone number',
};

/**
 * What a refused onboarding request was about, field by field. The server
 * names the field and a code; the console words it. Until the onboarding
 * repair every refusal read "Something in that request was not valid".
 */
export function onboardingErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.fieldErrors.length > 0) {
    return error.fieldErrors
      .map((entry) => {
        const label = FIELD_LABELS[entry.field] ?? entry.field;
        if (entry.code === 'PASSWORD_REJECTED')
          return `${label}: choose a stronger one, at least 8 characters mixing upper and lower case letters, a number and a symbol, and not a common password.`;
        if (entry.code === 'EMAIL_REJECTED')
          return `${label}: that address was not accepted. Check it, or use another.`;
        if (entry.field === 'business_name' || entry.field === 'location_name')
          return `${label}: use 2 to ${NAME_MAX_LENGTH} characters. A short name is enough; the map gives the address.`;
        return `${label}: this was not accepted.`;
      })
      .join(' ');
  }
  return error instanceof Error ? error.message : fallback;
}

export const VENDOR_CATEGORY_OPTIONS = [
  { value: 'FRUIT_VEGETABLE', label: 'Fruit and vegetables' },
] as const;

export function OnboardingPanel() {
  const vendorCommand = useRef<{ digest: string; key: string } | null>(null);
  const partnerCommand = useRef<{ digest: string; key: string } | null>(null);
  // Vendor form state
  const [vEmail, setVEmail] = useState('');
  const [vBusiness, setVBusiness] = useState('');
  const [vLocation, setVLocation] = useState('');
  // The store's exact spot, placed on the map rather than typed as two numbers
  // that defaulted to one point in Jaipur for every shop (D-17).
  const [vPoint, setVPoint] = useState<GeoPoint | null>(null);
  const maps = useMapsConfig();
  const [vCategory, setVCategory] = useState('FRUIT_VEGETABLE');
  const [vPassword, setVPassword] = useState('');
  const [vBusy, setVBusy] = useState(false);
  const [vResult, setVResult] = useState<VendorResult | null>(null);
  const [vError, setVError] = useState<string | null>(null);

  // Partner form state
  const [pEmail, setPEmail] = useState('');
  const [pName, setPName] = useState('');
  const [pPassword, setPPassword] = useState('');
  const [pBusy, setPBusy] = useState(false);
  const [pResult, setPResult] = useState<PartnerResult | null>(null);
  const [pError, setPError] = useState<string | null>(null);

  async function createVendor(event: FormEvent) {
    event.preventDefault();
    setVBusy(true);
    setVError(null);
    setVResult(null);
    try {
      const client = await adminApiClient();
      if (!vPoint) throw new Error('Place the store on the map first.');
      const body = {
        email: vEmail.trim(),
        business_name: `SYNTH ${vBusiness.trim().replace(/^SYNTH\s+/i, '')}`,
        location_name: `SYNTH ${vLocation.trim().replace(/^SYNTH\s+/i, '')}`,
        latitude: vPoint.latitude,
        longitude: vPoint.longitude,
        category: vCategory,
        password: vPassword,
      };
      const digest = JSON.stringify(body);
      if (vendorCommand.current?.digest !== digest) {
        vendorCommand.current = { digest, key: crypto.randomUUID() };
      }
      const result = await client.admin.onboarding.createVendor(body, vendorCommand.current.key);
      setVResult({ ...result, temporary_password: vPassword });
      vendorCommand.current = null;
      setVPassword('');
    } catch (error) {
      setVError(onboardingErrorText(error, 'Vendor creation failed'));
    } finally {
      setVBusy(false);
    }
  }

  async function createPartner(event: FormEvent) {
    event.preventDefault();
    setPBusy(true);
    setPError(null);
    setPResult(null);
    try {
      const client = await adminApiClient();
      const body = {
        email: pEmail.trim(),
        display_name: pName.trim(),
        password: pPassword,
      };
      const digest = JSON.stringify(body);
      if (partnerCommand.current?.digest !== digest) {
        partnerCommand.current = { digest, key: crypto.randomUUID() };
      }
      const result = await client.admin.onboarding.createPartner(body, partnerCommand.current.key);
      setPResult({ ...result, temporary_password: pPassword });
      partnerCommand.current = null;
      setPPassword('');
    } catch (error) {
      setPError(onboardingErrorText(error, 'Partner creation failed'));
    } finally {
      setPBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard may be unavailable in some browsers or contexts; ignore silently
      // — the value is already visible on screen for manual copy.
    }
  }

  return (
    <div className="onboarding-panel">
      <form className="onboarding-form" onSubmit={createVendor}>
        <h2>Create Vendor</h2>
        <p>
          Provisions a user, a vendor + location, a service zone, fulfilment modes, and grants
          VENDOR_OWNER. The store is auto-published so it appears in customer discovery immediately.
        </p>
        <label>
          Sign-in email
          <input
            type="email"
            value={vEmail}
            onChange={(e) => setVEmail(e.target.value)}
            placeholder="vendor@example.com"
            required
          />
        </label>
        <label>
          Business name
          <input
            value={vBusiness}
            onChange={(e) => setVBusiness(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            required
          />
        </label>
        <label>
          Store name
          <input
            value={vLocation}
            onChange={(e) => setVLocation(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            placeholder="e.g. Anirudh General, Mansarovar"
            required
          />
          <small>
            The short name customers see, up to {NAME_MAX_LENGTH} characters. The address comes from
            the map pin below.
          </small>
        </label>
        <LocationPicker
          accessToken={maps?.access_token ?? null}
          copy={{
            searchLabel: 'Search for the store or its street',
            searchPlaceholder: 'Shop name, street or landmark',
            chosenLabel: 'Store location',
            mapHint: 'Tap the map or drag the pin to the shop door.',
          }}
          hint="Discovery, delivery fees and rider offers all work from this exact point."
          initialCentre={maps?.default_centre}
          label="Where is the store?"
          onChange={(next) => setVPoint(next)}
          value={vPoint}
        />
        <label>
          Category
          <select value={vCategory} onChange={(e) => setVCategory(e.target.value)}>
            {VENDOR_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>Only fruit and vegetable shops can join for now.</small>
        </label>
        <label>
          Temporary password
          <input
            type="password"
            value={vPassword}
            onChange={(e) => setVPassword(e.target.value)}
            placeholder="8+ characters"
            minLength={8}
            required
          />
        </label>
        <button disabled={vBusy}>{vBusy ? 'Creating…' : 'Create vendor'}</button>
        {vError && (
          <p role="alert" className="onboarding-error">
            {vError}
          </p>
        )}
        {vResult && (
          <div className="onboarding-result">
            <strong>Vendor provisioned</strong>
            <p>Share these details with the vendor. Password will not be shown again.</p>
            <dl>
              <dt>Email</dt>
              <dd>
                {vEmail}{' '}
                <button type="button" onClick={() => void copy(vEmail)}>
                  Copy
                </button>
              </dd>
              {vResult.password_set && (
                <>
                  <dt>Password</dt>
                  <dd>
                    {vResult.temporary_password}{' '}
                    <button type="button" onClick={() => void copy(vResult.temporary_password)}>
                      Copy
                    </button>
                  </dd>
                </>
              )}
              <dt>Vendor location id</dt>
              <dd>
                <code>{vResult.vendor_location_id}</code>{' '}
                <button type="button" onClick={() => void copy(vResult.vendor_location_id)}>
                  Copy
                </button>
              </dd>
              <dt>User id</dt>
              <dd>
                <code>{vResult.user_id}</code>
              </dd>
            </dl>
          </div>
        )}
      </form>

      <form className="onboarding-form" onSubmit={createPartner}>
        <h2>Create Delivery Partner</h2>
        <p>
          Provisions a user with DELIVERY_PARTNER + ELIGIBLE eligibility. The partner can
          immediately go online and receive offers.
        </p>
        <label>
          Sign-in email
          <input
            type="email"
            value={pEmail}
            onChange={(e) => setPEmail(e.target.value)}
            placeholder="partner@example.com"
            required
          />
        </label>
        <label>
          Display name
          <input value={pName} onChange={(e) => setPName(e.target.value)} required />
        </label>
        <label>
          Temporary password
          <input
            type="password"
            value={pPassword}
            onChange={(e) => setPPassword(e.target.value)}
            placeholder="8+ characters"
            minLength={8}
            required
          />
        </label>
        <button disabled={pBusy}>{pBusy ? 'Creating…' : 'Create partner'}</button>
        {pError && (
          <p role="alert" className="onboarding-error">
            {pError}
          </p>
        )}
        {pResult && (
          <div className="onboarding-result">
            <strong>Partner provisioned</strong>
            <p>Share these details with the partner. Password will not be shown again.</p>
            <dl>
              <dt>Email</dt>
              <dd>
                {pEmail}{' '}
                <button type="button" onClick={() => void copy(pEmail)}>
                  Copy
                </button>
              </dd>
              {pResult.password_set && (
                <>
                  <dt>Password</dt>
                  <dd>
                    {pResult.temporary_password}{' '}
                    <button type="button" onClick={() => void copy(pResult.temporary_password)}>
                      Copy
                    </button>
                  </dd>
                </>
              )}
              <dt>User id</dt>
              <dd>
                <code>{pResult.user_id}</code>
              </dd>
            </dl>
          </div>
        )}
      </form>
    </div>
  );
}
