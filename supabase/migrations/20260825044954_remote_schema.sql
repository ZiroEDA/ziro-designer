


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."projects_reject_damage"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  old_count int := 0;
  new_count int := jsonb_array_length(coalesce(new.files, '[]'::jsonb));
  hollow    int;
begin
  -- A manifest entry must name a blob. Catching this here means a row can never
  -- reference nothing at all, whatever the client believes it uploaded.
  if new_count > 0 then
    select count(*) into hollow
    from jsonb_array_elements(new.files) f
    where coalesce(f->>'hash', '') = '' and coalesce(f->>'gzB64', '') = '';

    -- Legacy rows list names only and are still readable; they are simply never
    -- written any more. Allow them through on UPDATE of an already-legacy row
    -- so an old client cannot be locked out mid-migration, but never let a row
    -- that has real content regress to that shape.
    if hollow = new_count and tg_op = 'UPDATE' then
      select jsonb_array_length(coalesce(old.files, '[]'::jsonb)) into old_count;
      if old_count > 0 and exists (
        select 1 from jsonb_array_elements(old.files) f
        where coalesce(f->>'hash', '') <> '' or coalesce(f->>'gzB64', '') <> ''
      ) then
        raise exception
          'refusing to replace % addressable files in "%" with % that address nothing',
          old_count, new.name, new_count;
      end if;
    end if;
  end if;

  -- A project that had files does not silently become a project with none.
  -- A real "delete everything" is a DELETE, not an UPDATE to an empty list.
  if tg_op = 'UPDATE' then
    select jsonb_array_length(coalesce(old.files, '[]'::jsonb)) into old_count;
    if old_count > 0 and new_count = 0 then
      raise exception 'refusing to empty "%": % files would be dropped', new.name, old_count;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."projects_reject_damage"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."project_versions" (
    "version_id" bigint NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "committed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."project_versions_version_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."project_versions_version_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."project_versions_version_id_seq" OWNED BY "public"."project_versions"."version_id";



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


ALTER TABLE ONLY "public"."project_versions" ALTER COLUMN "version_id" SET DEFAULT "nextval"('"public"."project_versions_version_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."project_versions"
    ADD CONSTRAINT "project_versions_pkey" PRIMARY KEY ("version_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("user_id", "id");



CREATE INDEX "project_versions_lookup_idx" ON "public"."project_versions" USING "btree" ("user_id", "project_id", "version_id" DESC);



CREATE INDEX "projects_updated_at_idx" ON "public"."projects" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "projects_user_id_idx" ON "public"."projects" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "projects_reject_damage_trg" BEFORE INSERT OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."projects_reject_damage"();



ALTER TABLE ONLY "public"."project_versions"
    ADD CONSTRAINT "project_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."project_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_versions_insert_own" ON "public"."project_versions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "project_versions_select_own" ON "public"."project_versions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete_own" ON "public"."projects" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "projects_insert_own" ON "public"."projects" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "projects_select_own" ON "public"."projects" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "projects_update_own" ON "public"."projects" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."projects_reject_damage"() TO "anon";
GRANT ALL ON FUNCTION "public"."projects_reject_damage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."projects_reject_damage"() TO "service_role";


















GRANT ALL ON TABLE "public"."project_versions" TO "anon";
GRANT ALL ON TABLE "public"."project_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."project_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."project_versions_version_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."project_versions_version_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."project_versions_version_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































