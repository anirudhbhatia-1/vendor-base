import { createHash } from 'node:crypto';
import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import {
  REPORT_CATALOGUE,
  ReportingAuthorizationError,
  ReportingInputError,
  ReportingNotFoundError,
  ReportingService,
  ReportingStateError,
  type Metric,
} from '../src/reporting.js';
import { VendorFulfilmentService } from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { adminContext, check, customerContext, rejects, vendorContext } from './verify-support.js';

/**
 * 11.8 -- reports and exports, walked.
 *
 * Two shops in two named zones; two orders at the first (one accepted), one
 * at the second. Each person sees the reports their work is measured by:
 * support its own, finance its own, incident command all seven. A support
 * agent scoped to the first zone reads that zone and nothing wider. The
 * zone's figures are the orders placed there, their value, the funnel and
 * the acceptance, each defined and stamped with when it was read. A finance
 * approver exports the finance report: it is RESTRICTED however it is asked
 * for, the snapshot's hash matches what is taken, nobody else can take it,
 * it is taken once, and a lapsed export loses its content. Every attempt is
 * on the export's record.
 */
export async function verifyReporting(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'reporting-verifier' });
  const HASH_KEY = 'synthetic-verifier-handover-code-material';
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
  const fulfilment = new VendorFulfilmentService({
    connection_string: connectionString,
    inventory,
    hash_key: HASH_KEY,
  });
  const reporting = new ReportingService({ connection_string: connectionString });
  const now = new Date(Date.now() - 2 * 60_000);
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
  const people = {
    commander: createUuidV7(),
    financeOperator: createUuidV7(),
    financeApprover: createUuidV7(),
    support: createUuidV7(),
    zoneSupport: createUuidV7(),
    delivery: createUuidV7(),
    first: createUuidV7(),
    second: createUuidV7(),
    third: createUuidV7(),
  };
  const grant = async (
    user: UuidV7,
    role: string,
    scope: { kind: 'GLOBAL' | 'ZONE'; id: string | null },
  ) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [assignment, user, role, later(-3_600), createUuidV7(), later(365 * 86_400)],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [createUuidV7(), assignment, user, scope.kind, scope.id, later(-3_600)],
    );
  };
  const global = { kind: 'GLOBAL' as const, id: null };
  const as = (user: UuidV7) => adminContext(user);
  const valueOf = (metrics: readonly Metric[], key: string) =>
    metrics.find((metric) => metric.key === key)?.value;
  const accesses = async (id: string) =>
    (
      await pool.query<{ outcome: string; actor_id: string }>(
        'SELECT outcome, actor_id FROM marketplace.report_export_accesses WHERE report_export_id=$1 ORDER BY occurred_at, report_export_access_id',
        [id],
      )
    ).rows;

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );

    // Two shops, each in its own named zone.
    const tag = people.commander.replaceAll('-', '').slice(-8).toUpperCase();
    const stores = await Promise.all(
      ['A', 'B'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Reporting Store ${suffix}`,
          latitude: 26.941 + index * 0.001,
          longitude: 75.841,
          fulfilment_modes: ['PLATFORM_DELIVERY'],
        }),
      ),
    );
    const [storeA, storeB] = stores;
    check(storeA && storeB, 'Store fixtures missing');
    const zones: string[] = [];
    for (const [index, store] of stores.entries()) {
      const zone = await pool.query<{ service_zone_id: string }>(
        `UPDATE marketplace.vendor_service_zones SET zone_name=$2
          WHERE vendor_location_id=$1 RETURNING service_zone_id::text`,
        [store.locationId, `SYNTH Reporting Zone ${index === 0 ? 'A' : 'B'} ${tag}`],
      );
      const id = zone.rows[0]?.service_zone_id;
      check(id, 'The fixture shop has no zone');
      zones.push(id);
    }
    const [zoneA, zoneB] = zones;
    check(zoneA && zoneB, 'Zones missing');

    await grant(people.commander, 'INCIDENT_COMMANDER', global);
    await grant(people.financeOperator, 'FINANCE_OPERATOR', global);
    await grant(people.financeApprover, 'FINANCE_APPROVER', global);
    await grant(people.support, 'SUPPORT_AGENT', global);
    await grant(people.zoneSupport, 'SUPPORT_AGENT', { kind: 'ZONE', id: zoneA });
    await grant(people.delivery, 'DELIVERY_OPERATOR', global);

    const variants: UuidV7[] = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-REP${suffix}`,
        title: `SYNTH Reporting Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-REP${suffix}`,
        variant_title: `SYNTH Reporting Variant ${index}`,
        price_minor: 12_000 + index * 1_000,
        initial_stock_quantity: 10,
        low_stock_threshold: 1,
        now,
      });
      variants.push(product.catalogue_variant_id as UuidV7);
    }
    const order = async (customer: UuidV7, storeIndex: number, at: Date) => {
      const store = stores[storeIndex];
      const variant = variants[storeIndex];
      check(store && variant, 'Order fixture missing');
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-REPORT-' || $4,'SYNTH Reporting Home','302020',
           ST_SetSRID(ST_MakePoint(75.845,26.941),4326)::geography,$3,$3)`,
        [
          addressId,
          customer,
          createUuidV7(),
          customer.replaceAll('-', '').slice(-10).toUpperCase(),
        ],
      );
      const shopper = customerContext(customer);
      const cart = await carts.currentCart({ context: shopper, now: at });
      await carts.setCartAddress({ context: shopper, customer_address_id: addressId, now: at });
      await carts.addLine({
        context: shopper,
        vendor_location_id: store.locationId,
        catalogue_variant_id: variant,
        quantity: 1,
        now: at,
      });
      const quote = await checkout.createQuote({
        context: shopper,
        cart_id: cart.cart_id,
        now: at,
      });
      const placed = await checkout.place({
        context: shopper,
        checkout_quote_id: quote.checkout_quote_id,
        provider_scenario: 'SUCCESS',
        idempotency_key: `report-${customer}`,
        now: new Date(at.getTime() + 1_000),
      });
      const placedOrder = placed.orders[0];
      check(placedOrder, 'The fixture did not place an order');
      return placedOrder;
    };
    const firstOrder = await order(people.first, 0, later(10));
    await order(people.second, 0, later(20));
    await order(people.third, 1, later(30));
    await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: firstOrder.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: firstOrder.version,
      preparation_estimate_seconds: 600,
      now: later(40),
    });
    const at = later(60);

    // 1. Each person sees the reports their work is measured by.
    const kinds = async (user: UuidV7) =>
      (await reporting.catalogue({ context: as(user), now: at })).reports
        .map((report) => report.kind)
        .sort()
        .join(',');
    const commanderCatalogue = await reporting.catalogue({
      context: as(people.commander),
      now: at,
    });
    check(
      (await kinds(people.support)) === 'CUSTOMER_FUNNEL,SUPPORT' &&
        (await kinds(people.financeOperator)) === 'FINANCE,MARKETPLACE' &&
        (await kinds(people.delivery)) === 'DELIVERY_OPERATIONS' &&
        commanderCatalogue.reports.length === REPORT_CATALOGUE.length &&
        commanderCatalogue.reports.every((report) => report.exportable) &&
        (await reporting.catalogue({ context: as(people.financeOperator), now: at })).reports.every(
          (report) => !report.exportable,
        ),
      'The report catalogue did not follow the work each role does',
    );

    // 2. Role: nobody reads a report their work is not measured by.
    await rejects(
      () => reporting.report({ context: as(people.support), report_kind: 'FINANCE', now: at }),
      ReportingAuthorizationError,
      'A support agent read the finance report',
    );
    await rejects(
      () =>
        reporting.report({ context: as(people.financeOperator), report_kind: 'SUPPORT', now: at }),
      ReportingAuthorizationError,
      'A finance operator read the support report',
    );
    await rejects(
      () => reporting.report({ context: as(people.delivery), report_kind: 'RISK', now: at }),
      ReportingAuthorizationError,
      'A delivery operator read the risk report',
    );

    // 3. Scope: a zone-scoped agent reads their zone and nothing wider.
    await rejects(
      () => reporting.report({ context: as(people.zoneSupport), report_kind: 'SUPPORT', now: at }),
      ReportingAuthorizationError,
      'An agent scoped to one zone read the whole platform',
    );
    await rejects(
      () =>
        reporting.report({
          context: as(people.zoneSupport),
          report_kind: 'SUPPORT',
          service_zone_id: zoneB,
          now: at,
        }),
      ReportingAuthorizationError,
      'An agent scoped to one zone read another',
    );
    const zoneSupport = await reporting.report({
      context: as(people.zoneSupport),
      report_kind: 'SUPPORT',
      service_zone_id: zoneA,
      now: at,
    });
    check(
      zoneSupport.scope.kind === 'ZONE' && zoneSupport.scope.shops === 1,
      'The zone-scoped agent could not read their zone',
    );
    await rejects(
      () =>
        reporting.report({
          context: as(people.commander),
          report_kind: 'FINANCE',
          service_zone_id: zoneA,
          now: at,
        }),
      ReportingInputError,
      'The finance report was scoped to a zone',
    );

    // 4. The figures: the zone's own orders, their value, funnel and acceptance.
    const totals = await pool.query<{ vendor_location_id: string; n: string; value: string }>(
      `SELECT vendor_location_id::text, count(*)::text AS n, sum(total_minor)::text AS value
         FROM marketplace.vendor_orders WHERE vendor_location_id = ANY($1::uuid[]) GROUP BY 1`,
      [[storeA.locationId, storeB.locationId]],
    );
    const totalA = totals.rows.find((row) => row.vendor_location_id === storeA.locationId);
    check(totalA, 'Zone A order totals missing');
    const marketA = await reporting.report({
      context: as(people.commander),
      report_kind: 'MARKETPLACE',
      service_zone_id: zoneA,
      now: at,
    });
    const marketB = await reporting.report({
      context: as(people.commander),
      report_kind: 'MARKETPLACE',
      service_zone_id: zoneB,
      now: at,
    });
    check(
      valueOf(marketA.metrics, 'orders_placed') === 2 &&
        valueOf(marketA.metrics, 'gross_order_value') === Number(totalA.value) &&
        valueOf(marketA.metrics, 'average_order_value') === Math.floor(Number(totalA.value) / 2) &&
        valueOf(marketA.metrics, 'shops_live') === 1 &&
        valueOf(marketB.metrics, 'orders_placed') === 1,
      `The marketplace figures are not the zone's orders (${JSON.stringify({ a: marketA.metrics, b: marketB.metrics, totals: totals.rows })})`,
    );
    const funnelA = await reporting.report({
      context: as(people.support),
      report_kind: 'CUSTOMER_FUNNEL',
      service_zone_id: zoneA,
      now: at,
    });
    check(
      valueOf(funnelA.metrics, 'baskets_started') === 2 &&
        valueOf(funnelA.metrics, 'baskets_quoted') === 2 &&
        valueOf(funnelA.metrics, 'checkouts_placed') === 2 &&
        valueOf(funnelA.metrics, 'quote_to_checkout') === 10_000,
      `The funnel is not the zone's baskets (${JSON.stringify(funnelA.metrics)})`,
    );
    const healthA = await reporting.report({
      context: as(people.commander),
      report_kind: 'VENDOR_HEALTH',
      service_zone_id: zoneA,
      now: at,
    });
    check(
      valueOf(healthA.metrics, 'orders_answered') === 1 &&
        valueOf(healthA.metrics, 'acceptance_rate') === 10_000 &&
        valueOf(healthA.metrics, 'average_accept_time') !== null,
      `The shop's acceptance is not its orders (${JSON.stringify(healthA.metrics)})`,
    );
    // A period that ends before the orders counts none of them.
    const before = await reporting.report({
      context: as(people.commander),
      report_kind: 'MARKETPLACE',
      service_zone_id: zoneA,
      from: later(-3_600),
      to: later(5),
      now: at,
    });
    check(valueOf(before.metrics, 'orders_placed') === 0, 'The period filter was not applied');

    // 5. Every figure defined; freshness stated; periods bounded.
    for (const entry of REPORT_CATALOGUE) {
      const report = await reporting.report({
        context: as(people.commander),
        report_kind: entry.kind,
        now: at,
      });
      check(
        report.metrics.length > 0 &&
          report.metrics.every(
            (metric) => metric.definition.length > 20 && ['PERIOD', 'NOW'].includes(metric.window),
          ) &&
          report.freshness.source === 'LIVE' &&
          report.freshness.as_of === report.generated_at &&
          report.classification === entry.classification &&
          new Date(report.period.to).getTime() <= at.getTime(),
        `${entry.kind} does not define its figures or state its freshness`,
      );
    }
    await rejects(
      () =>
        reporting.report({
          context: as(people.commander),
          report_kind: 'MARKETPLACE',
          from: later(-100 * 86_400),
          now: at,
        }),
      ReportingInputError,
      'A report ran over more than a quarter',
    );
    await rejects(
      () =>
        reporting.report({
          context: as(people.commander),
          report_kind: 'MARKETPLACE',
          from: later(30),
          to: later(10),
          now: at,
        }),
      ReportingInputError,
      'A report ran over a period that ends before it starts',
    );
    await reporting.report({
      context: as(people.financeOperator),
      report_kind: 'FINANCE',
      now: at,
    });
    const restrictedRead = await pool.query(
      `SELECT 1 FROM marketplace.operational_audit_events
        WHERE action='REPORT_READ' AND target_reference='FINANCE' AND actor_id=$1`,
      [people.financeOperator],
    );
    check(restrictedRead.rows.length === 1, 'Reading a restricted report was not recorded');

    // 6. Exports: the approver's, RESTRICTED however asked for.
    await rejects(
      () =>
        reporting.createExport({
          context: as(people.financeOperator),
          report_kind: 'FINANCE',
          now: at,
        }),
      ReportingAuthorizationError,
      'An operator without export authority exported the finance report',
    );
    await rejects(
      () =>
        reporting.createExport({
          context: as(people.financeApprover),
          report_kind: 'FINANCE',
          classification: 'INTERNAL',
          now: at,
        }),
      ReportingInputError,
      'The finance report was exported below RESTRICTED',
    );
    await rejects(
      () =>
        reporting.createExport({
          context: as(people.financeApprover),
          report_kind: 'SUPPORT',
          now: at,
        }),
      ReportingAuthorizationError,
      'An approver exported a report outside their work',
    );
    const exported = await reporting.createExport({
      context: as(people.financeApprover),
      report_kind: 'FINANCE',
      from: later(-86_400),
      now: at,
    });
    check(
      exported.classification === 'RESTRICTED' && exported.download_token.startsWith('nsx_'),
      'The finance export was not RESTRICTED',
    );
    const recorded = await pool.query<{
      exported_by_user_id: string;
      filters: { from: string; to: string; service_zone_id: string | null };
      classification: string;
      created_at: Date;
    }>(
      'SELECT exported_by_user_id, filters, classification, created_at FROM marketplace.report_exports WHERE report_export_id=$1',
      [exported.report_export_id],
    );
    check(
      recorded.rows[0]?.exported_by_user_id === people.financeApprover &&
        recorded.rows[0].filters.from === later(-86_400).toISOString() &&
        recorded.rows[0].classification === 'RESTRICTED' &&
        recorded.rows[0].created_at.getTime() === at.getTime(),
      'The export did not record its exporter, filters, time and classification',
    );
    let downgraded = false;
    try {
      await pool.query(
        `UPDATE marketplace.report_exports SET classification='INTERNAL' WHERE report_export_id=$1`,
        [exported.report_export_id],
      );
    } catch (error) {
      downgraded = (error as { code?: string }).code === '23514';
    }
    check(downgraded, 'The schema let a finance export be downgraded');

    // 7. Nobody else takes it; its owner takes it once; the hash matches.
    await rejects(
      () =>
        reporting.redeemExport({
          context: as(people.commander),
          download_token: exported.download_token,
          now: later(70),
        }),
      ReportingNotFoundError,
      'Someone other than the exporter took an export',
    );
    const taken = await reporting.redeemExport({
      context: as(people.financeApprover),
      download_token: exported.download_token,
      now: later(71),
    });
    const content = JSON.parse(taken.content) as { report_kind: string; metrics: Metric[] };
    check(
      content.report_kind === 'FINANCE' &&
        content.metrics.some((metric) => metric.key === 'ledger_conserved') &&
        createHash('sha256').update(taken.content).digest('hex') === exported.content_sha256 &&
        taken.content_sha256 === exported.content_sha256,
      'The export taken is not the snapshot that was made',
    );
    await rejects(
      () =>
        reporting.redeemExport({
          context: as(people.financeApprover),
          download_token: exported.download_token,
          now: later(72),
        }),
      ReportingStateError,
      'An export was taken twice',
    );
    const afterTaking = await pool.query<{
      content: unknown;
      purged_at: Date | null;
      content_sha256: string;
    }>(
      'SELECT content, purged_at, content_sha256 FROM marketplace.report_exports WHERE report_export_id=$1',
      [exported.report_export_id],
    );
    check(
      afterTaking.rows[0]?.content === null &&
        afterTaking.rows[0].purged_at !== null &&
        afterTaking.rows[0].content_sha256 === exported.content_sha256,
      'A taken export kept its content, or lost its hash',
    );
    check(
      (await accesses(exported.report_export_id)).map((row) => row.outcome).join(',') ===
        'REFUSED_NOT_EXPORTER,DOWNLOADED,REFUSED_ALREADY_TAKEN',
      'The attempts to take the export are not on its record',
    );

    // 8. A zone export that lapses loses its content, and is refused.
    const zoneExport = await reporting.createExport({
      context: as(people.commander),
      report_kind: 'MARKETPLACE',
      service_zone_id: zoneA,
      expires_in_minutes: 5,
      now: at,
    });
    await rejects(
      () =>
        reporting.createExport({
          context: as(people.commander),
          report_kind: 'MARKETPLACE',
          expires_in_minutes: 120,
          now: at,
        }),
      ReportingInputError,
      'An export was left available for two hours',
    );
    // Lapsed but not yet swept: refused on its time alone.
    await rejects(
      () =>
        reporting.redeemExport({
          context: as(people.commander),
          download_token: zoneExport.download_token,
          now: later(60 + 7 * 60),
        }),
      ReportingStateError,
      'A lapsed export was taken',
    );
    const purged = await reporting.purgeLapsed({
      context: as(people.commander),
      now: later(60 + 6 * 60),
    });
    const lapsed = await pool.query<{
      content: unknown;
      scope_kind: string;
      scope_reference: string;
    }>(
      'SELECT content, scope_kind, scope_reference FROM marketplace.report_exports WHERE report_export_id=$1',
      [zoneExport.report_export_id],
    );
    check(
      purged.purged >= 1 &&
        lapsed.rows[0]?.content === null &&
        lapsed.rows[0].scope_kind === 'ZONE' &&
        lapsed.rows[0].scope_reference === zoneA &&
        (await accesses(zoneExport.report_export_id)).map((row) => row.outcome).join(',') ===
          'REFUSED_EXPIRED',
      'A lapsed zone export kept its content, lost its scope, or its refusal went unrecorded',
    );
    await rejects(
      () =>
        reporting.redeemExport({
          context: as(people.commander),
          download_token: 'synthetic-export-x',
          now: at,
        }),
      ReportingInputError,
      'A malformed export token was looked up',
    );

    // 9. The register: each person's own exports; command sees all, with every attempt.
    const own = await reporting.exports({ context: as(people.financeApprover), now: later(500) });
    const all = await reporting.exports({ context: as(people.commander), now: later(500) });
    const mine = own.exports.find((row) => row.report_export_id === exported.report_export_id);
    check(
      own.exports.every((row) => row.exported_by_user_id === people.financeApprover) &&
        mine?.state === 'TAKEN' &&
        mine.accesses.length === 3 &&
        all.exports.some(
          (row) => row.report_export_id === zoneExport.report_export_id && row.state === 'LAPSED',
        ) &&
        all.exports.some((row) => row.report_export_id === exported.report_export_id),
      'The export register does not show exports with their attempts to the right people',
    );
    const created = await pool.query(
      `SELECT 1 FROM marketplace.operational_audit_events
        WHERE action='REPORT_EXPORT_CREATED' AND target_reference = ANY($1::text[])`,
      [[exported.report_export_id, zoneExport.report_export_id]],
    );
    check(created.rows.length === 2, 'Making an export was not audited');
  } finally {
    await Promise.all([
      pool.end(),
      reporting.close(),
      fulfilment.close(),
      checkout.close(),
      carts.close(),
      catalogue.close(),
      inventory.close(),
    ]);
  }
}
