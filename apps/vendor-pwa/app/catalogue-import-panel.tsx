'use client';

import { useState } from 'react';
import { vendorRequest } from './authenticated-api';

/**
 * Bulk catalogue import (VEN-16).
 *
 * A shop with two hundred lines cannot enter them one at a time, and the whole
 * import controller had no caller. Staging and committing are deliberately
 * separate: the vendor sees exactly what the file would create, including the
 * rows that failed, before anything reaches the live catalogue.
 */
type StagedImport = {
  readonly catalogue_import_id?: string;
  readonly accepted_rows?: number;
  readonly rejected_rows?: number;
  readonly status?: string;
  readonly errors?: readonly { readonly row?: number; readonly message?: string }[];
};

export function CatalogueImportPanel({ vendorLocationId }: { vendorLocationId: string }) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('catalogue.csv');
  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [message, setMessage] = useState('Load the template to see the expected columns.');

  async function loadTemplate() {
    try {
      const result = await vendorRequest<{ content: string; template_version: string }>(
        `vendor/locations/${vendorLocationId}/catalogue/imports/template`,
      );
      setCsv(result.content);
      setMessage(`Template ${result.template_version} loaded. Replace the example rows.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The template failed to load.');
    }
  }

  async function readFile(file: File) {
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setMessage(`${file.name} read. Stage it to see what it would create.`);
  }

  async function stage() {
    if (!csv.trim()) {
      setMessage('Load the template or a file first.');
      return;
    }
    try {
      const result = await vendorRequest<StagedImport>(
        `vendor/locations/${vendorLocationId}/catalogue/imports`,
        {
          method: 'POST',
          body: JSON.stringify({
            source_filename: filename,
            csv_content: csv,
            // The key makes a retry after a dropped connection safe rather than
            // creating the catalogue twice.
            idempotency_key: `IMPORT-${filename}-${csv.length}`,
          }),
        },
      );
      setStaged(result);
      setMessage(
        `Staged: ${result.accepted_rows ?? 0} rows accepted, ${result.rejected_rows ?? 0} rejected. Nothing is live yet.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The import could not be staged.');
    }
  }

  async function commit() {
    if (!staged?.catalogue_import_id) {
      setMessage('Stage an import first.');
      return;
    }
    try {
      const result = await vendorRequest<{ committed_rows?: number }>(
        `vendor/locations/${vendorLocationId}/catalogue/imports/${staged.catalogue_import_id}/commit`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setMessage(`${result.committed_rows ?? staged.accepted_rows ?? 0} products are now live.`);
      setStaged(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The import could not be committed.');
    }
  }

  return (
    <section className="orders-panel" aria-labelledby="import-heading">
      <header>
        <div>
          <p className="eyebrow">Catalogue</p>
          <h2 id="import-heading">Bulk import</h2>
        </div>
        <strong>{staged?.accepted_rows ?? 0}</strong>
      </header>
      <p aria-live="polite">{message}</p>

      <div className="order-actions">
        <button type="button" onClick={() => void loadTemplate()}>
          Load template
        </button>
        <label className="inline-field">
          Or choose a file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
        <button type="button" onClick={() => void stage()}>
          Stage import
        </button>
        <button type="button" disabled={!staged?.catalogue_import_id} onClick={() => void commit()}>
          Commit to catalogue
        </button>
      </div>

      <label className="inline-field">
        CSV
        <textarea
          rows={10}
          value={csv}
          spellCheck={false}
          onChange={(event) => setCsv(event.target.value)}
        />
      </label>

      {staged?.errors && staged.errors.length > 0 && (
        <>
          <h3>Rows that will not import</h3>
          <div className="order-grid">
            {staged.errors.map((issue, index) => (
              <div className="pick-row" key={index}>
                <span>
                  Row {issue.row ?? index + 1}: {issue.message ?? 'rejected'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
