'use client';

import { useState, type FormEvent } from 'react';
import { LocationPicker, type GeoPoint } from '@neighbourhood-store/ui';
import { vendorApiClient } from './authenticated-api';
import { useMapsConfig } from './maps-config';

type OnboardingStep = 'apply' | 'profile' | 'documents' | 'status';

type CaseState = {
  onboarding_case_id: string;
  version: number;
};

export function VendorOnboardingPanel() {
  const [step, setStep] = useState<OnboardingStep>('apply');
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [caseStatus, setCaseStatus] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Start a new vendor application or retrieve an existing one.',
  );

  // Profile form fields. These were hard-coded, so every store that onboarded
  // through this screen ended up at the same coordinates with the same minimum
  // order and preparation time — which then drove zone eligibility, fees and
  // delivery promises for a shop that was nowhere near there.
  const [businessName, setBusinessName] = useState('');
  const [locationName, setLocationName] = useState('');
  // The shop's exact spot, chosen on the map. This used to be read from the
  // device, or a hard-coded point in Jaipur when permission was refused --
  // a shop "at" a place nobody chose.
  const [storePoint, setStorePoint] = useState<GeoPoint | null>(null);
  const maps = useMapsConfig();
  const [businessReference, setBusinessReference] = useState('');
  const [payoutReference, setPayoutReference] = useState('');
  const [minimumOrderRupees, setMinimumOrderRupees] = useState('100');
  const [preparationMinutes, setPreparationMinutes] = useState('15');
  const [invitationRef, setInvitationRef] = useState('');
  const [document, setDocument] = useState<File | null>(null);
  const [documentKind, setDocumentKind] = useState<
    'BUSINESS_REGISTRATION' | 'FOOD_SAFETY_DECLARATION' | 'PAYOUT_ACCOUNT_PROOF'
  >('BUSINESS_REGISTRATION');

  async function createApplication() {
    setBusy(true);
    try {
      const client = await vendorApiClient();
      const result = await client.vendor.onboarding.createApplication();
      setCaseState({ onboarding_case_id: result.onboarding_case_id, version: 1 });
      setStep('profile');
      setMessage(`Application created: ${result.onboarding_case_id}. Fill in your store profile.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Application creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function claimInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const client = await vendorApiClient();
      const result = await client.vendor.onboarding.claimInvitation({
        invitation_reference: invitationRef,
        expected_version: 1,
      });
      setMessage(`Invitation claimed. Version: ${result.version}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Claim failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseState) return;
    setBusy(true);
    try {
      const client = await vendorApiClient();
      if (!storePoint) throw new Error('Place your shop on the map first.');
      const located = storePoint;
      const result = await client.vendor.onboarding.submitProfile(caseState.onboarding_case_id, {
        expected_version: caseState.version,
        business_name: businessName,
        business_profile_reference:
          businessReference.trim() || `BUSINESS-${Date.now().toString(36).toUpperCase()}`,
        // The only category the schema currently allows. When more are added
        // this becomes a choice rather than a constant.
        category: 'FRUIT_VEGETABLE',
        latitude: located.latitude,
        longitude: located.longitude,
        location_name: locationName,
        minimum_order_minor: Math.max(0, Math.round(Number(minimumOrderRupees) * 100) || 0),
        operating_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
        payout_profile_reference:
          payoutReference.trim() || `PAYOUT-${Date.now().toString(36).toUpperCase()}`,
        preparation_seconds: Math.max(60, (Number(preparationMinutes) || 15) * 60),
        profile_description: `${businessName} at ${locationName}`,
      });
      setCaseState((prev) => (prev ? { ...prev, version: result.version } : null));
      setStep('documents');
      setMessage('Profile submitted. Upload required verification documents.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Profile submission failed.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument() {
    if (!caseState || !document) {
      setMessage('Choose a PDF, JPEG or PNG document first.');
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(document.type)) {
      setMessage('Choose a PDF, JPEG or PNG document.');
      return;
    }
    if (document.size < 1 || document.size > 5 * 1024 * 1024) {
      setMessage('The document must be smaller than 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await document.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const client = await vendorApiClient();
      const result = await client.vendor.onboarding.uploadDocument(caseState.onboarding_case_id, {
        expected_version: caseState.version,
        document_kind: documentKind,
        affected_capability: 'vendor.catalogue.manage',
        content_base64: btoa(binary),
        media_type: document.type,
      });
      setCaseState((prev) =>
        prev
          ? { ...prev, version: (result as { version?: number }).version ?? prev.version }
          : null,
      );
      setStep('status');
      setMessage('Document uploaded. Check status for admin review progress.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!caseState) return;
    setBusy(true);
    try {
      const client = await vendorApiClient();
      const status = await client.vendor.onboarding.get(caseState.onboarding_case_id);
      setCaseStatus(status as Record<string, unknown>);
      setMessage('Case status loaded from server.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Status check failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="local-access">
      {step === 'apply' && (
        <div>
          <p className="field-label">Start a new application</p>
          <button type="button" onClick={() => void createApplication()} disabled={busy}>
            {busy ? 'Creating…' : 'Create vendor application'}
          </button>
          <p className="field-label" style={{ marginTop: '1rem' }}>
            Or claim an invitation
          </p>
          <form onSubmit={claimInvitation}>
            <input
              value={invitationRef}
              onChange={(e) => setInvitationRef(e.target.value)}
              placeholder="Invitation reference"
              required
            />
            <button type="submit" disabled={busy}>
              Claim invitation
            </button>
          </form>
        </div>
      )}

      {step === 'profile' && caseState && (
        <form onSubmit={submitProfile}>
          <p className="field-label">Business profile</p>
          <label>
            Business name
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
          </label>
          <label>
            Location name
            <input
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              required
            />
          </label>
          <LocationPicker
            accessToken={maps?.access_token ?? null}
            copy={{
              searchLabel: 'Search for your shop or its street',
              searchPlaceholder: 'Shop name, street or landmark',
              deviceLabel: 'I am at the shop now',
              chosenLabel: 'Shop location',
              mapHint: 'Tap the map or drag the pin to the shop door.',
            }}
            hint="Customers, delivery fees and riders all work from this exact point."
            initialCentre={maps?.default_centre}
            label="Where is the shop?"
            onChange={(next) => setStorePoint(next)}
            value={storePoint}
          />
          <label>
            Business registration reference
            <input
              value={businessReference}
              onChange={(e) => setBusinessReference(e.target.value)}
              placeholder="Leave blank to generate one"
            />
          </label>
          <label>
            Payout account reference
            <input
              value={payoutReference}
              onChange={(e) => setPayoutReference(e.target.value)}
              placeholder="Leave blank to generate one"
            />
          </label>
          <label>
            Minimum order (₹)
            <input
              type="number"
              min={0}
              value={minimumOrderRupees}
              onChange={(e) => setMinimumOrderRupees(e.target.value)}
            />
          </label>
          <label>
            Typical preparation time (minutes)
            <input
              type="number"
              min={1}
              max={240}
              value={preparationMinutes}
              onChange={(e) => setPreparationMinutes(e.target.value)}
            />
          </label>
          <p className="field-help">
            Your store&apos;s location is read from this device when you allow it, so customers see
            the right delivery area and fees.
          </p>
          <button type="submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit profile'}
          </button>
        </form>
      )}

      {step === 'documents' && caseState && (
        <div>
          <p className="field-label">Upload verification documents</p>
          <p className="field-help">
            Upload a PDF, JPEG or PNG up to 5 MB. Each kind is reviewed separately.
          </p>
          <label>
            Document kind
            <select
              value={documentKind}
              onChange={(event) =>
                setDocumentKind(
                  event.target.value as
                    'BUSINESS_REGISTRATION' | 'FOOD_SAFETY_DECLARATION' | 'PAYOUT_ACCOUNT_PROOF',
                )
              }
            >
              <option value="BUSINESS_REGISTRATION">Business registration</option>
              <option value="FOOD_SAFETY_DECLARATION">Food safety declaration</option>
              <option value="PAYOUT_ACCOUNT_PROOF">Payout account proof</option>
            </select>
          </label>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(event) => setDocument(event.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={() => void uploadDocument()} disabled={busy || !document}>
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      )}

      {step === 'status' && caseState && (
        <div>
          <p className="field-label">Application status</p>
          <p className="field-help">Case ID: {caseState.onboarding_case_id}</p>
          <button type="button" onClick={() => void checkStatus()} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh status'}
          </button>
          {caseStatus && (
            <pre style={{ marginTop: '1rem', fontSize: '11px', overflowX: 'auto' }}>
              {JSON.stringify(caseStatus, null, 2)}
            </pre>
          )}
        </div>
      )}

      <span aria-live="polite" style={{ display: 'block', marginTop: '1rem' }}>
        {message}
      </span>
    </div>
  );
}
