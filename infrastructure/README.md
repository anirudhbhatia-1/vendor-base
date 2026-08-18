# Infrastructure

This directory owns local, free and reproducible infrastructure responsibilities. The root `compose.yaml` provides the Step 2.4 PostgreSQL/PostGIS local and test services. `online-test/` provides the Step 2.6 controlled deployment skeleton for the API and worker on OCI; it does not contain credentials or claim that provider resources exist. Queue infrastructure is intentionally not bundled into the database step; Valkey and the explicit Redis compatibility profile remain later queue-foundation work.

The online-test account and deployment procedure is in `runbooks/online-test/README.md`. Production secrets, production domains, production certificates, public launch and paid resources remain blocked. Infrastructure definitions must not contain credentials or real data.
