import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { onlineTimeSentence } from './profile-panel.js';
import { earningsToCsv } from './earnings-panel.js';
import { offerDeadlineSentence, waitPolicySentence } from './display.js';

const directory = path.resolve(import.meta.dirname);

function panel(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

test('field exceptions use the kinds the schema allows', () => {
  const source = panel('field-ops-panel.tsx');
  for (const kind of ['UNREACHABLE_CUSTOMER', 'WRONG_ADDRESS', 'UNSAFE_LOCATION']) {
    assert.ok(source.includes(kind), `exception kind ${kind}`);
  }
  // The schema names this UNREACHABLE_CUSTOMER; the other order is rejected on
  // write, so the partner's report would vanish into a 400 in the field.
  assert.ok(!source.includes('CUSTOMER_UNREACHABLE'));
});

test('emergencies are always reachable and separated from routine reports', () => {
  const source = panel('field-ops-panel.tsx');
  for (const kind of ['ACCIDENT', 'MEDICAL_EMERGENCY', 'THREAT']) {
    assert.ok(source.includes(kind), `emergency ${kind}`);
  }
  // Emergencies moved out of a permanent three-button row into a dedicated
  // control and sheet, so they stay reachable without competing with routine
  // reports for the same glance (DLP-43).
  assert.ok(source.includes('field-ops__sos'), 'the emergency control is always present');
  assert.ok(source.includes('EMERGENCIES'), 'emergencies are a separate set');
});

test('offline proof sends a digest, never the proof itself (9.7)', () => {
  // The held completion lives in the workspace now (audit run 62): sealed on
  // the device, registered by digest, replayed under its own command.
  const source = panel('partner-workspace.tsx');
  assert.ok(source.includes('encrypted_payload_digest: digest'));
  assert.ok(source.includes('encryption_key_reference'));
  assert.ok(
    !/encrypted_payload_digest: .*otp/.test(source),
    'the code is never what is registered',
  );
});

test('withdrawing location sharing also goes offline', () => {
  // The control lives with the privacy disclosure on the profile rather than
  // on every job card, but it must still exist and still take the partner
  // offline: dispatch cannot offer work to someone whose position is unknown,
  // and a silent downgrade would read as a bug (DLP-45).
  const source = panel('profile-panel.tsx');
  assert.ok(source.includes('LOCATION_SHARING_WITHDRAWN'));
  assert.ok(source.includes("state: 'OFFLINE'"));
});

test('the application captures references instead of inventing them', () => {
  const source = panel('application-panel.tsx');
  assert.ok(!source.includes('`BANK-${ts}`'), 'bank reference is supplied by the applicant');
  assert.ok(!source.includes('`IDENTITY-${ts}`'), 'identity reference is supplied');
  assert.ok(source.includes('identityReference.trim()'));
  assert.ok(source.includes('bankReference.trim()'));
});

test('earnings download as CSV with every component of the line (9.10)', () => {
  const csv = earningsToCsv({
    pending_minor: 0,
    paid_minor: 12500,
    total_earned_minor: 12500,
    earnings: [
      {
        partner_earnings_record_id: 'r-1',
        reference: 'TRIP-1',
        outcome: 'DELIVERED',
        lifecycle_state: 'PAID',
        total_minor: 12500,
        base_minor: 2000,
        distance_minor: 9000,
        time_minor: 0,
        wait_minor: 200,
        return_minor: 0,
        incentive_minor: 0,
        tip_minor: 800,
        adjustment_minor: 500,
        posted_at: '2026-08-30T00:00:00.000Z',
        day: '2026-08-30',
      },
    ],
  });
  assert.equal(
    csv.split('\n')[1],
    'TRIP-1,DELIVERED,PAID,2026-08-30T00:00:00.000Z,2026-08-30,20.00,90.00,0.00,2.00,0.00,0.00,8.00,5.00,125.00',
  );
});

test('a dispute reads with what was said, who has it, when it is due and how it ended (9.10)', async () => {
  const { disputeSentence, LINE_COMPONENTS } = await import('./earnings-panel.js');
  const now = Date.parse('2026-09-21T10:00:00.000Z');
  const base = {
    partner_dispute_case_id: 'd1',
    partner_earnings_record_id: 'r1',
    disputed_component: 'WAIT',
    disputed_amount_minor: 200,
    proposed_amount_minor: 400,
    evidence_note: 'waited longer',
    resolver_user_id: null,
    resolution_reason_code: null,
    resolved_amount_minor: null,
    deadline_at: '2026-09-28T10:00:00.000Z',
    resolved_at: null,
  } as const;
  assert.equal(
    disputeSentence({ ...base, lifecycle_state: 'OPEN' }, now),
    'wait: recorded ₹2.00, you say ₹4.00 — with operations, answer due in 7 days.',
  );
  assert.equal(
    disputeSentence(
      {
        ...base,
        lifecycle_state: 'RESOLVED',
        resolved_amount_minor: 300,
        resolution_reason_code: 'WAIT_PARTLY_UPHELD',
        resolver_user_id: 'a1',
        resolved_at: '2026-09-22T10:00:00.000Z',
      },
      now,
    ),
    'wait: recorded ₹2.00, you say ₹4.00 — operations decided ₹3.00 (wait partly upheld).',
  );
  assert.equal(
    disputeSentence({ ...base, lifecycle_state: 'WITHDRAWN' }, now),
    'wait: recorded ₹2.00, you say ₹4.00 — withdrawn.',
  );
  // Every component the server knows, and no 'TOTAL' the server refuses.
  assert.deepEqual(
    LINE_COMPONENTS.map(([, , key]) => key),
    ['BASE', 'DISTANCE', 'TIME', 'WAIT', 'RETURN', 'INCENTIVE', 'TIP', 'ADJUSTMENT'],
  );
  assert.ok(!panel('earnings-panel.tsx').includes("'TOTAL'"), 'no unknown component is sent');
});

test('the profile reads verification and history from the server', () => {
  const source = panel('profile-panel.tsx');
  assert.ok(source.includes('partner/assignments'), 'assignment history');
  assert.ok(
    source.includes('partner/standing/application'),
    'verification state is resolved from the session',
  );
  // The old screen asserted a verification badge and a day count from nothing;
  // every claim here now has a server response behind it.
  assert.ok(source.includes('lifecycle_state'), 'state comes from the application');
  assert.ok(source.includes('warning_codes'), 'expiry warnings are surfaced');
});

/**
 * The file with its comments removed, so a negative assertion is not defeated
 * by the comment that explains it.
 */
function code(file: string): string {
  return fs
    .readFileSync(path.join(directory, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('a delivery completes only against the customer’s code', () => {
  const source = code('partner-workspace.tsx');
  // The old flow sent a `proof_reference` the app built from the clock, so a
  // delivery could be recorded without the partner ever reaching the customer.
  assert.ok(source.includes('Customer’s delivery code'), 'the partner is asked for the code');
  assert.ok(/otp,/.test(source), 'the code is sent with the completion');
  assert.ok(
    /disabled=\{!\/\^\\d\{6\}\$\/\.test\(otp\)\}/.test(source),
    'completion is blocked until six digits are entered',
  );
});

test('an offer states what it pays and how far it is, before acceptance', () => {
  const source = code('partner-workspace.tsx');
  assert.ok(source.includes('expected_earning_minor'), 'the expected earning is shown (DLP-48)');
  assert.ok(source.includes('route_metres'), 'the distance is shown (DLP-11)');
  assert.ok(source.includes('to decide'), 'the decision deadline is shown');
});

test('declining an offer is offered, and not worded as misconduct', () => {
  const source = code('partner-workspace.tsx');
  assert.ok(
    source.includes('offers/${offer.delivery_assignment_id}/decline'),
    'decline is reachable',
  );
  assert.ok(!/penalt/i.test(source), 'declining is not framed as a penalty (DLP-12)');
});

test('the active job is reachable from anywhere in the app', () => {
  const source = code('partner-workspace.tsx');
  // DLP-20: a partner who navigates away must be able to get back to the
  // server-confirmed current step in one tap.
  assert.ok(source.includes('ActionDock'), 'a persistent control exists');
  assert.ok(source.includes('Resume'), 'it returns to the active job');
});

test('field operations present one decision at a time', () => {
  const source = code('field-ops-panel.tsx');
  // Twenty buttons were on screen permanently — every exception kind, every
  // resolution and every proof action — so the one that mattered was
  // indistinguishable from the nineteen that did not (§8.2).
  assert.ok(source.includes('Something is wrong'), 'reporting is behind one control');
  assert.ok(source.includes('Sheet'), 'the choices open in a sheet');
  assert.ok(source.includes('field-ops__sos'), 'the emergency stays reachable (DLP-43)');
});

test('only the resolutions a partner may send are offered', () => {
  const source = code('field-ops-panel.tsx');
  assert.ok(source.includes('SELF_RESOLUTIONS'), 'the permitted set is explicit');
  for (const directed of ['RETURN_TO_VENDOR', 'CANCEL', 'REASSIGN']) {
    assert.ok(!source.includes(`'${directed}'`), `${directed} is not offered to the partner`);
  }
});

test('an exception resolution sends the fields the endpoint requires', () => {
  const source = code('field-ops-panel.tsx');
  // The old call sent `resolution` and no `exception_kind`, so every attempt
  // was rejected as a bad request before it reached the service.
  assert.ok(source.includes('exception_kind: entry.exception_kind'), 'the kind is sent');
  assert.ok(source.includes('resolution_state: state'), 'the field is named as the API names it');
});

test('a held completion survives the app closing and replays under its own command (9.7)', () => {
  const source = code('partner-workspace.tsx');
  assert.ok(
    source.includes("if (action === 'deliver' && isNetworkFailure(cause)) {"),
    'only a delivery the server never heard of is held',
  );
  assert.ok(
    source.includes('command_reference: completion.command_reference') &&
      source.includes('held_since: completion.captured_at') &&
      source.includes('offline_proof_id: proofId'),
    'the replay carries the same command, when it was captured and the proof it consumes',
  );
  assert.ok(
    source.includes('void syncHeld();') &&
      source.includes("window.addEventListener('online', online);"),
    'reconnecting replays what is held',
  );
  assert.ok(
    source.includes('forgetHeld(window.localStorage, record.assignment_id);'),
    'a confirmed or escalated completion is removed from the device',
  );
  assert.ok(
    source.includes("exception_kind: 'PROOF_SYNC_FAILED'"),
    'a refused replay is one tap from support',
  );
  assert.ok(
    !/setMessage\([^)]*[Dd]elivered[^)]*\)/.test(
      source.split('async function holdDelivery')[1]?.split('async function devicePosition')[0] ??
        '',
    ),
    'holding never says delivered',
  );
});

// DLP-14 proof eligibility is exercised by proof-queue-policy.spec.ts, including
// denied, malformed, offline and stale reads rather than a source-text assertion.

test('the vendor wait timer is reachable, with its pay and its leave threshold', () => {
  const source = code('field-ops-panel.tsx');
  // DLP-23 and DLP-36 were marked complete while no client called the routes.
  assert.ok(source.includes('/wait/start'), 'waiting can be started');
  assert.ok(source.includes('/wait/leave'), 'leaving is offered at the threshold');
  assert.ok(source.includes('waitCredit'), 'accrued waiting pay is shown');
});

test('the destination is written out, and the map is only a handoff', () => {
  const source = code('partner-workspace.tsx');
  assert.ok(source.includes('nav-handoff'), 'a written destination block exists');
  assert.ok(source.includes('geo:'), 'the map is an external handoff (DLP-21)');
  assert.ok(source.includes('Heading for'), 'the text is the primary account (DLP-46, UX-12)');
});

test('packages are counted and agreed before custody starts (DLP-25)', () => {
  const source = code('partner-workspace.tsx');
  assert.ok(source.includes('packagesChecked'), 'the partner confirms the check');
  assert.ok(
    source.includes('package_count: Math.max(1, Number(packageCount)'),
    'the confirmed count is what is sent, not the order’s assumption',
  );
});

test('a partner can see what restricts them and how to challenge it', () => {
  const source = code('profile-panel.tsx');
  // DLP-47, DLP-56 and SEC-14: the reason, the review date and the appeal
  // route are owed to the person restricted, not only to the admin console.
  assert.ok(source.includes('partner/standing/restrictions'), 'restrictions are read');
  assert.ok(source.includes('appealable'), 'the appeal route is conditional and shown');
  assert.ok(source.includes('review_at'), 'the review date is shown');
});

test('verification state loads from the session, not from a typed identifier', () => {
  const source = code('profile-panel.tsx');
  // `applicant_user_id` is UNIQUE, so the session already identifies the
  // application — yet the screen asked the partner to type its UUID.
  assert.ok(source.includes('partner/standing/application'), 'the session resolves it');
  assert.ok(!source.includes('setApplicationId'), 'no identifier entry box remains');
});

test('the address appears only when the partner is holding the goods', () => {
  const source = panel('partner-workspace.tsx');
  // The screen never decides this for itself: it renders whatever the API
  // chose to send, and the API sends nothing before custody or after handover.
  assert.ok(source.includes('assignment.drop_address ?? null'), 'the address comes from the API');
  assert.ok(
    !source.includes('customer_address_id'),
    'the partner surface never asks for an address by id',
  );
});

test('navigation prefers coordinates over an area name', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(
    source.includes('geo:${dropAddress.latitude},${dropAddress.longitude}'),
    'a delivery leg navigates to the actual point',
  );
});

test('a safety report holds the job instead of asking the partner to carry on', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(
    source.includes('assignment.open_emergency === true'),
    'the hold is decided by the server, not inferred on the client',
  );
  assert.ok(
    source.includes('const step = blocked\n    ? undefined\n    :'),
    'no next step is offered while a safety report is open',
  );
  assert.ok(
    source.includes('{atVendor && !blocked ?'),
    'nor is the package check that leads to picking the order up',
  );
});

