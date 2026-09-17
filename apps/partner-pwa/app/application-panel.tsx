'use client';

import { useState, type FormEvent } from 'react';
import { partnerApiClient } from './authenticated-api';

type AppState = {
  partner_application_id: string;
  version: number;
};

export function PartnerApplicationPanel() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [appStatus, setAppStatus] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Fill in your vehicle and document references, then submit your application.',
  );
  const [homeZone, setHomeZone] = useState('Mansarovar');
  const [vehicleKind, setVehicleKind] = useState('CYCLE');
  // These were fabricated from a timestamp, so an application recorded
  // "documents provided" for documents nobody had seen. The applicant supplies
  // them; the reviewer decides whether they are good enough.
  const [identityReference, setIdentityReference] = useState('');
  const [vehicleReference, setVehicleReference] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [insuranceReference, setInsuranceReference] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [trainingReference, setTrainingReference] = useState('');

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const client = await partnerApiClient();
      const result = await client.partner.applications.create({
        identity_reference: identityReference.trim(),
        vehicle_reference: vehicleReference.trim(),
        vehicle_kind: vehicleKind,
        bank_account_reference: bankReference.trim(),
        insurance_reference: insuranceReference.trim(),
        emergency_contact_reference: emergencyContact.trim(),
        training_reference: trainingReference.trim(),
        home_zone_name: homeZone,
      });
      setAppState({ partner_application_id: result.partner_application_id, version: 1 });
      setMessage(`Application created: ${result.partner_application_id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Application creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    if (!appState) return;
    setBusy(true);
    try {
      const client = await partnerApiClient();
      await client.partner.applications.submit(appState.partner_application_id, {
        expected_version: appState.version,
      });
      setAppState((prev) => (prev ? { ...prev, version: prev.version + 1 } : null));
      setMessage('Application submitted for admin review.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!appState) return;
    setBusy(true);
    try {
      const client = await partnerApiClient();
      const status = await client.partner.applications.get(appState.partner_application_id);
      setAppStatus(status as Record<string, unknown>);
      setMessage('Application status loaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Status check failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="local-access">
      {!appState && (
        <form onSubmit={createApplication}>
          <label>
            Home zone
            <input
              value={homeZone}
              onChange={(e) => setHomeZone(e.target.value)}
              placeholder="Mansarovar"
              required
            />
          </label>
          <label>
            Identity document reference
            <input
              value={identityReference}
              onChange={(e) => setIdentityReference(e.target.value)}
              placeholder="Number on the ID you will present"
              required
            />
          </label>
          <label>
            Vehicle registration reference
            <input
              value={vehicleReference}
              onChange={(e) => setVehicleReference(e.target.value)}
              required
            />
          </label>
          <label>
            Bank account reference
            <input
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              placeholder="Where your earnings are paid"
              required
            />
          </label>
          <label>
            Insurance reference
            <input
              value={insuranceReference}
              onChange={(e) => setInsuranceReference(e.target.value)}
              required
            />
          </label>
          <label>
            Emergency contact reference
            <input
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="Who we contact if something happens to you"
              required
            />
          </label>
          <label>
            Training completion reference
            <input
              value={trainingReference}
              onChange={(e) => setTrainingReference(e.target.value)}
              required
            />
          </label>
          <label>
            Vehicle kind
            <select value={vehicleKind} onChange={(e) => setVehicleKind(e.target.value)}>
              <option value="CYCLE">Cycle</option>
              <option value="MOTORCYCLE">Motorcycle</option>
              <option value="ELECTRIC_CYCLE">Electric cycle</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create application'}
          </button>
        </form>
      )}

      {appState && (
        <div>
          <p className="field-help">Application ID: {appState.partner_application_id}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button type="button" onClick={() => void submitApplication()} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for review'}
            </button>
            <button type="button" onClick={() => void checkStatus()} disabled={busy}>
              {busy ? 'Loading…' : 'Check status'}
            </button>
          </div>
          {appStatus && (
            <pre style={{ marginTop: '1rem', fontSize: '11px', overflowX: 'auto' }}>
              {JSON.stringify(appStatus, null, 2)}
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
