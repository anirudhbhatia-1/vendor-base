# Cross-application tests

This directory owns tests that cross more than one application or package boundary:

- integration journeys spanning API, worker, database or queue responsibilities;
- PWA end-to-end journeys executed with Playwright;
- Android end-to-end journeys executed locally with Maestro; and
- later performance, recovery and provider-conformance suites.

Unit and component tests stay beside the source they verify. All fixtures are deterministic and synthetic. Test controls, fake providers and fixture loaders must be unavailable to production runtime code.
