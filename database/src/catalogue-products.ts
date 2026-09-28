import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import type { ProtectedObjectStorage } from './protected-object-storage.js';
import { transaction as tx } from './transaction.js';

export const CATALOGUE_CSV_TEMPLATE =
  'product_reference,title,category,unit_label,tax_basis,sku,variant_title,price_minor,quantity_basis,exact_available_quantity,low_stock_threshold,variable_weight,permitted_weight_variance_bps\n';
type RowState = 'COMMITTED' | 'INVALID' | 'VALID';
type Parsed = Record<string, string>;
export interface CatalogueImportRow {
  readonly row_number: number;
  readonly row_state: RowState;
  readonly validation_errors: readonly string[];
  readonly product_reference: string | null;
}
export interface CatalogueImport {
  readonly catalogue_import_id: UuidV7;
  readonly import_state: 'COMMITTED' | 'REJECTED' | 'STAGED';
  readonly total_rows: number;
  readonly valid_rows: number;
  readonly invalid_rows: number;
  readonly committed_rows: number;
  readonly rows: readonly CatalogueImportRow[];
}
export class CatalogueImportInputError extends Error {}
export class CatalogueImportNotFoundError extends Error {}
export class CatalogueImportConflictError extends Error {}
export class CatalogueImportAuthorizationError extends Error {}
export class CatalogueProductNotFoundError extends Error {}

interface ImportRecord {
  readonly catalogue_import_id: string;
  readonly import_state: CatalogueImport['import_state'];
  readonly total_rows: number;
  readonly valid_rows: number;
  readonly invalid_rows: number;
  readonly committed_rows: number;
}
interface ImportRowRecord {
  readonly row_number: number;
  readonly row_state: RowState;
  readonly validation_errors: readonly string[];
  readonly product_reference: string | null;
}
interface ImportRowFullRecord extends ImportRowRecord {
  readonly catalogue_import_row_id: string;
  readonly raw_row: unknown;
}
interface ProductSummaryRecord {
  readonly catalogue_product_id: string;
  readonly product_reference: string;
  readonly title: string;
  readonly category: string;
  readonly unit_label: string;
  readonly tax_basis: string;
  readonly variable_weight: boolean;
  readonly permitted_weight_variance_bps: number | null;
  readonly lifecycle_state: string;
  readonly version: number;
  readonly variants: readonly Record<string, unknown>[];
  readonly images: readonly Record<string, unknown>[];
}
interface ProductStateRecord {
  readonly catalogue_product_id: string;
  readonly version: number;
  readonly lifecycle_state: string;
}
interface VariantIdRecord {
  readonly catalogue_variant_id: string;
}
interface SubstitutionIdRecord {
  readonly catalogue_substitution_id: string;
}
interface SubstitutionStateRecord {
  readonly catalogue_substitution_id: string;
  readonly lifecycle_state: string;
}

