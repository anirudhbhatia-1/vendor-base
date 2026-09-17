# Repair batch 07 — nine identical POSTs, and the error contract that caused them

**Reported:** a live partner session, 9 September 2026. Network log showed `POST 409` four times on `/partner/assignments/{id}/pickup` and five times on `/partner/assignments/{id}/wait/leave`, same assignment, same session.

**Verification level:** root cause traced from the log through client, filter, controller and domain layer; fixed and mutation-tested at the layer that caused it. Not reproduced in a browser — the diagnosis is from source and is exact.

## What the log was

A delivery partner tapping the same button over and over, because the application told them to.

The chain, end to end:

1. `assignment-custody.ts` refuses the pickup with a precise reason — *"Pickup requires arrival at the vendor"*, *"Verified vendor and package count are required"*, or *"The vendor has not completed handover for this order"*.
2. `assignment-custody.controller.ts` caught `AssignmentConflictError` and threw a **bare** `ConflictException()` — no code, no reason — while every neighbouring branch attached one.
3. `request-exception.filter.ts` built the response from `codeForStatus(status)` and **discarded the exception body entirely**. Every 409 in the system became `VERSION_CONFLICT`.
4. `packages/pwa-auth` renders `VERSION_CONFLICT` as **"Something changed while you were working. Refresh and try again."**
5. The partner refreshed and tried again. Four times on pickup, five on leave.

The instruction was wrong in the way that matters: a version conflict *is* fixed by refreshing. A state conflict is not — the vendor still has not handed the order over, and repeating the request will fail identically for as long as that is true.

## B07-01 — a defined error code that nothing could emit

`ORDER_STATE_CONFLICT` (409, `orders.state_conflict`) is declared in `ERROR_DEFINITIONS` and covered by its own unit test. Searching the repository, it appears **only in its definition and that test**. No controller could produce it, because `codeForStatus` maps every 409 to `VERSION_CONFLICT` and the filter never consulted the controller.

The taxonomy already drew the distinction the partner needed. The transport threw it away.

## B07-02 — the filter discarded every code a controller chose

This is the root cause, and it is wider than the reported journey. Controllers attach codes deliberately — `assignment-custody.controller.ts` carries the comment *"The partner needs to know which of these it is"* above its OTP branches — and none of them ever reached a client. `partner-wait-policy.controller.ts` passed `error.message` through, which was equally discarded, so *"Leave policy threshold has not been reached"* never reached the partner either.

**Fix.** The filter now honours a code the controller declared, under two conditions that keep the concealment property intact:

- it must be a real key of `ERROR_DEFINITIONS`, and
- its `http_status` must match the status actually being sent.

Nothing else from the exception body is used. No raw messages reach the response, so a controller cannot leak internal detail through this path and a concealed 404 stays concealed. An exception that declares nothing keeps the status-derived code exactly as before.

`AssignmentConflictError` and `PartnerWaitConflictError` now declare `ORDER_STATE_CONFLICT`, and the client renders it as *"That step is not available yet. Check the job for what still has to happen first."* — deliberately without "try again", because repeating a refusal that cannot change is what produced the log.

## What is fixed and what is not

Fixed: the partner is no longer told to retry something that cannot succeed, and state conflicts are distinguishable from version conflicts across the whole API.

**Not fixed, and worth being explicit:** the partner still cannot tell *which* state conflict they are in. All eight assignment conflicts and both wait conflicts share one code, so *"arrive at the vendor first"* and *"the vendor has not handed over"* — different actions for the person holding the phone — still read identically. Distinguishing them needs a code per situation, which is a larger change to `ERROR_DEFINITIONS` and its locale registry. The wait/leave case would also benefit from the remaining time rather than a bare refusal.

Also unfixed: `DELIVERY_OTP_EXPIRED` and `DELIVERY_OTP_EXHAUSTED` are declared by the controller but are not keys of `ERROR_DEFINITIONS`, so they fall back to the status-derived code. Those two branches are still indistinguishable from any other 409 despite the comment above them saying they must not be.

Finally, the client retried without refetching: `act()` in `partner-workspace.tsx` does not call `refresh()` on failure, so a repeat sends the same `expected_version`. That is correct to leave for a state conflict and wrong for a genuine version conflict; now that the two are distinguishable, the client can branch on it.