test('an emergency is never offered the options a delivery hiccup gets', () => {
  const source = panel('field-ops-panel.tsx');
  // "I tried again and it worked" and "I am carrying on" are answers to a wrong
  // address. Offering them to somebody who has just crashed is the platform
  // pushing them back onto the road.
  assert.ok(source.includes('EMERGENCY_RESOLUTIONS'), 'emergencies have their own answers');
  assert.ok(
    !/EMERGENCY_RESOLUTIONS[^;]*RETRY/s.test(source),
    'there is nothing to retry about an accident',
  );
  assert.ok(
    source.includes("['CONTINUE', 'I am safe now']"),
    'carrying on is phrased as being safe, not as resuming the delivery',
  );
});

test('a wait that has ended stops counting', () => {
  const source = fs.readFileSync(
    // The arithmetic moved to the shared wait-timer module in audit run 60.
    path.join(directory, '..', '..', '..', 'database', 'src', 'wait-timer.ts'),
    'utf8',
  );
  assert.ok(
    source.includes('const until = row.ended_at ?? now;'),
    'a finished timer is measured to when it ended',
  );
});

test('waiting pay on screen is the arithmetic the server settles with', () => {
  const source = panel('field-ops-panel.tsx');
  assert.ok(
    source.includes('wait.elapsed_seconds - wait.first_threshold_seconds'),
    'the included period is not billed',
  );
  assert.ok(source.includes('wait.max_credit_seconds'), 'and the credit is capped');
});

