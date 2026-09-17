-- Keep the domain schema private to the NestJS backend. Supabase Data API roles
-- must never receive direct marketplace access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_runtime') THEN
    CREATE ROLE marketplace_runtime NOLOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA marketplace FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA marketplace FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA marketplace FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA marketplace FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.marketplace_schema_migrations FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON SCHEMA marketplace FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA marketplace FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA marketplace FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA marketplace FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.marketplace_schema_migrations FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON SCHEMA marketplace FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA marketplace FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA marketplace FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA marketplace FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.marketplace_schema_migrations FROM authenticated';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO marketplace_runtime', current_database());
END
$$;
GRANT USAGE ON SCHEMA marketplace TO marketplace_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketplace TO marketplace_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA marketplace TO marketplace_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA marketplace TO marketplace_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO marketplace_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT EXECUTE ON FUNCTIONS TO marketplace_runtime;
