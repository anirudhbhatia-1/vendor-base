# Infrastructure

This directory owns local, free and reproducible infrastructure responsibilities. The root `compose.yaml` provides the active Step 2.4 PostgreSQL/PostGIS local and test services. `online-test/` preserves the paused Step 2.6 deployment skeleton as future reference; D-12 prohibits executing it. Queue infrastructure is intentionally not bundled into the database step; Valkey and the explicit Redis compatibility profile remain later local queue-foundation work.

The disabled online-test procedure is in `runbooks/online-test/README.md`. Four synthetic Cloudflare snapshots and an empty Supabase baseline may exist externally but are not active infrastructure; R2 and OCI were not activated. Production secrets, production domains, production certificates, public launch and paid resources remain blocked. Infrastructure definitions must not contain credentials or real data.