test('a partner can see the rating that is kept about them', () => {
  const source = panel('profile-panel.tsx');
  assert.ok(source.includes("'partner/ratings'"), 'the rating is read');
  assert.ok(
    !source.includes('rating_list') && !source.includes('reviews'),
    'as an aggregate, never a list a single customer could be identified from',
  );
});

test('a rider whose phone will not share a position places themselves on the map, never at a hard-coded point', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(source.includes('<LocationPicker'), 'the map picker is offered');
  assert.ok(
    source.includes('setPositionNeeded(true)'),
    'going online without a position asks for one',
  );
  assert.ok(!/26\.8505|75\.7628/.test(source), 'no invented Jaipur point remains');
  assert.ok(
    source.includes('(await devicePosition()) ??') && source.includes('manualPosition'),
    'the device is tried first and the map point is the fallback',
  );
});

test('online time today is read from the history and said in hours and minutes (9.2)', () => {
  const source = panel('profile-panel.tsx');
  assert.ok(source.includes('online_seconds_today'), 'the profile shows time on shift');
  assert.ok(source.includes('active_zones'), 'the active zone is named');
  assert.equal(onlineTimeSentence(3_600 + 5 * 60), '1 h 5 min');
  assert.equal(onlineTimeSentence(45), '0 min');
  assert.equal(onlineTimeSentence(undefined), '0 min');
});