// PostgreSQL reports a unique-constraint breach as SQLSTATE 23505. Narrow the
// unknown catch binding instead of widening it to `any`.
// Variable-weight products must carry a bounded variance; packaged products must
// carry none. Keeping this a guard avoids asserting past the optional field.
function isVarianceInRange(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000;
}
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === '23505'
  );
}
const header = [
  'product_reference',
  'title',
  'category',
  'unit_label',
  'tax_basis',
  'sku',
  'variant_title',
  'price_minor',
  'quantity_basis',
  'exact_available_quantity',
  'low_stock_threshold',
  'variable_weight',
  'permitted_weight_variance_bps',
] as const;
const productRef = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const sku = /^[A-Z0-9][A-Z0-9._:/-]{2,95}$/;
const title = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'().,/%+-]{1,118}$/u;
const key = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
function actor(context: RequestContext): UuidV7 {
  if (!context.actor || !['vendor_staff', 'admin'].includes(context.actor.actor_kind))
    throw new CatalogueImportAuthorizationError();
  return context.actor.actor_id;
}
function csv(input: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new CatalogueImportInputError('CSV contains an unclosed quoted value');
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}
function parse(content: string): readonly { row: Parsed; errors: readonly string[] }[] {
  const rows = csv(content);
  const headerRow = rows[0];
  if (rows.length < 2 || !headerRow || headerRow.join(',') !== header.join(','))
    throw new CatalogueImportInputError('CSV header must match CATALOGUE_CSV_V1');
  if (rows.length > 10001) throw new CatalogueImportInputError('CSV has too many rows');
  return rows.slice(1).map((values) => {
    const row = Object.fromEntries(
      header.map((name, index) => [name, (values[index] ?? '').trim()]),
    ) as Parsed;
    const value = (name: string) => row[name] ?? '';
    const errors: string[] = [];
    if (values.length !== header.length) errors.push('COLUMN_COUNT');
    if (!productRef.test(value('product_reference'))) errors.push('PRODUCT_REFERENCE');
    if (!title.test(value('title')) || !title.test(value('variant_title'))) errors.push('TITLE');
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(value('category'))) errors.push('CATEGORY');
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(value('unit_label'))) errors.push('UNIT_LABEL');
    if (!['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT'].includes(value('tax_basis')))
      errors.push('TAX_BASIS');
    if (!sku.test(value('sku'))) errors.push('SKU');
    const price = Number(value('price_minor'));
    if (!Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000)
      errors.push('PRICE_MINOR');
    if (!['COUNTED', 'VENDOR_CONFIRMS'].includes(value('quantity_basis')))
      errors.push('QUANTITY_BASIS');
    const variable =
      value('variable_weight') === 'true' || value('variable_weight') === 'false'
        ? value('variable_weight') === 'true'
        : null;
    if (variable === null) errors.push('VARIABLE_WEIGHT');
    if (variable) {
      const variance = Number(value('permitted_weight_variance_bps'));
      if (!Number.isSafeInteger(variance) || variance < 0 || variance > 10000)
        errors.push('WEIGHT_VARIANCE');
    } else if (value('permitted_weight_variance_bps') !== '') errors.push('WEIGHT_VARIANCE');
    if (value('quantity_basis') === 'COUNTED') {
      for (const field of ['exact_available_quantity', 'low_stock_threshold'] as const) {
        const count = Number(value(field));
        if (!Number.isSafeInteger(count) || count < 0 || count > 100_000_000)
          errors.push(field.toUpperCase());
      }
    } else if (value('exact_available_quantity') !== '' || value('low_stock_threshold') !== '')
      errors.push('VENDOR_CONFIRMS_QUANTITY');
    return { row, errors };
  });
}
function result(row: ImportRecord, rows: readonly CatalogueImportRow[]): CatalogueImport {
  return Object.freeze({
    catalogue_import_id: parseUuidV7(row.catalogue_import_id),
    import_state: row.import_state,
    total_rows: row.total_rows,
    valid_rows: row.valid_rows,
    invalid_rows: row.invalid_rows,
    committed_rows: row.committed_rows,
    rows: Object.freeze(rows),
  });
}
export class CatalogueProductService {
  readonly #pool: Pool;
  readonly #storage: ProtectedObjectStorage | undefined;
  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly storage?: ProtectedObjectStorage;
  }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-catalogue-products',
      max: 8,
    });
    this.#storage = input.storage;
  }
  async close() {
    await releaseServicePool(this.#pool);
  }

  async uploadImage(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_product_id: UuidV7;
    readonly content: Uint8Array;
    readonly media_type: 'image/png' | 'image/jpeg';
    readonly alt_text: string;
    readonly position: number;
    readonly now?: Date;
  }): Promise<{ catalogue_image_id: UuidV7; object_reference: string }> {
    if (!this.#storage) {
      throw new CatalogueImportInputError();
    }
    const now = input.now ?? new Date();
    const imageId = createUuidV7({ now_ms: now.getTime() });
    const objectKey = `catalogue-images/${input.vendor_location_id}/${imageId}/object`;
    const stored = await this.#storage.put({
      content: input.content,
      media_type: input.media_type,
      object_key: objectKey,
    });
    const result = await this.addImage({
      context: input.context,
      vendor_location_id: input.vendor_location_id,
      catalogue_product_id: input.catalogue_product_id,
      object_reference: objectKey,
      alt_text: input.alt_text,
      position: input.position,
      stored: {
        media_type: input.media_type,
        content_sha256: stored.content_sha256,
        content_length: stored.content_length,
      },
      now,
    });
    return { catalogue_image_id: result.catalogue_image_id, object_reference: objectKey };
  }
  async stageImport(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly source_filename: string;
    readonly csv_content: string;
    readonly idempotency_key: string;
    readonly now?: Date;
  }): Promise<CatalogueImport> {
    actor(input.context);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._ -]{1,120}\.csv$/i.test(input.source_filename) ||
      !key.test(input.idempotency_key)
    )
      throw new CatalogueImportInputError();
    const parsed = parse(input.csv_content);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      const existing = await client.query<ImportRecord>(
        'SELECT * FROM marketplace.catalogue_imports WHERE vendor_location_id=$1 AND idempotency_key=$2 FOR UPDATE',
        [input.vendor_location_id, input.idempotency_key],
      );
      const existingImport = existing.rows[0];
      if (existingImport) {
        const staged = await client.query<ImportRowRecord>(
          'SELECT row_number,row_state,validation_errors,product_reference FROM marketplace.catalogue_import_rows WHERE catalogue_import_id=$1 ORDER BY row_number',
          [existingImport.catalogue_import_id],
        );
        return result(
          existingImport,
          staged.rows.map((r) => ({
            row_number: r.row_number,
            row_state: r.row_state,
            validation_errors: r.validation_errors,
            product_reference: r.product_reference,
          })),
        );
      }
      const valid = parsed.filter((x) => x.errors.length === 0).length;
      const importId = createUuidV7({ now_ms: now.getTime() });
      const insert = await client.query<ImportRecord>(
        `INSERT INTO marketplace.catalogue_imports (catalogue_import_id,vendor_location_id,template_version,source_filename,content_sha256,idempotency_key,import_state,total_rows,valid_rows,invalid_rows,request_id,correlation_id,created_at) VALUES ($1,$2,'CATALOGUE_CSV_V1',$3,$4,$5,'STAGED',$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          importId,
          input.vendor_location_id,
          input.source_filename,
          createHash('sha256').update(input.csv_content).digest('hex'),
          input.idempotency_key,
          parsed.length,
          valid,
          parsed.length - valid,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      const rows: CatalogueImportRow[] = [];
      for (const [index, item] of parsed.entries()) {
        const state: RowState = item.errors.length ? 'INVALID' : 'VALID';
        await client.query(
          `INSERT INTO marketplace.catalogue_import_rows (catalogue_import_row_id,catalogue_import_id,row_number,row_state,raw_row,validation_errors,product_reference) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            createUuidV7({ now_ms: now.getTime() + index }),
            importId,
            index + 2,
            state,
            item.row,
            JSON.stringify(item.errors),
            item.row.product_reference || null,
          ],
        );
        rows.push({
          row_number: index + 2,
          row_state: state,
          validation_errors: item.errors,
          product_reference: item.row.product_reference || null,
        });
      }
      const created = insert.rows[0];
      if (!created) throw new CatalogueImportConflictError('Import was not staged');
      return result(created, rows);
    });
  }

  async commitImport(input: {
    readonly context: RequestContext;
    readonly catalogue_import_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<CatalogueImport> {
    const actorId = actor(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const imported = await client.query<ImportRecord>(
        `SELECT * FROM marketplace.catalogue_imports
          WHERE catalogue_import_id=$1 AND vendor_location_id=$2 FOR UPDATE`,
        [input.catalogue_import_id, input.vendor_location_id],
      );
      const importRow = imported.rows[0];
      if (!importRow) throw new CatalogueImportNotFoundError();
      const rows = await client.query<ImportRowFullRecord>(
        `SELECT * FROM marketplace.catalogue_import_rows
          WHERE catalogue_import_id=$1 ORDER BY row_number FOR UPDATE`,
        [input.catalogue_import_id],
      );
      if (importRow.import_state === 'COMMITTED') {
        return result(
          importRow,
          rows.rows.map((row) => ({
            row_number: row.row_number,
            row_state: row.row_state,
            validation_errors: row.validation_errors,
            product_reference: row.product_reference,
          })),
        );
      }
      if (importRow.invalid_rows > 0 || importRow.valid_rows === 0)
        throw new CatalogueImportConflictError(
          'Only an entirely valid non-empty import can commit',
        );
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      for (const row of rows.rows) {
        const data = row.raw_row as Parsed;
        const productId = createUuidV7({ now_ms: now.getTime() + row.row_number });
        const variantId = createUuidV7({ now_ms: now.getTime() + row.row_number + 1 });
        const existing = await client.query<{ catalogue_product_id: string }>(
          `SELECT catalogue_product_id FROM marketplace.catalogue_products
            WHERE vendor_location_id=$1 AND product_reference=$2 FOR UPDATE`,
          [input.vendor_location_id, data.product_reference],
        );
        const resolvedProductId = existing.rows[0]?.catalogue_product_id ?? productId;
        if (!existing.rows[0]) {
          await client.query(
            `INSERT INTO marketplace.catalogue_products (catalogue_product_id,vendor_location_id,product_reference,title,category,unit_label,tax_basis,variable_weight,permitted_weight_variance_bps,request_id,correlation_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
            [
              resolvedProductId,
              input.vendor_location_id,
              data.product_reference,
              data.title,
              data.category,
              data.unit_label,
              data.tax_basis,
              data.variable_weight === 'true',
              data.variable_weight === 'true' ? Number(data.permitted_weight_variance_bps) : null,
              ids.request,
              ids.correlation,
              now,
            ],
          );
        }
        const variant = await client.query<{ catalogue_variant_id: string }>(
          `SELECT catalogue_variant_id FROM marketplace.catalogue_product_variants WHERE catalogue_product_id=$1 AND sku=$2 FOR UPDATE`,
          [resolvedProductId, data.sku],
        );
        const resolvedVariantId = variant.rows[0]?.catalogue_variant_id ?? variantId;
        if (!variant.rows[0])
          await client.query(
            `INSERT INTO marketplace.catalogue_product_variants (catalogue_variant_id,catalogue_product_id,sku,variant_title,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
            [
              resolvedVariantId,
              resolvedProductId,
              data.sku,
              data.variant_title,
              ids.request,
              ids.correlation,
              now,
            ],
          );
        await client.query(
          `UPDATE marketplace.catalogue_prices SET effective_until=$2 WHERE catalogue_variant_id=$1 AND effective_until IS NULL`,
          [resolvedVariantId, now],
        );
        await client.query(
          `INSERT INTO marketplace.catalogue_prices (catalogue_price_id,catalogue_variant_id,price_minor,currency,effective_from,reason_code,actor_id,request_id,correlation_id,created_at) VALUES ($1,$2,$3,'INR',$4,'CSV_IMPORT',$5,$6,$7,$4)`,
          [
            createUuidV7({ now_ms: now.getTime() + row.row_number + 2 }),
            resolvedVariantId,
            Number(data.price_minor),
            now,
            actorId,
            ids.request,
            ids.correlation,
          ],
        );
        await client.query(
          `UPDATE marketplace.catalogue_import_rows SET row_state='COMMITTED',committed_product_id=$2,committed_at=$3 WHERE catalogue_import_row_id=$1`,
          [row.catalogue_import_row_id, resolvedProductId, now],
        );
      }
      const updated = await client.query<ImportRecord>(
        `UPDATE marketplace.catalogue_imports SET import_state='COMMITTED',committed_rows=valid_rows,committed_at=$2 WHERE catalogue_import_id=$1 RETURNING *`,
        [input.catalogue_import_id, now],
      );
      const committedRows = await client.query<ImportRowRecord>(
        `SELECT row_number,row_state,validation_errors,product_reference FROM marketplace.catalogue_import_rows WHERE catalogue_import_id=$1 ORDER BY row_number`,
        [input.catalogue_import_id],
      );
      const committed = updated.rows[0];
      if (!committed) throw new CatalogueImportNotFoundError();
      return result(
        committed,
        committedRows.rows.map((row) => ({
          row_number: row.row_number,
          row_state: row.row_state,
          validation_errors: row.validation_errors,
          product_reference: row.product_reference,
        })),
      );
    });
  }

  async listProducts(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }) {
    actor(input.context);
    const products = await this.#pool.query<ProductSummaryRecord>(
      `SELECT p.catalogue_product_id,p.product_reference,p.title,p.category,p.unit_label,p.tax_basis,
              p.variable_weight,p.permitted_weight_variance_bps,p.lifecycle_state,p.version,
              COALESCE(json_agg(DISTINCT jsonb_build_object('catalogue_variant_id',v.catalogue_variant_id,'sku',v.sku,'title',v.variant_title,'lifecycle_state',v.lifecycle_state,'price_minor',price.price_minor)) FILTER (WHERE v.catalogue_variant_id IS NOT NULL), '[]') variants,
              COALESCE(json_agg(DISTINCT jsonb_build_object('catalogue_image_id',i.catalogue_image_id,'object_reference',i.object_reference,'alt_text',i.alt_text,'position',i.position)) FILTER (WHERE i.catalogue_image_id IS NOT NULL), '[]') images
         FROM marketplace.catalogue_products p
         LEFT JOIN marketplace.catalogue_product_variants v ON v.catalogue_product_id=p.catalogue_product_id
         LEFT JOIN LATERAL (SELECT price_minor FROM marketplace.catalogue_prices cp WHERE cp.catalogue_variant_id=v.catalogue_variant_id AND cp.effective_until IS NULL) price ON true
         LEFT JOIN marketplace.catalogue_product_images i ON i.catalogue_product_id=p.catalogue_product_id
        WHERE p.vendor_location_id=$1
        GROUP BY p.catalogue_product_id
        ORDER BY p.lifecycle_state ASC,p.title ASC`,
      [input.vendor_location_id],
    );
    return products.rows;
  }

  async createProduct(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly product_reference: string;
    readonly title: string;
    readonly category: string;
    readonly unit_label: string;
    readonly tax_basis: string;
    readonly variable_weight: boolean;
    readonly permitted_weight_variance_bps?: number | null;
    readonly sku: string;
    readonly variant_title: string;
    readonly price_minor: number;
    readonly initial_stock_quantity?: number;
    readonly low_stock_threshold?: number;
    readonly now?: Date;
  }) {
    const actorId = actor(input.context);
    if (
      !productRef.test(input.product_reference) ||
      !title.test(input.title) ||
      !title.test(input.variant_title) ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.category) ||
      !/^[A-Z][A-Z0-9_]{1,31}$/.test(input.unit_label) ||
      !['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT'].includes(input.tax_basis) ||
      !sku.test(input.sku) ||
      !Number.isSafeInteger(input.price_minor) ||
      input.price_minor < 0 ||
      input.price_minor > 1_000_000_000 ||
      (input.variable_weight && !isVarianceInRange(input.permitted_weight_variance_bps)) ||
      (!input.variable_weight && input.permitted_weight_variance_bps != null)
    )
      throw new CatalogueImportInputError();
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      const productId = createUuidV7({ now_ms: now.getTime() });
      const variantId = createUuidV7({ now_ms: now.getTime() + 1 });
      try {
        await client.query(
          `INSERT INTO marketplace.catalogue_products (catalogue_product_id,vendor_location_id,product_reference,title,category,unit_label,tax_basis,variable_weight,permitted_weight_variance_bps,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [
            productId,
            input.vendor_location_id,
            input.product_reference,
            input.title,
            input.category,
            input.unit_label,
            input.tax_basis,
            input.variable_weight,
            input.variable_weight ? input.permitted_weight_variance_bps : null,
            ids.request,
            ids.correlation,
            now,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error))
          throw new CatalogueImportConflictError('Product reference exists');
        throw error;
      }
      await client.query(
        `INSERT INTO marketplace.catalogue_product_variants (catalogue_variant_id,catalogue_product_id,sku,variant_title,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [variantId, productId, input.sku, input.variant_title, ids.request, ids.correlation, now],
      );
      await client.query(
        `INSERT INTO marketplace.catalogue_prices (catalogue_price_id,catalogue_variant_id,price_minor,currency,effective_from,reason_code,actor_id,request_id,correlation_id,created_at) VALUES ($1,$2,$3,'INR',$4,'MANUAL_CREATE',$5,$6,$7,$4)`,
        [
          createUuidV7({ now_ms: now.getTime() + 2 }),
          variantId,
          input.price_minor,
          now,
          actorId,
          ids.request,
          ids.correlation,
        ],
      );
      // Provision an inventory_items row keyed by (vendor_location_id, product_reference)
      // so customer discovery does not treat the new product as stale. When an initial
      // stock quantity is supplied, we create a COUNTED item; otherwise VENDOR_CONFIRMS.
      const inventoryId = createUuidV7({ now_ms: now.getTime() + 3 });
      const hasStock =
        typeof input.initial_stock_quantity === 'number' &&
        Number.isSafeInteger(input.initial_stock_quantity) &&
        input.initial_stock_quantity >= 0;
      const threshold =
        typeof input.low_stock_threshold === 'number' &&
        Number.isSafeInteger(input.low_stock_threshold)
          ? Math.max(0, input.low_stock_threshold)
          : 0;
      if (hasStock) {
        const qty = input.initial_stock_quantity as number;
        const state = qty === 0 ? 'OUT_OF_STOCK' : qty <= threshold ? 'LOW_STOCK' : 'AVAILABLE';
        await client.query(
          `INSERT INTO marketplace.inventory_items
             (inventory_item_id, vendor_location_id, product_reference, display_name,
              quantity_basis, availability_state, exact_available_quantity, low_stock_threshold,
              last_confirmed_at, version, request_id, correlation_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'COUNTED', $5, $6, $7, $8, 1, $9, $10, $8, $8)
           ON CONFLICT DO NOTHING`,
          [
            inventoryId,
            input.vendor_location_id,
            input.product_reference,
            input.title,
            state,
            qty,
            threshold,
            now,
            ids.request,
            ids.correlation,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO marketplace.inventory_items
             (inventory_item_id, vendor_location_id, product_reference, display_name,
              quantity_basis, availability_state, last_confirmed_at, version, request_id,
              correlation_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'VENDOR_CONFIRMS', 'VENDOR_CONFIRMS', $5, 1, $6, $7, $5, $5)
           ON CONFLICT DO NOTHING`,
          [
            inventoryId,
            input.vendor_location_id,
            input.product_reference,
            input.title,
            now,
            ids.request,
            ids.correlation,
          ],
        );
      }
      return { catalogue_product_id: productId, catalogue_variant_id: variantId, version: 1 };
    });
  }

  async setVariantPrice(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_variant_id: UuidV7;
    readonly price_minor: number;
    readonly reason_code?: string;
    readonly now?: Date;
  }): Promise<{ readonly catalogue_price_id: UuidV7 }> {
    const actorId = actor(input.context);
    if (
      !Number.isSafeInteger(input.price_minor) ||
      input.price_minor < 0 ||
      input.price_minor > 1_000_000_000
    ) {
      throw new CatalogueImportInputError();
    }
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    // Validate the variant belongs to a product in this vendor's location.
    const scope = await this.#pool.query<{ exists: boolean }>(
      `SELECT 1 AS exists FROM marketplace.catalogue_product_variants v
         JOIN marketplace.catalogue_products p ON p.catalogue_product_id = v.catalogue_product_id
        WHERE v.catalogue_variant_id = $1 AND p.vendor_location_id = $2 AND v.lifecycle_state = 'ACTIVE'`,
      [input.catalogue_variant_id, input.vendor_location_id],
    );
    if (!scope.rows[0]) {
      throw new CatalogueImportInputError();
    }
    const priceId = createUuidV7({ now_ms: now.getTime() });
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Close the price this one replaces. Every reader of a current price
      // matches on `effective_until IS NULL`, so leaving the old row open left
      // two current prices for the same variant: discovery picked one of them
      // arbitrarily with LIMIT 1, and checkout's placement guard — which
      // refuses a quote whose snapshot price no longer matches — could compare
      // against whichever row the planner happened to return.
      await client.query(
        `UPDATE marketplace.catalogue_prices
            SET effective_until=$2
          WHERE catalogue_variant_id=$1 AND effective_until IS NULL`,
        [input.catalogue_variant_id, now],
      );
      await client.query(
        `INSERT INTO marketplace.catalogue_prices
           (catalogue_price_id, catalogue_variant_id, price_minor, currency,
            effective_from, reason_code, actor_id, request_id, correlation_id, created_at)
         VALUES ($1, $2, $3, 'INR', $4, $5, $6, $7, $8, $4)`,
        [
          priceId,
          input.catalogue_variant_id,
          input.price_minor,
          now,
          input.reason_code ?? 'MANUAL_UPDATE',
          actorId,
          requestId,
          correlationId,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { catalogue_price_id: priceId };
  }

  async listCategories(
    input: {
      readonly vendor_location_id?: UuidV7;
    } = {},
  ): Promise<readonly { readonly category: string; readonly product_count: number }[]> {
    const rows = input.vendor_location_id
      ? await this.#pool.query<{ category: string; product_count: string }>(
          `SELECT category, COUNT(*)::text AS product_count
             FROM marketplace.catalogue_products
            WHERE vendor_location_id = $1 AND lifecycle_state = 'ACTIVE'
            GROUP BY category
            ORDER BY category`,
          [input.vendor_location_id],
        )
      : await this.#pool.query<{ category: string; product_count: string }>(
          `SELECT p.category, COUNT(*)::text AS product_count
             FROM marketplace.catalogue_products p
             JOIN marketplace.vendor_publication_cases pub
               ON pub.vendor_location_id = p.vendor_location_id AND pub.lifecycle_state = 'PUBLISHED'
            WHERE p.lifecycle_state = 'ACTIVE'
            GROUP BY p.category
            ORDER BY p.category`,
        );
    return rows.rows.map((row) => ({
      category: row.category,
      product_count: Number(row.product_count),
    }));
  }

  async updateProduct(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_product_id: UuidV7;
    readonly expected_version: number;
    readonly title: string;
    readonly category: string;
    readonly unit_label: string;
    readonly tax_basis: string;
    readonly variable_weight: boolean;
    readonly permitted_weight_variance_bps?: number | null;
    readonly now?: Date;
  }) {
    actor(input.context);
    if (
      !Number.isSafeInteger(input.expected_version) ||
      input.expected_version < 1 ||
      !title.test(input.title) ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.category) ||
      !/^[A-Z][A-Z0-9_]{1,31}$/.test(input.unit_label) ||
      !['INCLUSIVE', 'EXCLUSIVE', 'EXEMPT'].includes(input.tax_basis) ||
      (input.variable_weight && !isVarianceInRange(input.permitted_weight_variance_bps)) ||
      (!input.variable_weight && input.permitted_weight_variance_bps != null)
    )
      throw new CatalogueImportInputError();
    const updated = await this.#pool.query<ProductStateRecord>(
      `UPDATE marketplace.catalogue_products SET title=$4,category=$5,unit_label=$6,tax_basis=$7,variable_weight=$8,permitted_weight_variance_bps=$9,version=version+1,updated_at=$10 WHERE catalogue_product_id=$1 AND vendor_location_id=$2 AND version=$3 RETURNING catalogue_product_id,version,lifecycle_state`,
      [
        input.catalogue_product_id,
        input.vendor_location_id,
        input.expected_version,
        input.title,
        input.category,
        input.unit_label,
        input.tax_basis,
        input.variable_weight,
        input.variable_weight ? input.permitted_weight_variance_bps : null,
        input.now ?? new Date(),
      ],
    );
    if (!updated.rows[0]) throw new CatalogueProductNotFoundError();
    return updated.rows[0];
  }

  async setLifecycle(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_product_id: UuidV7;
    readonly expected_version: number;
    readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
    readonly now?: Date;
  }) {
    actor(input.context);
    const updated = await this.#pool.query<ProductStateRecord>(
      `UPDATE marketplace.catalogue_products SET lifecycle_state=$4,version=version+1,updated_at=$5 WHERE catalogue_product_id=$1 AND vendor_location_id=$2 AND version=$3 RETURNING catalogue_product_id,version,lifecycle_state`,
      [
        input.catalogue_product_id,
        input.vendor_location_id,
        input.expected_version,
        input.lifecycle_state,
        input.now ?? new Date(),
      ],
    );
    if (!updated.rows[0]) throw new CatalogueProductNotFoundError();
    return updated.rows[0];
  }

  async addImage(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_product_id: UuidV7;
    readonly object_reference: string;
    readonly alt_text: string;
    readonly position: number;
    /**
     * What the protected object store needs to hand the bytes back.
     *
     * `readGranted` verifies content against an expected checksum before
     * returning it, so a row without one can never be served; the media type is
     * recorded rather than sniffed at request time. Omitted for a fixture row
     * that references no stored object, which then renders as a placeholder.
     */
    readonly stored?: {
      readonly media_type: 'image/jpeg' | 'image/png';
      readonly content_sha256: string;
      readonly content_length: number;
    };
    readonly now?: Date;
  }) {
    actor(input.context);
    // Accept opaque provider references and locally-stored object keys.
    if (
      !(
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,255}$/.test(input.object_reference) ||
        /^catalogue-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/object$/.test(input.object_reference)
      ) ||
      !title.test(input.alt_text) ||
      !Number.isSafeInteger(input.position) ||
      input.position < 1 ||
      input.position > 20
    )
      throw new CatalogueImportInputError();
    return tx(this.#pool, async (client) => {
      const product = await client.query(
        `SELECT 1 FROM marketplace.catalogue_products WHERE catalogue_product_id=$1 AND vendor_location_id=$2 FOR UPDATE`,
        [input.catalogue_product_id, input.vendor_location_id],
      );
      if (!product.rows[0]) throw new CatalogueProductNotFoundError();
      const imageId = createUuidV7({ now_ms: (input.now ?? new Date()).getTime() });
      try {
        await client.query(
          `INSERT INTO marketplace.catalogue_product_images (catalogue_image_id,catalogue_product_id,object_reference,alt_text,position,media_type,content_sha256,content_length,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            imageId,
            input.catalogue_product_id,
            input.object_reference,
            input.alt_text,
            input.position,
            input.stored?.media_type ?? null,
            input.stored?.content_sha256 ?? null,
            input.stored?.content_length ?? null,
            input.now ?? new Date(),
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error))
          throw new CatalogueImportConflictError('Image position exists');
        throw error;
      }
      return { catalogue_image_id: imageId };
    });
  }

  /**
   * The bytes of one published catalogue image.
   *
   * Public on purpose: a storefront photograph is Public data under the
   * architecture's classification, unlike a vendor's verification documents,
   * which share the same object store behind an authenticated, granted path.
   * The grant is minted here and consumed immediately, so no signed URL is ever
   * handed to a browser and the object key never leaves the server.
   *
   * Returns null when the image does not exist, belongs to a product that is no
   * longer active, or is a fixture row with no stored object — all of which the
   * caller answers identically, so a probe cannot distinguish them.
   */
  async readPublishedImage(input: {
    readonly catalogue_image_id: UuidV7;
    readonly now?: Date;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly media_type: 'image/jpeg' | 'image/png';
    readonly content_sha256: string;
  } | null> {
    if (!this.#storage) return null;
    const found = await this.#pool.query<{
      object_reference: string;
      media_type: 'image/jpeg' | 'image/png' | null;
      content_sha256: string | null;
    }>(
      `SELECT i.object_reference, i.media_type, i.content_sha256
         FROM marketplace.catalogue_product_images i
         JOIN marketplace.catalogue_products p
           ON p.catalogue_product_id = i.catalogue_product_id
        WHERE i.catalogue_image_id = $1
          AND p.lifecycle_state = 'ACTIVE'
          AND i.content_sha256 IS NOT NULL`,
      [input.catalogue_image_id],
    );
    const row = found.rows[0];
    if (!row || row.media_type === null || row.content_sha256 === null) return null;
    const grant = this.#storage.issueReadGrant({
      object_key: row.object_reference,
      ttl_seconds: 30,
    });
    try {
      const bytes = await this.#storage.readGranted({
        expected_sha256: row.content_sha256,
        grant,
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      return { bytes, media_type: row.media_type, content_sha256: row.content_sha256 };
    } catch {
      // A missing or corrupted object is an operational fault, not a client
      // error: the caller renders the placeholder rather than a broken image.
      return null;
    }
  }

  async setSubstitution(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_variant_id: UuidV7;
    readonly replacement_variant_id: UuidV7;
    readonly reason: string;
    readonly active: boolean;
    readonly now?: Date;
  }) {
    const actorId = actor(input.context);
    if (input.catalogue_variant_id === input.replacement_variant_id || !title.test(input.reason))
      throw new CatalogueImportInputError();
    return tx(this.#pool, async (client) => {
      const variants = await client.query<VariantIdRecord>(
        `SELECT v.catalogue_variant_id FROM marketplace.catalogue_product_variants v JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id WHERE p.vendor_location_id=$1 AND v.catalogue_variant_id IN ($2,$3)`,
        [input.vendor_location_id, input.catalogue_variant_id, input.replacement_variant_id],
      );
      if (variants.rows.length !== 2) throw new CatalogueProductNotFoundError();
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
        now: input.now ?? new Date(),
      };
      const existing = await client.query<SubstitutionIdRecord>(
        `SELECT catalogue_substitution_id FROM marketplace.catalogue_product_substitutions WHERE catalogue_variant_id=$1 AND replacement_variant_id=$2 FOR UPDATE`,
        [input.catalogue_variant_id, input.replacement_variant_id],
      );
      const existingSubstitution = existing.rows[0];
      if (existingSubstitution) {
        const updated = await client.query<SubstitutionStateRecord>(
          `UPDATE marketplace.catalogue_product_substitutions SET lifecycle_state=$2,reason=$3,actor_id=$4,request_id=$5,correlation_id=$6,updated_at=$7 WHERE catalogue_substitution_id=$1 RETURNING catalogue_substitution_id,lifecycle_state`,
          [
            existingSubstitution.catalogue_substitution_id,
            input.active ? 'ACTIVE' : 'INACTIVE',
            input.reason,
            actorId,
            ids.request,
            ids.correlation,
            ids.now,
          ],
        );
        return updated.rows[0];
      }
      const id = createUuidV7({ now_ms: ids.now.getTime() });
      await client.query(
        `INSERT INTO marketplace.catalogue_product_substitutions (catalogue_substitution_id,catalogue_variant_id,replacement_variant_id,lifecycle_state,reason,actor_id,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          input.catalogue_variant_id,
          input.replacement_variant_id,
          input.active ? 'ACTIVE' : 'INACTIVE',
          input.reason,
          actorId,
          ids.request,
          ids.correlation,
          ids.now,
        ],
      );
      return {
        catalogue_substitution_id: id,
        lifecycle_state: input.active ? 'ACTIVE' : 'INACTIVE',
      };
    });
  }
}