## B07-03 — the same defect on the vendor console

**Reported:** two `POST 409` on `/vendor/locations/{id}/settings/zones`, same location, same session.

Same chain, different route. `addServiceZone` has exactly one conflict — *"A service zone with this name already exists"*, raised by the `service_zone_name_unique` constraint. The controller passed `error.message`, the filter discarded it, and the vendor was told *"Something changed while you were working. Refresh and try again."* So they refreshed, retyped the same name, and hit the same wall. Two attempts, then they stopped.

**A uniqueness clash is not a conflict anyone can wait out — it is a value they can change.** No existing code said that: the 409 family held `VERSION_CONFLICT`, `ORDER_STATE_CONFLICT` and `IDEMPOTENCY_KEY_REUSED`, none of which fits.

- `RESOURCE_ALREADY_EXISTS` (409, `common.resource_already_exists`) added to `ERROR_DEFINITIONS`, with migration `0072` registering its locale key in English and Hindi. The Hindi is carried forward for native-speaker review with the rest of the error copy from 0064 and 0065. `verify-launch-readiness.ts` enforces that every stable code's key is registered, so this could not have been added without it.
- `VendorStaffConflictError` now carries its own code. One class was covering three unrelated situations — a disabled account, an owner who already owns the store, and a taken name — and all three arrived as the same bare 409.
- The client renders it as *"Something with that name already exists. Choose a different one."*, pointing at the value rather than at refreshing.

**Mutation-proven** at the domain layer: dropping the code at the throw site turns the ladder red with *"A duplicate zone name did not report itself as an existing resource (got ORDER_STATE_CONFLICT)"*. The assertion also checks the refused duplicate wrote no second row.

Two reports, two routes, one cause. The filter change in B07-02 is what makes any of these codes reachable; this batch is the second demonstration that they were not.

## B07-04 — the same defect blocking "Mark ready"

**Reported:** a vendor unable to complete an order. `POST .../orders/:id/ready` returned `409 VERSION_CONFLICT` five times between 10:51:50 and 10:52:49, across two full page reloads.

`markReady` refuses for three unrelated reasons, and until now all three — along with the other twenty-two conflicts in `vendor-fulfilment.ts` — arrived as one bare 409:

| Refusal | Is "refresh and try again" the right advice? |
|---|---|
| `Only an order in picking can be marked ready` | No |
| `Vendor order version has advanced` | **Yes** |
| `Unresolved lines cannot reach ready` | No |

Only the middle one is fixed by refreshing, and it was the one case the vendor almost certainly did **not** have: the card showed *Being packed*, so the order was in `PICKING`, and the session includes two full reloads between attempts, each of which would have taken a fresh version. The refusal survived them, which points at unresolved pick lines.

**Fix.** `FulfilmentConflictError` now carries a code, defaulting to `ORDER_STATE_CONFLICT` — correct for most of the twenty-five sites without editing each. The four version checks name `VERSION_CONFLICT` explicitly, because refreshing genuinely does fix those. The unresolved-lines refusal gets `PICKING_INCOMPLETE`, added to `ERROR_DEFINITIONS` with migration `0073` registering its locale key, and rendered as *"Finish the pick list first. Every item needs to be marked found or missing."*

**The existing test could not have caught this.** `verify-vendor-fulfilment.ts` already asserted that marking ready with unresolved lines is refused — but it checked only the error *class*, so it passed with any code attached, including the one that sends the vendor round the refresh loop. It now asserts the code, and separately that a genuinely stale `expected_version` still reports `VERSION_CONFLICT`, so the useful advice is not lost while removing the useless kind.

Mutation-proven: dropping the code at the throw site turns the ladder red with *"Unresolved lines did not report themselves as unfinished picking (got ORDER_STATE_CONFLICT)"*.

### Not the stock

The same session shows `PUT .../inventory/:id/stock` returning 409 twice. That is a separate path and is untouched here. Stock held by a placed order is reserved, and a vendor adjustment is expected to go through a ledger command rather than overwrite a reserved quantity — worth confirming against the inventory rules before assuming it is the same defect.

