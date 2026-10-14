-- 14 Oct 2026: Supabase's security advisor (rls_disabled_in_public, critical). Supabase publishes every table in the
-- `public` schema through its Data API (PostgREST), where the `anon` and `authenticated` roles reach them with the
-- project's anon key, a key Supabase treats as public. No Vault table had row-level security, so anyone holding that
-- key could read or change Vault records without passing the Vault's own scope checks (AGENTS.md rule 4).
--
-- The Vault never uses the Data API: it connects to Postgres directly as the tables' owner (DATABASE_URL), and files go
-- through the Storage API with the service key. So this closes the API completely and changes nothing for the Vault:
--   1. row-level security on every table in `public`, with no policy: the API roles see no rows and can write none;
--      the owner (the Vault's own connection) is exempt, as Postgres exempts a table's owner unless FORCE is set;
--   2. every privilege the API roles hold on those tables, sequences and functions revoked, now and for tables made later;
--   3. the same for any table a later migration adds, by the test in test/db.rls.test.ts that fails the build when a
--      table without row-level security appears.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
