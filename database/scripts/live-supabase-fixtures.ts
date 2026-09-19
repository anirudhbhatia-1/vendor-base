import {
  acceptOffer,
  adminSignIn,
  apiCall,
  array,
  enrolCustomer,
  integer,
  log,
  object,
  partnerSignIn,
  placeOrder,
  provisionPartner,
  provisionVendor,
  publishStockedProduct,
  runWalk,
  setPartnerAvailability,
  startRun,
  text,
  uuidV7,
  vendorOrder,
  vendorSignIn,
  vendorStep,
  type AcceptanceRun,
  type JsonObject,
  type PlacedOrder,
} from './acceptance-support.js';

/**
 * The data the Playwright journeys need, left in place instead of consumed.
 *
 * `e2e/README.md` lists what each journey asserts against. This walk provides
 * all of it from one store, one rider and one customer:
 *
 * - a rider holding an order that is on its way (EN_ROUTE_TO_CUSTOMER), who
 *   is then taken offline so the partner journey's "Go online" is a real
 *   transition and its "I cannot deliver this" control has a job to act on;
 * - a second order left PLACED for the vendor journey to accept, pick, ready
 *   and hand over -- its accept deadline is short, so this runs right before
 *   the journeys, not once;
 * - a PENDING moderation case on the store's product for the admin queue, in
 *   the one state that does not hide the product from customers;
 * - the store itself, published and stocked, for the customer loop.
 *
 * The last line on stdout is a JSON object whose `environment` is the
 * `ACCEPTANCE_*` block the journeys read. Progress goes to stderr.
 */
/** Accept, pick every line as found, and mark ready: the order the rider can be offered. */
async function prepareOrder(
  vendorToken: string,
  vendorLocationId: string,
  order: PlacedOrder,
): Promise<void> {
  await vendorStep(vendorToken, vendorLocationId, order.vendorOrderId, 'accept', {
    preparation_estimate_seconds: 600,
  });
  await vendorStep(vendorToken, vendorLocationId, order.vendorOrderId, 'start-picking', {});
  const picks = object(
    await apiCall(
      vendorToken,
      'GET',
      `/vendor/locations/${vendorLocationId}/orders/${order.vendorOrderId}/picks`,
    ),
    'Pick list',
  );
  for (const entry of array(picks, 'picks')) {
    const pick = object(entry, 'Pick');
    await apiCall(
      vendorToken,
      'POST',
      `/vendor/locations/${vendorLocationId}/orders/${order.vendorOrderId}/lines/${text(pick, 'vendor_order_line_id')}/found`,
      {
        actual_quantity: integer(pick, 'ordered_quantity'),
        actual_unit_price_minor: integer(pick, 'ordered_unit_price_minor'),
      },
    );
  }
  const ready = await vendorStep(vendorToken, vendorLocationId, order.vendorOrderId, 'ready', {
    package_count: 1,
  });
  if (ready.lifecycle_state !== 'READY')
    throw new Error(`Order was ${ready.lifecycle_state} after ready`);
}

async function partnerStep(
  partnerToken: string,
  run: AcceptanceRun,
  assignmentId: string,
  version: number,
  action: string,
  body: JsonObject = {},
): Promise<{ readonly state: string; readonly version: number }> {
  const result = object(
    await apiCall(
      partnerToken,
      'POST',
      `/partner/assignments/${assignmentId}/${action}`,
      {
        command_reference: `SYNTH-CMD-${action}-${run.runId}-${version}`.toUpperCase(),
        expected_version: version,
        reason_code: 'PARTNER_CONFIRMED',
        ...body,
      },
      { 'idempotency-key': uuidV7() },
    ),
    `Partner ${action}`,
  );
  return { state: text(result, 'assignment_state'), version: integer(result, 'version') };
}

/**
 * The handover as it happens at the counter: the rider arrives, asks the API
 * for the pickup code, the shop enters it, and only then can the rider record
 * the pickup and set off.
 */
async function takeCustody(
  partnerToken: string,
  vendorToken: string,
  run: AcceptanceRun,
  vendorLocationId: string,
  order: PlacedOrder,
): Promise<string> {
  const accepted = await acceptOffer(partnerToken, run, order);
  const arrived = await partnerStep(
    partnerToken,
    run,
    accepted.assignmentId,
    accepted.version,
    'arrive-vendor',
  );
  const otp = object(
    await apiCall(partnerToken, 'POST', `/partner/assignments/${accepted.assignmentId}/pickup-otp`),
    'Partner pickup OTP',
  );
  const handedOver = await vendorStep(
    vendorToken,
    vendorLocationId,
    order.vendorOrderId,
    'complete-pickup',
    { otp: text(otp, 'plaintext_otp') },
  );
  if (handedOver.lifecycle_state !== 'PICKED_UP')
    throw new Error(`Order was ${handedOver.lifecycle_state} after handover`);
  const pickedUp = await partnerStep(
    partnerToken,
    run,
    accepted.assignmentId,
    arrived.version,
    'pickup',
    {
      package_count: 1,
      proof_reference: `SYNTH-PROOF-PICKUP-${run.runId.toUpperCase()}`,
      vendor_confirmed: true,
    },
  );
  const enRoute = await partnerStep(
    partnerToken,
    run,
    accepted.assignmentId,
    pickedUp.version,
    'begin-route',
  );
  if (enRoute.state !== 'EN_ROUTE_TO_CUSTOMER')
    throw new Error(`Assignment was ${enRoute.state} after begin-route`);
  return accepted.assignmentId;
}

