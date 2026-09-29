import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import {
  CONFIGURATION_CATALOGUE,
  ConfigurationPublicationAuthorizationError,
  ConfigurationPublicationInputError,
  ConfigurationPublicationNotFoundError,
  ConfigurationPublicationService,
  ConfigurationPublicationStateError,
} from '../src/configuration-publication.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { activateDueConfigurationVersions } from '../src/versioned-configuration.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { adminContext, check, customerContext, rejects, vendorContext } from './verify-support.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 11.6 -- configuration approval and publication, walked.
 *
 * An operator drafts the shop accept deadline from the catalogue; bad keys,
 * scopes and values are refused. The preview shows the value in force, the
 * one proposed, worked examples and the scope it touches; validating records
 * that report. The proposer cannot approve; a schedule in the past is
 * refused; a schedule is cancelled, then a second version runs for a bounded
 * window, and an order placed inside it is given the new deadline. A
 * protected change needs an hour's notice. A proposal is rejected; a version
 * in force cannot be rolled back to itself, and an earlier one comes back as
 * a new version. Each step is on the version's history.
 */
export async function verifyConfigurationPublication(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    max: 4,
    application_name: 'configuration-publication-verifier',
  });
  const catalogueProducts = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
  const publication = new ConfigurationPublicationService({ connection_string: connectionString });
  const now = new Date(Date.now() - 2 * MINUTE);
  const later = (ms: number) => new Date(now.getTime() + ms);
  const people = {
    operator: createUuidV7(),
    colleague: createUuidV7(),
    approver: createUuidV7(),
    outsider: createUuidV7(),
    mover: createUuidV7(),
    customer: createUuidV7(),
  };
  const grant = async (
    user: UuidV7,
    role: string,
    from = later(-HOUR),
    until: Date | null = null,
  ) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, valid_until, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$7,NULL,$5,$5,$6,$4,$4)`,
      [assignment, user, role, from, createUuidV7(), later(365 * DAY), until],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, later(-HOUR)],
    );
  };
  const operator = adminContext(people.operator);
  const approver = adminContext(people.approver);
  const outsider = adminContext(people.outsider);
  const statusOf = async (id: string) =>
    (
      await pool.query<{ status: string; validation_report: Record<string, unknown> | null }>(
        'SELECT status, validation_report FROM marketplace.configuration_versions WHERE configuration_version_id = $1',
        [id],
      )
    ).rows[0];
  const KEY = 'vendor.accept_deadline_seconds';

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.operator, 'CONFIG_OPERATOR');
    await grant(people.colleague, 'CONFIG_OPERATOR');
    await grant(people.approver, 'CONFIG_APPROVER');
    await grant(people.outsider, 'FINANCE_OPERATOR');
    // Proposes as an operator, then moves to approving: never both at once,
    // so role separation allows it -- and still may not approve their own.
    await grant(people.mover, 'CONFIG_OPERATOR', later(-HOUR), later(2 * MINUTE));
    await grant(people.mover, 'CONFIG_APPROVER', later(2 * MINUTE));

    // 1. The catalogue: the settings operators change, and nothing else.
    await rejects(
      () => publication.catalogue({ context: outsider }),
      ConfigurationPublicationAuthorizationError,
      'Someone outside configuration read the catalogue',
    );
    const catalogue = await publication.catalogue({ context: approver, now });
    check(
      catalogue.settings.length === CONFIGURATION_CATALOGUE.length &&
        catalogue.settings.some((entry) => entry.key === KEY && entry.default_value === 180) &&
        catalogue.settings.some(
          (entry) => entry.key === 'finance.financial_policy' && entry.protected,
        ) &&
        ['FEES_COMMISSIONS_EARNINGS', 'TIMERS', 'LIMITS', 'OPERATIONAL_RULES'].every((category) =>
          catalogue.settings.some((entry) => entry.category === category),
        ),
      'The catalogue does not list the settings by category',
    );

    // Whatever an earlier walk left in force, not the default.
    const groupLimit = catalogue.settings.find(
      (entry) => entry.key === 'customer.cart_group_limit',
    );
    const groupLimitInForce = groupLimit?.global_value ?? groupLimit?.default_value;

    // 2. A draft is a catalogued setting, in a scope it takes, with a value its consumer accepts.
    const draft = (fields: Record<string, unknown> = {}, context = operator) =>
      publication.draft({
        context,
        configuration_key: KEY,
        scope_kind: 'GLOBAL',
        scope_reference: 'GLOBAL',
        configuration_value: 300,
        reason_code: 'SLOWER_SHOPS_NEED_TIME',
        now,
        ...fields,
      });
    await rejects(
      () => draft({ configuration_key: 'vendor.accept_deadline' }),
      ConfigurationPublicationInputError,
      'A key outside the catalogue was drafted',
    );
    await rejects(
      () => draft({ scope_kind: 'VENDOR', scope_reference: 'SYNTH-VENDOR-1' }),
      ConfigurationPublicationInputError,
      'A setting was drafted in a scope it does not take',
    );
    await rejects(
      () => draft({ configuration_value: 30 }),
      ConfigurationPublicationInputError,
      'A value its consumer would ignore was drafted',
    );
    await rejects(
      () =>
        draft({
          configuration_key: 'dispatch.offer_radius_metres',
          scope_kind: 'ZONE',
          scope_reference: createUuidV7(),
          configuration_value: 3_000,
        }),
      ConfigurationPublicationNotFoundError,
      'A setting was drafted for a zone that does not exist',
    );
    await rejects(
      () => draft({}, approver),
      ConfigurationPublicationAuthorizationError,
      'An approver drafted a change',
    );

    // 3. The preview: in force, proposed, examples, scope. Validating records it.
    const first = await draft();
    const preview = await publication.preview({
      context: approver,
      configuration_version_id: first.configuration_version_id,
      now,
    });
    check(
      preview.in_force.value === 180 &&
        preview.proposed === 300 &&
        preview.changed_fields.includes('value') &&
        preview.examples[0]?.before === '3 min' &&
        preview.examples[0]?.after === '5 min' &&
        preview.affected_scope.vendor_locations >= 0 &&
        preview.issues.length === 0,
      `The preview did not show what the change does (${JSON.stringify(preview)})`,
    );
    const validated = await publication.validate({
      context: operator,
      configuration_version_id: first.configuration_version_id,
      reason_code: 'EXAMPLES_CHECKED',
      now,
    });
    check(
      validated.status === 'VALIDATED' &&
        (await statusOf(first.configuration_version_id))?.validation_report?.['proposed'] === 300,
      'Validating did not record the report its approver reads',
    );
    // A value that changes nothing is refused at validation.
    const unchanged = await draft({
      configuration_key: 'customer.cart_group_limit',
      configuration_value: groupLimitInForce,
    });
    await rejects(
      () =>
        publication.validate({
          context: operator,
          configuration_version_id: unchanged.configuration_version_id,
          reason_code: 'EXAMPLES_CHECKED',
          now,
        }),
      ConfigurationPublicationInputError,
      'A change to the value already in force was validated',
    );

    // 4. The proposer cannot approve; a schedule starts now or later; it can be cancelled.
    await rejects(
      () =>
        publication.approve({
          context: operator,
          configuration_version_id: first.configuration_version_id,
          reason_code: 'SELF_APPROVED',
          now,
        }),
      ConfigurationPublicationAuthorizationError,
      'An operator approved a change',
    );
    await publication.approve({
      context: approver,
      configuration_version_id: first.configuration_version_id,
      reason_code: 'EXAMPLES_REVIEWED',
      now,
    });
    await rejects(
      () =>
        publication.schedule({
          context: operator,
          configuration_version_id: first.configuration_version_id,
          effective_from: later(-MINUTE),
          reason_code: 'BACKDATED',
          now,
        }),
      ConfigurationPublicationInputError,
      'A change was scheduled to start in the past',
    );
    await publication.schedule({
      context: operator,
      configuration_version_id: first.configuration_version_id,
      effective_from: later(MINUTE),
      reason_code: 'NEXT_MINUTE',
      now,
    });
    await rejects(
      () =>
        publication.reject({
          context: approver,
          configuration_version_id: first.configuration_version_id,
          reason_code: 'CHANGED_MIND',
          now,
        }),
      ConfigurationPublicationStateError,
      'A scheduled change was rejected instead of cancelled',
    );
    await publication.cancel({
      context: operator,
      configuration_version_id: first.configuration_version_id,
      reason_code: 'WRONG_WEEK',
      now,
    });
    const cancelledDetail = await publication.detail({
      context: approver,
      configuration_version_id: first.configuration_version_id,
      now,
    });
    check(
      cancelledDetail.status === 'CANCELLED' &&
        cancelledDetail.closing_reason_code === 'WRONG_WEEK' &&
        cancelledDetail.history.map((event) => event.to_status).join(',') ===
          'DRAFT,VALIDATED,APPROVED,SCHEDULED,CANCELLED',
      `The cancelled version's history is not its steps (${JSON.stringify(cancelledDetail.history)})`,
    );
    const afterCancel = await activateDueConfigurationVersions(pool, {
      actor_id: people.approver,
      at: later(2 * MINUTE),
      request_id: createUuidV7(),
    });
    check(
      !afterCancel.some(
        (version) => version.configuration_version_id === first.configuration_version_id,
      ),
      'A cancelled change took force',
    );

    // 5. A second version runs for a bounded window; an order inside it gets its deadline.
    const second = await draft({ now: later(3 * MINUTE) });
    await publication.validate({
      context: adminContext(people.colleague),
      configuration_version_id: second.configuration_version_id,
      reason_code: 'EXAMPLES_CHECKED',
      now: later(3 * MINUTE),
    });
    await publication.approve({
      context: approver,
      configuration_version_id: second.configuration_version_id,
      reason_code: 'EXAMPLES_REVIEWED',
      now: later(3 * MINUTE),
    });
    const from = later(4 * MINUTE);
    const until = later(5 * MINUTE);
    await publication.schedule({
      context: operator,
      configuration_version_id: second.configuration_version_id,
      effective_from: from,
      effective_until: until,
      reason_code: 'ONE_MINUTE_TRIAL',
      now: later(3 * MINUTE),
    });
    await activateDueConfigurationVersions(pool, {
      actor_id: people.approver,
      at: from,
      request_id: createUuidV7(),
    });
    check(
      (await statusOf(second.configuration_version_id))?.status === 'ACTIVE',
      'The scheduled change did not take force',
    );

    const store = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Configuration Store',
      latitude: 26.961,
      longitude: 75.861,
      fulfilment_modes: ['PLATFORM_DELIVERY'],
    });
    const suffix = `${Date.now()}`;
    const product = await catalogueProducts.createProduct({
      context: vendorContext(store.ownerUserId),
      vendor_location_id: store.locationId,
      product_reference: `SYNTH-PROD-CFG${suffix}`,
      title: 'SYNTH Configuration Product',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'EACH',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: `SYNTH-SKU-CFG${suffix}`,
      variant_title: 'SYNTH Configuration Variant',
      price_minor: 15_000,
      initial_stock_quantity: 5,
      low_stock_threshold: 1,
      now,
    });
    const shopper = customerContext(people.customer);
    const addressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-CFG-' || $4,'SYNTH Configuration Home','302020',
         ST_SetSRID(ST_MakePoint(75.865,26.961),4326)::geography,$3,$3)`,
      [addressId, people.customer, createUuidV7(), suffix.slice(-12)],
    );
    const orderAt = new Date(from.getTime() + 10 * SECOND);
    const cart = await carts.currentCart({ context: shopper, now: orderAt });
    await carts.setCartAddress({ context: shopper, customer_address_id: addressId, now: orderAt });
    await carts.addLine({
      context: shopper,
      vendor_location_id: store.locationId,
      catalogue_variant_id: product.catalogue_variant_id as UuidV7,
      quantity: 1,
      now: orderAt,
    });
    const quote = await checkout.createQuote({
      context: shopper,
      cart_id: cart.cart_id,
      now: orderAt,
    });
    const placed = await checkout.place({
      context: shopper,
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `cfg-${people.customer}`,
      now: orderAt,
    });
    const deadline = await pool.query<{ accept_by: Date }>(
      'SELECT accept_by FROM marketplace.vendor_orders WHERE checkout_group_id = $1',
      [placed.checkout_group_id],
    );
    check(
      deadline.rows[0]?.accept_by.getTime() === orderAt.getTime() + 300 * SECOND,
      `An order placed while the change was in force did not get its deadline (${JSON.stringify(deadline.rows)})`,
    );

    // 6. A protected change needs an hour's notice.
    const protectedDraft = await publication.draft({
      context: operator,
      configuration_key: 'finance.correction_approval',
      scope_kind: 'GLOBAL',
      scope_reference: 'global',
      configuration_value: { single_approval_limit_minor: 50_000 },
      reason_code: 'SMALL_CORRECTIONS_BY_ONE',
      now: later(6 * MINUTE),
    });
    const protectedPreview = await publication.preview({
      context: approver,
      configuration_version_id: protectedDraft.configuration_version_id,
      now: later(6 * MINUTE),
    });
    check(
      protectedPreview.protected &&
        protectedPreview.examples.some(
          (example) =>
            example.before === 'needs a second person' && example.after === 'one person may post',
        ),
      `The protected change's examples do not show what it lets one person do (${JSON.stringify(protectedPreview.examples)})`,
    );
    await publication.validate({
      context: adminContext(people.colleague),
      configuration_version_id: protectedDraft.configuration_version_id,
      reason_code: 'EXAMPLES_CHECKED',
      now: later(6 * MINUTE),
    });
    await publication.approve({
      context: approver,
      configuration_version_id: protectedDraft.configuration_version_id,
      reason_code: 'EXAMPLES_REVIEWED',
      now: later(6 * MINUTE),
    });
    await rejects(
      () =>
        publication.schedule({
          context: operator,
          configuration_version_id: protectedDraft.configuration_version_id,
          effective_from: later(10 * MINUTE),
          reason_code: 'SOON',
          now: later(6 * MINUTE),
        }),
      ConfigurationPublicationInputError,
      'A protected change was scheduled without an hour of notice',
    );
    await publication.schedule({
      context: operator,
      configuration_version_id: protectedDraft.configuration_version_id,
      effective_from: later(6 * MINUTE + HOUR + MINUTE),
      reason_code: 'ANNOUNCED',
      now: later(6 * MINUTE),
    });
    // Called off, so it never reaches the walks after this one.
    await publication.cancel({
      context: operator,
      configuration_version_id: protectedDraft.configuration_version_id,
      reason_code: 'NOT_THIS_QUARTER',
      now: later(7 * MINUTE),
    });

    // 7a. Someone who proposed a change and has since become an approver
    // still may not approve it.
    const moved = await publication.draft({
      context: adminContext(people.mover),
      configuration_key: 'customer.cart_group_limit',
      scope_kind: 'GLOBAL',
      scope_reference: 'global',
      configuration_value: groupLimitInForce === 4 ? 5 : 4,
      reason_code: 'LARGER_BASKETS',
      now,
    });
    await publication.validate({
      context: adminContext(people.colleague),
      configuration_version_id: moved.configuration_version_id,
      reason_code: 'EXAMPLES_CHECKED',
      now,
    });
    await rejects(
      () =>
        publication.approve({
          context: adminContext(people.mover),
          configuration_version_id: moved.configuration_version_id,
          reason_code: 'SELF_APPROVED',
          now: later(3 * MINUTE),
        }),
      ConfigurationPublicationStateError,
      'Someone approved a change they had proposed before becoming an approver',
    );
    await publication.reject({
      context: approver,
      configuration_version_id: moved.configuration_version_id,
      reason_code: 'SELF_APPROVAL_ATTEMPTED',
      now: later(3 * MINUTE),
    });

    // 7. A proposal is rejected by an approver, not by its proposer.
    const doubtful = await publication.draft({
      context: operator,
      configuration_key: 'customer.saved_address_limit',
      scope_kind: 'GLOBAL',
      scope_reference: 'global',
      configuration_value: 20,
      reason_code: 'MORE_ADDRESSES',
      now: later(8 * MINUTE),
    });
    await rejects(
      () =>
        publication.reject({
          context: operator,
          configuration_version_id: doubtful.configuration_version_id,
          reason_code: 'NOT_NEEDED',
          now: later(8 * MINUTE),
        }),
      ConfigurationPublicationAuthorizationError,
      'An operator rejected a proposal',
    );
    const rejected = await publication.reject({
      context: approver,
      configuration_version_id: doubtful.configuration_version_id,
      reason_code: 'NOT_NEEDED',
      now: later(8 * MINUTE),
    });
    check(rejected.status === 'REJECTED', 'The proposal was not rejected');

    // 8. Rollback: not to the version in force; an earlier one comes back as a new version.
    await rejects(
      () =>
        publication.rollback({
          context: operator,
          target_version_id: second.configuration_version_id,
          reason_code: 'UNDO',
          now: new Date(from.getTime() + 20 * SECOND),
        }),
      ConfigurationPublicationStateError,
      'The version in force was rolled back to itself',
    );
    const restored = await publication.rollback({
      context: operator,
      target_version_id: second.configuration_version_id,
      reason_code: 'BRING_BACK_TRIAL',
      now: new Date(until.getTime() + MINUTE),
    });
    const restoredDetail = await publication.detail({
      context: approver,
      configuration_version_id: restored.configuration_version_id,
      now: new Date(until.getTime() + MINUTE),
    });
    check(
      restoredDetail.status === 'DRAFT' &&
        restoredDetail.rollback_of_version_id === second.configuration_version_id &&
        restoredDetail.configuration_value === 300 &&
        restoredDetail.version_number >
          (
            await publication.detail({
              context: approver,
              configuration_version_id: second.configuration_version_id,
            })
          ).version_number,
      `The rollback was not a new version of the earlier value (${JSON.stringify(restoredDetail)})`,
    );
    // Rejected so nothing of this walk stays pending.
    await publication.reject({
      context: approver,
      configuration_version_id: restored.configuration_version_id,
      reason_code: 'TRIAL_OVER',
      now: new Date(until.getTime() + MINUTE),
    });

    // 9. The schema keeps a closed version closed.
    let reopened = false;
    try {
      await pool.query(
        `UPDATE marketplace.configuration_versions SET status = 'DRAFT', closed_by = NULL,
                closed_at = NULL, closing_reason_code = NULL
          WHERE configuration_version_id = $1`,
        [doubtful.configuration_version_id],
      );
    } catch (error) {
      reopened = (error as { code?: string }).code === '23514';
    }
    let rewritten = false;
    try {
      await pool.query(
        `UPDATE marketplace.configuration_versions SET validation_report = '{}'::jsonb
          WHERE configuration_version_id = $1`,
        [second.configuration_version_id],
      );
    } catch (error) {
      rewritten = (error as { code?: string }).code === '55000';
    }
    check(reopened && rewritten, 'A closed version reopened, or a validation report was rewritten');
  } finally {
    await Promise.all([
      pool.end(),
      publication.close(),
      checkout.close(),
      carts.close(),
      catalogueProducts.close(),
    ]);
  }
}
