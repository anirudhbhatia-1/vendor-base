'use client';

import { useRef, useState, type FormEvent } from 'react';
import { adminApiClient } from './authenticated-api';

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

export function OnboardingPanel() {
  const vendorCommand = useRef<{ digest: string; key: string } | null>(null);
  const partnerCommand = useRef<{ digest: string; key: string } | null>(null);
  // Vendor form state
  const [vEmail, setVEmail] = useState('');
  const [vBusiness, setVBusiness] = useState('');
  const [vLocation, setVLocation] = useState('');
  const [vLat, setVLat] = useState('26.8505');
  const [vLng, setVLng] = useState('75.7628');
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
      const body = {
        email: vEmail.trim(),
        business_name: `SYNTH ${vBusiness.trim().replace(/^SYNTH\s+/i, '')}`,
        location_name: `SYNTH ${vLocation.trim().replace(/^SYNTH\s+/i, '')}`,
        latitude: Number(vLat),
        longitude: Number(vLng),
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
      setVError(error instanceof Error ? error.message : 'Vendor creation failed');
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
      setPError(error instanceof Error ? error.message : 'Partner creation failed');
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
          <input value={vBusiness} onChange={(e) => setVBusiness(e.target.value)} required />
        </label>
        <label>
          Location name
          <input value={vLocation} onChange={(e) => setVLocation(e.target.value)} required />
        </label>
        <div className="onboarding-coords">
          <label>
            Latitude
            <input value={vLat} onChange={(e) => setVLat(e.target.value)} required />
          </label>
          <label>
            Longitude
            <input value={vLng} onChange={(e) => setVLng(e.target.value)} required />
          </label>
        </div>
        <label>
          Category
          <input value={vCategory} onChange={(e) => setVCategory(e.target.value)} />
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
