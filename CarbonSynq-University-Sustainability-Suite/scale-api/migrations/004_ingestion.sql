-- Additive university import staging. Never rewrite prior applied migrations.
ALTER TABLE cs.documents DROP CONSTRAINT IF EXISTS documents_mime_type_check;
ALTER TABLE cs.documents ADD CONSTRAINT documents_mime_type_check CHECK
 (mime_type IN ('application/pdf','image/png','image/jpeg','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
CREATE TABLE cs.u_i_batches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), period_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180), kind text NOT NULL CHECK(kind IN ('SPREADSHEET','INVOICE')),
 target text NOT NULL CHECK(target IN ('CARBON','KPI','EMISSION')), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVIEWING','COMPLETE','CANCELLED')),
 close_reason text, version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id), FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_i_files (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), batch_id uuid NOT NULL, document_id uuid NOT NULL,
 generation integer NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 20), plan jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'ATTACHED' CHECK(status IN ('ATTACHED','PREVIEWED','SKIPPED')), skip_reason text,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,batch_id,id), UNIQUE(tenant_id,batch_id,document_id),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES cs.u_i_batches(tenant_id,id), FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_i_rows (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), batch_id uuid NOT NULL, file_id uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0), ordinal integer NOT NULL CHECK(ordinal>0), target text NOT NULL CHECK(target IN ('CARBON','KPI','EMISSION')),
 source_ref jsonb NOT NULL, raw_values jsonb NOT NULL, normalized jsonb NOT NULL, issues jsonb NOT NULL DEFAULT '[]'::jsonb,
 target_payload jsonb, dedupe_key text NOT NULL CHECK(length(dedupe_key)=64),
 status text NOT NULL CHECK(status IN ('REVIEW','INVALID','READY','SKIPPED','IMPORTED','SUPERSEDED')),
 review_reason text, reviewed_by uuid, carbon_record_id uuid, submission_id uuid, emission_id uuid,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,file_id,generation,ordinal),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES cs.u_i_batches(tenant_id,id), FOREIGN KEY(tenant_id,batch_id,file_id) REFERENCES cs.u_i_files(tenant_id,batch_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id), FOREIGN KEY(tenant_id,reviewed_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,carbon_record_id) REFERENCES cs.u_c_records(tenant_id,id), FOREIGN KEY(tenant_id,submission_id) REFERENCES cs.u_submissions(tenant_id,id),
 FOREIGN KEY(tenant_id,emission_id) REFERENCES cs.u_emissions(tenant_id,id),
 CHECK ((status='IMPORTED')=(num_nonnulls(carbon_record_id,submission_id,emission_id)=1)),
 CHECK (num_nonnulls(carbon_record_id,submission_id,emission_id)<=1),
 CHECK (status NOT IN ('READY','IMPORTED') OR reviewed_by IS NOT NULL)
);
CREATE UNIQUE INDEX u_i_import_receipt ON cs.u_i_rows(tenant_id,dedupe_key) WHERE status='IMPORTED';
CREATE INDEX u_i_file_rows ON cs.u_i_rows(tenant_id,file_id,generation,ordinal);
CREATE INDEX u_i_batch_rows ON cs.u_i_rows(tenant_id,batch_id,status);
CREATE TABLE cs.u_i_templates (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 kind text NOT NULL CHECK(kind IN ('SPREADSHEET','INVOICE')), target text NOT NULL CHECK(target IN ('CARBON','KPI','EMISSION')),
 plan jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['u_i_batches','u_i_files','u_i_rows','u_i_templates'] LOOP
  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON cs.%I TO cs_api',t);
  EXECUTE format('CREATE INDEX %I ON cs.%I(tenant_id,created_at DESC,id DESC)',t||'_page',t);
 END LOOP;
END $$;
CREATE FUNCTION cs.i_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='IMPORTED' THEN RAISE EXCEPTION 'Imported staging receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.batch_id<>OLD.batch_id OR NEW.file_id<>OLD.file_id OR NEW.generation<>OLD.generation OR NEW.raw_values<>OLD.raw_values OR NEW.source_ref<>OLD.source_ref THEN
  RAISE EXCEPTION 'Import provenance is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW; END $$;
CREATE TRIGGER import_row_guard BEFORE UPDATE ON cs.u_i_rows FOR EACH ROW EXECUTE FUNCTION cs.i_row_guard();
REVOKE ALL ON FUNCTION cs.i_row_guard() FROM PUBLIC;
