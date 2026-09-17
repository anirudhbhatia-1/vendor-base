# Cross-application tests

This directory owns tests that cross more than one application or package boundary:

- integration journeys spanning API, worker, database or queue responsibilities;
- Android end-to-end journeys executed locally with Maestro; and
- later performance, recovery and provider-conformance suites.

Browser end-to-end journeys are **not** here: Playwright's `testDir` is `e2e/`, and that
directory documents them. This one currently holds no tests. Connected database journeys live
in `database/scripts/verify-*.ts` and run through `pnpm db:verify`.

A cross-boundary test may import `@neighbourhood-store/contracts`, `domain-types` and
`test-data`. It must not import another application's internal source. Unit and component tests
stay beside the source they verify. All fixtures are deterministic and synthetic. Test controls, fake providers and fixture loaders must be unavailable to production runtime code.