### Three reports, one cause

Partner pickup and wait, vendor zones, vendor ready. Every one was a controller that knew exactly what was wrong and a transport that replaced it with "refresh and try again". The remaining routes have not been swept.

## B07-05 — the sweep

All 28 remaining conflict sites now declare a stable code. `verify-error-contract.mjs` (wired into `pnpm test:controls`, with a `--self-test`) fails the build if any controller throws a conflict without one, or uses the `code:` key the filter does not read.

Classified from the domain layer rather than guessed, by reading what each error class actually refuses for:

| Group | Treatment |
|---|---|
| Classes whose refusals are all state conflicts — access, zones, control plane, catalogue import, addresses, cart, discovery, checkout, partner availability, field ops, publication, inventory, assignment custody | Declare `ORDER_STATE_CONFLICT` |
| `PreferenceVersionConflictError`, `VendorNetworkVersionConflictError` — every refusal is a stale version | Declare `VERSION_CONFLICT`, because refreshing genuinely does fix these |
| `CatalogueModerationConflictError`, `PartnerLifecycleConflictError`, `VendorOnboardingConflictError` — mixed | Carry a code, defaulting to state, with the stale-version sites naming `VERSION_CONFLICT` |
| `IdempotencyKeyReusedError` | `IDEMPOTENCY_KEY_REUSED`, which had been defined and unreachable, like `ORDER_STATE_CONFLICT` before it |

**Your inventory 409 is in there.** `InventoryConflictError` refuses with *"Exact stock cannot be reset while reservations are active"* — a placed order holds the units, so the count cannot be reset until it resolves. That is why the same session showed two failed stock updates alongside the Mark ready failures: one cause, two symptoms.

`VendorOnboardingConflictError` was the sharpest case: it already carried `readonly code = 'CONFLICT'`, which is not a stable code, so the filter ignored it and all thirteen refusals read as version conflicts. It looked coded and was not.

**Mutation-proven:** reverting one site to `ConflictException(error.message)` fails the control, naming the file and line.

### Still not distinguished

- **The three pickup-OTP outcomes** now share `ORDER_STATE_CONFLICT`. A wrong code is worth retrying and an expired one is not, and the comment above them says so. Separating them needs three codes and locale keys. *Closed in [batch 08](repair-batch-08-evidence.md), which also found that four codes declared at controllers were never registered and so were discarded.*
- **The eight assignment conflicts** likewise share one code.
- **`AdminOnboardingActiveObligationsError` loses its `obligation_codes`.** It listed exactly which obligations blocked the action; the filter discarded that before this change and still does, because only a code survives. Carrying structured detail safely is a larger contract decision than this sweep should make.
- **Only 409 was swept.** Whether 400, 404 and 422 have the same flattening is unexamined.

## B07-06 — the other statuses, checked

Asked whether 400, 404 and 422 flatten the same way. They differ, and one of them is not a defect at all.

### 404 — correct as it stands, 27 sites

Flattening here is deliberate and documented in the filter: a concealed 404 for someone probing another customer's resource must be indistinguishable from a dead link, and the logs are where the attempt is meant to be visible. Adding detail would undo a privacy control. **No change wanted.**

### 422 — the worst value lost, and only 8 sites

Two of them carry exactly the detail the user needs, and both are discarded:

- `InventoryUnavailableError` carries `available_quantity` — how many are actually left.
- `VendorPublicationIncompleteError` carries `missing_checks` — the list of what still blocks publication.

Neither `INVENTORY_UNAVAILABLE` nor `UNPROCESSABLE_ENTITY` is a key of `ERROR_DEFINITIONS`, so both fall back to `BUSINESS_RULE_VIOLATION` and the client renders *"That is not allowed in the current state."* A vendor pressing Publish is told that instead of being told which checks are outstanding — and the checklist is the entire point of the feature.

### 400 — real, 224 sites, but a different defect

181 are bare `BadRequestException()` and the rest carry messages that are discarded, so every one renders as *"Something in that request was not valid."* On a form with ten fields that names none of them.

This is **not** the 409 defect. The 409 wording was actively wrong — it told people to refresh when refreshing could not help, and they looped. This wording is merely uninformative. It should not be fixed by inventing 224 codes.