async function openModerationCase(
  adminToken: string,
  vendorToken: string,
  vendorLocationId: string,
  productReference: string,
): Promise<string> {
  const inventory = object(
    await apiCall(vendorToken, 'GET', `/vendor/locations/${vendorLocationId}/inventory`),
    'Inventory',
  );
  const item = array(inventory, 'items')
    .map((entry) => object(entry, 'Inventory item'))
    .find((entry) => entry['product_reference'] === productReference);
  if (!item) throw new Error('Published product has no inventory item');
  const moderation = object(
    await apiCall(adminToken, 'POST', '/admin/catalogue/moderation', {
      inventory_item_id: text(item, 'inventory_item_id'),
      reason_code: 'ACCEPTANCE_REVIEW',
    }),
    'Moderation case',
  );
  return text(moderation, 'moderation_case_id');
}

async function main(): Promise<void> {
  const run = startRun();
  console.error(`live acceptance fixtures: ${run.runId}`);

  log('Admin signs in and provisions a store and a rider');
  const adminToken = await adminSignIn();
  const vendorLocationId = await provisionVendor(adminToken, run, [
    'CUSTOMER_PICKUP',
    'PLATFORM_DELIVERY',
  ]);
  const partnerUserId = await provisionPartner(adminToken, run);

  log('Vendor publishes a stocked product');
  const vendorToken = await vendorSignIn(run, vendorLocationId);
  const product = await publishStockedProduct(vendorToken, run, vendorLocationId);

  log('Partner goes online near the store');
  const partnerToken = await partnerSignIn(run, partnerUserId);
  await setPartnerAvailability(partnerToken, run, 'ONLINE');

  log('Customer signs in and can see the store');
  const customer = await enrolCustomer(run, vendorLocationId, product.variantId);

  log('Customer places the order the rider will carry; the store prepares it');
  const carried = await placeOrder(
    customer,
    vendorLocationId,
    product.variantId,
    `fixture-carried-${run.runId}`,
  );
  await prepareOrder(vendorToken, vendorLocationId, carried);

  log('Rider is offered the order, collects it at the counter and sets off');
  const assignmentId = await takeCustody(partnerToken, vendorToken, run, vendorLocationId, carried);

  log('Rider goes offline so the partner journey can go online itself');
  await setPartnerAvailability(partnerToken, run, 'OFFLINE');

  log('Customer places the order the vendor journey will accept');
  const awaiting = await placeOrder(
    customer,
    vendorLocationId,
    product.variantId,
    `fixture-awaiting-${run.runId}`,
  );
  const placed = await vendorOrder(vendorToken, vendorLocationId, awaiting.vendorOrderId);
  if (placed.lifecycle_state !== 'PLACED')
    throw new Error(`Awaiting order was ${placed.lifecycle_state}, not PLACED`);

  log('Admin opens a moderation case on the product');
  const moderationCaseId = await openModerationCase(
    adminToken,
    vendorToken,
    vendorLocationId,
    product.productReference,
  );

  console.log(
    JSON.stringify({
      run_id: run.runId,
      vendor_location_id: vendorLocationId,
      partner_user_id: partnerUserId,
      carried_order_reference: carried.orderReference,
      delivery_assignment_id: assignmentId,
      awaiting_order_reference: awaiting.orderReference,
      moderation_case_id: moderationCaseId,
      environment: {
        ACCEPTANCE_VENDOR_EMAIL: run.vendorEmail,
        ACCEPTANCE_VENDOR_PASSWORD: run.temporaryPassword,
        ACCEPTANCE_PARTNER_EMAIL: run.partnerEmail,
        ACCEPTANCE_PARTNER_PASSWORD: run.temporaryPassword,
        ACCEPTANCE_VENDOR_LOCATION_ID: vendorLocationId,
      },
    }),
  );
}

// Two orders, one offer poll of up to a minute, and eight sign-ins: longer than the single walk.
runWalk('Live Supabase fixtures', main, 240_000);