test('an offer states when to be at the store and the waiting terms (9.3)', () => {
  const now = Date.parse('2026-09-21T10:00:00.000Z');
  assert.equal(
    offerDeadlineSentence('2026-09-21T10:12:00.000Z', now),
    'Ready to collect in about 12 min',
  );
  assert.equal(offerDeadlineSentence('2026-09-21T09:50:00.000Z', now), 'Ready to collect now');
  assert.equal(offerDeadlineSentence(null, now), 'Ready time not yet known');
  assert.equal(
    waitPolicySentence({ included_seconds: 300, per_completed_minute_minor: 100, cap_minor: 1000 }),
    'first 5 min waiting included, then ₹1.00/min up to ₹10.00',
  );
});

test('the last server-confirmed job survives a reload and is labelled as such (9.4)', async () => {
  const { rememberAssignments, recallAssignments, forgetAssignments, staleSentence } =
    await import('./active-job-cache.js');
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const confirmedAt = Date.parse('2026-09-21T10:00:00.000Z');
  rememberAssignments(storage, [{ delivery_assignment_id: 'a1', version: 3 }], confirmedAt);
  assert.deepEqual(recallAssignments(storage), {
    assignments: [{ delivery_assignment_id: 'a1', version: 3 }],
    confirmed_at: confirmedAt,
  });
  assert.equal(
    staleSentence(confirmedAt, confirmedAt + 7 * 60_000),
    'Showing the job as the server last confirmed it, 7 minutes ago. Reconnect to take the next step.',
  );
  // A denied or broken store is never an error the partner sees.
  assert.equal(recallAssignments(null), null);
  store.set('partner.active-jobs.v1', '{not json');
  assert.equal(recallAssignments(storage), null);
  const throwing = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  rememberAssignments(throwing, [], 0);
  assert.equal(recallAssignments(throwing), null);
  forgetAssignments(storage);
  assert.equal(recallAssignments(storage), null);
});

