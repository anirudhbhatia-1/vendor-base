# Repair batch 04 — the acceptance harness, and why it had never run

**Implemented:** 8 September 2026. **Verification level:** `pnpm test:e2e` executed against locally started PWAs; the live-gated journeys remain unrun because their fixtures do not exist.

This takes item 5 from [batch 01's next unaccepted work](repair-batch-01-evidence.md) — *"Repair R12 stale browser selectors/OTP response URLs and create deterministic acceptance fixtures"*.

**`pnpm test:e2e` now passes: 15 passed, 0 failed, 25 skipped.** Before this batch it could not start at all.

## B04-01 — the customer PWA looped for ever on 127.0.0.1

The reason the suite could not start, and the most serious finding here.

Batch 01 added a canonical-host redirect so a developer on `127.0.0.1:3100` would be moved to `localhost:3100` before submitting a form, since the strict origin policy accepts one origin. **That redirect cannot work in Next 16.** `NextResponse.redirect()` emits a *relative* `Location` when the target looks same-origin — and NextURL normalizes `127.0.0.1` to `localhost`, so Next considered `http://localhost:3100/` identical to the current URL. The wire response was `location: /`, which the browser resolved against the host it had actually asked for. Every request to `127.0.0.1:3100` redirected to itself, for ever.

Verified directly rather than inferred: `127.0.0.1:3100/` answered `307` with `location: /` while `localhost:3100/` answered `200`. Setting the header explicitly did not help — a probe header proved the code path ran and Next rewrote the `Location` regardless.

Every Playwright project targets `127.0.0.1`, so its readiness probe never saw a 200, concluded no server was running, and tried to start its own on a port already bound: `EADDRINUSE`. That is the 120-second `config.webServer` timeout the suite had been failing with.

**The unit test could not have caught it.** `customer-origin.spec.ts` asserted `response.headers.get('location')` on the returned `NextResponse` object, where the absolute URL survives. Next relativizes it during HTTP serialization. The test verified the intent and stayed green while the delivered behaviour was an infinite loop — the same shape as every other defect in this audit: a check that cannot observe the thing it claims to.

**Resolution (owner's decision).** Keep the strict single-origin policy exactly as tested, remove the redirect that cannot work, point the harness at the canonical host, and make the refusal explain itself:

- `customerMutationAllowed` is unchanged — `origin === expected`, no aliasing. The existing test asserting that `http://127.0.0.1:3100` is rejected still passes, untouched.
- The proxy no longer redirects; `127.0.0.1:3100` now returns `200` and renders.
- `customerOriginGuidance` names the canonical origin when the supplied one is a loopback alias on the same scheme and port, and returns null for everything else. A developer on the wrong spelling is told what to open; a genuine cross-origin attempt still gets a bare `FORBIDDEN`.
- All nine `127.0.0.1` references in `playwright.config.ts` now use `localhost`.

Confirmed against the running server:

```
POST /api/session/otp/request, Origin: http://127.0.0.1:3100
  -> 403 {"error":{"code":"FORBIDDEN","message":"This request came from http://127.0.0.1:3100,
     and the canonical development origin is http://localhost:3100. ... Open the app at
     http://localhost:3100."}}
POST /api/session/otp/request, Origin: https://evil.example
  -> 403 {"error":{"code":"FORBIDDEN"}}
```

## B04-02 — the golden path could pass without walking it

`cross-role-journey.spec.ts` wrapped **every** mandatory stage in `if (await button.isVisible().catch(() => false))`. A vendor with no orders clicked nothing, and a test named *"a vendor accepts, picks and hands over an order"* passed having accepted, picked and handed over nothing. Its status assertions did the same job from the other side: `Orders are current|No store orders yet` let the empty state satisfy the golden path, as did `online for delivery offers|not eligible` for the partner and `checkout group|No orders loaded yet` for the admin monitor.

Every conditional is gone. Each stage is now asserted and ordered, each being the precondition of the next, so a break stops the walk instead of skipping it. An empty queue fails with a message naming the missing fixture rather than passing.

## B04-03 — stale selectors that had drifted unnoticed

- `live-marketplace-loop.spec.ts` waited for a browser response to `/auth/otp/request`. Batch 01 moved OTP behind the BFF, so the browser calls `/api/session/otp/request` and the upstream call happens server-side where no browser response exists. The matcher could never fire; the test would have hung to timeout.
- The same spec asserted the admin heading *"Authenticated control room"*, which no longer exists — the root heading is marketing copy and had already been rewritten once. It now asserts the `Admin modules` navigation landmark and the session controls, which is what "signed in as an admin" actually means.
- `auth-gates.spec.ts` expected the customer feed heading for a signed-out visitor, who now lands on the location gate, and expected `/cart` to redirect to sign-in. `/cart` is deliberately public — `proxy.ts` keeps it out of the protected routes so a guest basket renders — so that assertion required the very regression the change was made to fix. It now asserts `/cart` renders and `/account` redirects.

These were invisible because the suite had never run.

## The control that keeps it fixed

`tooling/scripts/verify-acceptance-specs.mjs` (wired into `pnpm test:controls`, with a `--self-test`) rejects three shapes in `e2e/*.spec.ts`:

- `isVisible().catch(...)` — swallowing a locator failure turns a missing control into a skipped step;
- an action guarded by `isVisible()` — a mandatory stage made optional;
- an empty-state phrase as one branch of an assertion alternation — "no data" satisfying the populated path.

It ignores comments, so the rationale above does not trip it, and it leaves a dedicated empty-state assertion alone — the defect is an empty state *standing in for* the populated path, not asserting one deliberately.

It found a conditional I had missed on its first run, and reintroducing one into the real spec is caught: *"e2e/cross-role-journey.spec.ts:84 makes an action conditional on isVisible(), so an empty fixture passes the journey without walking it"*.

## Verification

| Check | Result |
|---|---|
| `pnpm test:e2e` | **exit 0 — 15 passed, 0 failed, 25 skipped** (first passing run) |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm security:secrets` | exit 0 |
| `pnpm test:unit` | 464 pass / 0 fail |
| Loopback behaviour | `127.0.0.1:3100/` 200 (was an infinite 307 loop); guidance and bare-FORBIDDEN cases confirmed against the running server |

## Still open

- **Deterministic fixtures do not exist.** The 25 skipped journeys are gated on `LIVE_SUPABASE_ACCEPTANCE`, and they now *fail* without their data instead of skipping stages. `e2e/README.md` documents exactly what each journey needs. Seeding requires an explicitly isolated target and approval; no shared acceptance data was created here.
- **The repaired selectors are verified by source inspection, not by a live run.** The journeys that use them cannot execute without those fixtures, so their selectors remain unproven against a populated UI.
- The other PWAs were only exercised by `auth-gates`; their role workspaces are covered by the live-gated journeys.
