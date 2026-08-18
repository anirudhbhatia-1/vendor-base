# Database

This directory owns reviewed SQL migrations, PostGIS activation, deterministic synthetic seeds and database lifecycle documentation.

Automatic schema synchronization is prohibited. Step 2.4 will create the first migration and seed/reset flow. PostgreSQL remains authoritative; no cache or queue state may replace durable business records.
