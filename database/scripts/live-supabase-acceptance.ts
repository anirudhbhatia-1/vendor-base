import {
  acceptOffer,
  adminSignIn,
  enrolCustomer,
  log,
  partnerSignIn,
  placeOrder,
  provisionPartner,
  provisionVendor,
  publishStockedProduct,
  runWalk,
  setPartnerAvailability,
  startRun,
  vendorSignIn,
  vendorStep,
  withDatabase,
} from './acceptance-support.js';

/**
 * One order, end to end, against a live synthetic Supabase project: admin
 * provisions, vendor publishes, partner goes online, customer buys, the worker
 * offers, the partner accepts, and every retry-safe record exists exactly once.
 */
async function main(): Promise<void> {
  const run = startRun();
  console.error(`live acceptance run: ${run.runId}`);
  log('Admin signs in with Supabase email/password');
  const adminToken = await adminSignIn();

  log('Admin provisions a vendor with a replay-safe command');
  const vendorLocationId = await provisionVendor(adminToken, run, [
    'CUSTOMER_PICKUP',
    'PLATFORM_DELIVERY',
  ]);

  log('Admin provisions a delivery partner');
  const partnerUserId = await provisionPartner(adminToken, run);

  log('Vendor signs in, resolves its own location, and publishes a stocked product');
  const vendorToken = await vendorSignIn(run, vendorLocationId);
  const { variantId } = await publishStockedProduct(vendorToken, run, vendorLocationId);

  log('Partner signs in and goes online near the vendor');
  const partnerToken = await partnerSignIn(run, partnerUserId);
  await setPartnerAvailability(partnerToken, run, 'ONLINE');

  log('Customer signs in with OTP and discovers the published product');
  const customer = await enrolCustomer(run, vendorLocationId, variantId);

  log('Customer adds the product and completes grouped checkout');
  const order = await placeOrder(customer, vendorLocationId, variantId, `accept-${run.runId}`);

  log('Vendor accepts: a rider is never offered an order the shop may still decline');
  const accepted = await vendorStep(vendorToken, vendorLocationId, order.vendorOrderId, 'accept', {
    preparation_estimate_seconds: 600,
  });
  if (accepted.lifecycle_state !== 'ACCEPTED')
    throw new Error(`Order was ${accepted.lifecycle_state} after acceptance`);

  log('Worker creates a distinct offer and the partner accepts it');
  const { assignmentId } = await acceptOffer(partnerToken, run, order);

  log('Acceptance invariants are present once under retry-safe processing');
  const invariant = await withDatabase((client) =>
    client.query<{
      assignment_count: string;
      inbox_count: string;
      order_count: string;
      placed_event_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM marketplace.vendor_orders WHERE vendor_order_id = $1)::text AS order_count,
         (SELECT count(*) FROM marketplace.delivery_assignments WHERE source_order_reference = $2)::text AS assignment_count,
         (SELECT count(*) FROM marketplace.outbox_events WHERE aggregate_id = $1 AND event_type = 'order.placed')::text AS placed_event_count,
         (SELECT count(*) FROM marketplace.inbox_receipts inbox
            JOIN marketplace.outbox_events event ON event.event_id = inbox.event_id
           WHERE event.aggregate_id = $1 AND event.event_type = 'order.placed'
             AND inbox.consumer_scope = 'worker.domain_event')::text AS inbox_count`,
      [order.vendorOrderId, order.orderReference],
    ),
  );
  const counts = invariant.rows[0];
  if (!counts || Object.values(counts).some((value) => value !== '1')) {
    throw new Error(`Acceptance invariants failed: ${JSON.stringify(counts)}`);
  }

  console.log(
    JSON.stringify(
      {
        run_id: run.runId,
        vendor_email: run.vendorEmail,
        vendor_location_id: vendorLocationId,
        partner_email: run.partnerEmail,
        partner_user_id: partnerUserId,
        order_reference: order.orderReference,
        delivery_assignment_id: assignmentId,
        result: 'PASSED',
      },
      null,
      2,
    ),
  );
}

runWalk('Live Supabase acceptance', main);