### The structural finding underneath all of it

`createStandardError` already accepts `field_errors` and `current_state`. In the whole repository it has **two** callers: this filter, which passes neither, and the request-context hook, which passes `field_errors` for a malformed request-id or traceparent header.

**`current_state` is passed by nothing, anywhere.** It is defined, plumbed through the constructor, defaulted to null, and unreachable — the third such field found in this batch, after `ORDER_STATE_CONFLICT` and `IDEMPOTENCY_KEY_REUSED`.

It is also the field that would have answered every report in this batch properly. A code says *what kind* of refusal; `current_state` says *what is actually true now* — `PICKING, one unresolved line`, or `AT_VENDOR, awaiting vendor handover`. The codes added here are the floor, not the ceiling.

### Recommended, not done

1. **The two 422 sites** — small and high value: two stable codes with locale keys, and pass the structured payload through. The publish checklist is worth it on its own.
2. **`current_state` in the filter** — a contained change to one function that would let every conflict say what state the resource is in, without touching 224 call sites.
3. **`field_errors` for business validation** — the real fix for 400, and the largest. It is a contract decision about how much detail a rejected request may carry, and how field paths stay stable, so it needs an owner's call rather than a mechanical sweep.

## B07-07 — the two 422 sites, fixed

Both now declare a stable code, and the detail they were already carrying reaches the client.

| Refusal | Was | Now |
|---|---|---|
| Not enough stock | `BUSINESS_RULE_VIOLATION` — *"That is not allowed in the current state"*, `available_quantity` discarded | `INVENTORY_UNAVAILABLE` with `available_quantity` |
| Publication blocked | `BUSINESS_RULE_VIOLATION`, `missing_checks` discarded | `PUBLICATION_INCOMPLETE` with `missing_checks` |

Their old codes — `INVENTORY_UNAVAILABLE` on the error class and the literal `UNPROCESSABLE_ENTITY` — were never keys of `ERROR_DEFINITIONS`, so neither survived. The first now exists as a real code; the second became `PUBLICATION_INCOMPLETE`. Migration `0074` registers both locale keys, English and Hindi, the Hindi carried forward for review with 0064, 0065, 0072 and 0073.

**Carrying the payload needed a channel, and the channel is an allowlist.** `StandardError` gained a `details` map, and the filter populates it only from `available_quantity` and `missing_checks`. Everything else a controller attaches is still discarded, so the property that a concealed 404 stays concealed is unchanged, and this cannot drift into a general escape hatch for internal data.

`details` is always present, empty when there is nothing to say, so a client never has to guess the shape. The client attaches it to the thrown error alongside `status` and `code`.

**Mutation-proven, both halves:**

| Probe | Result |
|---|---|
| Filter stops passing `details` | 1 test fails — the payload no longer reaches the client |
| Allowlist check removed | 2 tests fail — an unlisted `internal_note` crosses into the response |

The second probe is the one worth having. It is the difference between a narrow, reviewed channel and a hole.

**The existing envelope test caught the contract change**, as it should have: `errors.spec.ts` asserts the full shape with `deepEqual` and failed on the new field until it was updated deliberately.

### Rendering is not done

The transport carries `available_quantity` and `missing_checks`; no screen reads them yet. A vendor now gets *"This store cannot go live yet. Some readiness checks are still outstanding."* rather than the generic sentence — better, but the list is sitting in `error.details` unused. Showing the actual checks, and the actual remaining quantity, is UI work in the vendor console and customer cart that this batch does not attempt.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 468 pass / 0 fail |
| `pnpm db:verify` | exit 0 — 74 migrations, 28 modules; `vendor_staff_scenarios` 11 → 13, `vendor_fulfilment_scenarios` 46 → 47 |
| `pnpm test:integration` | exit 0 |

**Mutation-proven:** restoring `const code = codeForStatus(status)` — the discarding behaviour — turns the new test red on *"a declared stable code survives"*.

The second new test is the guard on the fix itself: a controller declaring a code that does not match the response status, or one that is not a real code, is ignored, and a raw `message` in the exception body never appears in the response.