test('the route to the store is written, not only mapped (9.4, DLP-46)', async () => {
  const { directionSentence } = await import('./active-job-cache.js');
  const store = { latitude: 26.91, longitude: 75.81 };
  assert.equal(directionSentence(null, store), null);
  assert.equal(
    directionSentence({ latitude: 26.9101, longitude: 75.81 }, store),
    'You are at the store',
  );
  // ~1.1 km due south of the store: the store is to the north.
  assert.equal(
    directionSentence({ latitude: 26.9, longitude: 75.81 }, store),
    'About 1.1 km to the north',
  );
  // ~300 m west of the store: the store is to the east.
  assert.equal(
    directionSentence({ latitude: 26.91, longitude: 75.807 }, store),
    'About 300 m to the east',
  );
});

test('the store is shown in words with its landmark, and the arrival waits for the counter when the phone cannot vouch for it (9.4)', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(
    source.includes('geo:${store.latitude},${store.longitude}'),
    'the way to the store navigates to its point once the job is assigned',
  );
  assert.ok(
    source.includes('Near {displayArea(store.landmark)}') &&
      source.includes('directionSentence(lastFix, store)'),
    'the landmark and a written direction stand beside the map',
  );
  assert.ok(
    source.includes("if (action === 'arrive-vendor' || action === 'arrive-customer') {") &&
      source.includes('const position = await devicePosition();'),
    'an arrival carries the phone’s fix',
  );
  assert.ok(
    source.includes("assignment.arrival_claim && assignment.assignment_state === 'ASSIGNED'"),
    'a claimed arrival offers a retry with location, not the next step',
  );
  assert.ok(
    source.includes('recallAssignments<Assignment>(') &&
      source.includes('staleSentence(staleSince, now)'),
    'the last server-confirmed job is shown, and said to be, when nothing fresher can be had',
  );
});

