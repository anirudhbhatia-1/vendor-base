# Recovery objectives, backup, and restore

These are company-test targets, not production commitments.

- PostgreSQL/PostGIS: RPO 15 minutes, RTO 2 hours.
- Protected local object storage: RPO 24 hours, RTO 4 hours.
- Queue/outbox/jobs: RPO 0 for committed database work, RTO 2 hours.
- PWA/Android build artifacts: reproducible from Git; RTO 4 hours.

Daily logical database backups and weekly restore rehearsals use synthetic data only. Restore into an isolated database, verify migration checksums, row counts, ledger conservation, outbox/inbox deduplication, protected-object checksums and all connected lifecycle scenarios before cutover. The operations lead declares recovery; finance signs off ledger integrity; security signs off evidence access. A failed rehearsal opens a critical incident and blocks environment promotion.