test('the store’s estimate is read to the waiting partner with its reason (9.5)', async () => {
  const { readyBySentence } = await import('./field-ops-panel.js');
  const now = Date.parse('2026-09-21T10:00:00.000Z');
  assert.equal(
    readyBySentence('2026-09-21T10:12:00.000Z', null, now),
    'The store says about 12 min more',
  );
  assert.equal(
    readyBySentence('2026-09-21T10:12:00.000Z', 'ITEM_BEING_SOURCED', now),
    'The store says about 12 min more — running late: item being sourced',
  );
  assert.equal(
    readyBySentence('2026-09-21T09:50:00.000Z', null, now),
    'The store says it should be ready now',
  );
});

test('the door is reached by fix and by message, never by number (9.6)', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(
    source.includes("if (action === 'arrive-vendor' || action === 'arrive-customer') {"),
    'the arrival at the customer carries the phone’s fix too',
  );
  assert.ok(
    source.includes("['AT_DOOR', 'Tell them I am at the door']") &&
      source.includes('nudge-customer'),
    'the partner reaches the customer through fixed platform messages',
  );
  assert.ok(
    !/tel:|phone_number|customer_phone/.test(source),
    'no phone number is rendered or dialled from the partner app',
  );
  assert.ok(
    source.includes("assignment.customer_arrival_kind === 'UNVERIFIED'"),
    'an unverified arrival is said, with the code as the proof of the door',
  );
});

test('the instruction that stands is operations’ latest word per kind (9.8)', async () => {
  const { standingInstructions } = await import('./field-ops-panel.js');
  const events = [
    {
      partner_exception_event_id: 'e1',
      exception_kind: 'UNREACHABLE_CUSTOMER' as const,
      resolution_state: 'OPEN',
      occurred_at: '2026-09-21T10:00:00.000Z',
      actor_kind: 'delivery_partner' as const,
    },
    {
      partner_exception_event_id: 'e2',
      exception_kind: 'UNREACHABLE_CUSTOMER' as const,
      resolution_state: 'RETRY',
      occurred_at: '2026-09-21T10:02:00.000Z',
      actor_kind: 'delivery_partner' as const,
    },
    {
      partner_exception_event_id: 'e3',
      exception_kind: 'UNREACHABLE_CUSTOMER' as const,
      resolution_state: 'RETURN_TO_VENDOR',
      occurred_at: '2026-09-21T10:05:00.000Z',
      actor_kind: 'admin' as const,
      instruction: 'Take it back; the customer collects tomorrow.',
    },
    {
      partner_exception_event_id: 'e4',
      exception_kind: 'VENDOR_DELAY' as const,
      resolution_state: 'CONTINUE',
      occurred_at: '2026-09-21T09:00:00.000Z',
      actor_kind: 'admin' as const,
    },
  ];
  assert.deepEqual(standingInstructions(events), [
    {
      kind: 'UNREACHABLE_CUSTOMER',
      direction: 'Take the order back to the store',
      instruction: 'Take it back; the customer collects tomorrow.',
      at: '2026-09-21T10:05:00.000Z',
    },
    {
      kind: 'VENDOR_DELAY',
      direction: 'Carry on as planned',
      instruction: null,
      at: '2026-09-21T09:00:00.000Z',
    },
  ]);
});

test('the return leg names its destination and closes on a receipt, not a button (9.9)', () => {
  const source = panel('partner-workspace.tsx');
  assert.ok(
    source.includes('(returning && assignment.return_destination?.is_store === true)'),
    'the store is the destination again on a return to it',
  );
  assert.ok(
    source.includes('assignment.return_destination.note ??') &&
      source.includes('Named by operations.'),
    'an alternate safe point is shown in operations’ words',
  );
  assert.ok(
    source.includes('received_by: receivedBy.trim()') &&
      source.includes('label="Who received it"') &&
      source.includes('package_count: Math.max(0, Math.round(Number(returnedCount) || 0))'),
    'the receipt is what completes the return',
  );
  const fieldOps = panel('field-ops-panel.tsx');
  assert.ok(
    fieldOps.includes("['RETURN_REFUSED', 'The store is closed or will not take it back']"),
    'a closed or refusing store is a report of its own',
  );
});
