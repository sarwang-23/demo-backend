CREATE SCHEMA IF NOT EXISTS cs;
REVOKE ALL ON SCHEMA cs FROM PUBLIC;
CREATE TABLE cs.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cs.tenants (
 id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 storage_quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK(storage_quota_bytes>0), storage_used_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_used_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), CHECK(storage_used_bytes<=storage_quota_bytes)
);
CREATE TABLE cs.users (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),email text NOT NULL,name text NOT NULL,
 role text NOT NULL CHECK(role IN ('ADMIN','ENTRY','REVIEWER','LEADERSHIP')),password_hash text NOT NULL,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,email),CHECK(email=lower(email))
);
CREATE TABLE cs.sessions (
 tenant_id uuid NOT NULL,token_hash text PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX sessions_expiry ON cs.sessions(expires_at);
CREATE TABLE cs.campuses (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,code)
);
CREATE TABLE cs.buildings (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,campus_id uuid NOT NULL,name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id)
);
CREATE TABLE cs.periods (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','LOCKED')),version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),CHECK(start_date<=end_date)
);
CREATE TABLE cs.factors (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),category text NOT NULL,unit text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),
 value numeric(24,9) NOT NULL CHECK(value>0),version_label text NOT NULL,source text NOT NULL,source_url text NOT NULL,region text NOT NULL,methodology text NOT NULL,
 valid_from date NOT NULL,valid_to date NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),created_by uuid NOT NULL,approved_by uuid,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,category,region,version_label),CHECK(valid_from<=valid_to),
 CHECK((status='DRAFT' AND approved_by IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_by<>created_by)),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.documents (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),original_name text NOT NULL,mime_type text NOT NULL,file_size bigint NOT NULL CHECK(file_size>0 AND file_size<=10485760),
 sha256 text NOT NULL CHECK(length(sha256)=64),object_key text NOT NULL UNIQUE,object_version text,
 status text NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','QUEUED','REVIEW_REQUIRED','REJECTED','LINKED','UPLOAD_FAILED')),
 scan_result text,scan_engine text,extraction jsonb,reviewed jsonb,invoice_key text,uploaded_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 upload_deadline timestamptz NOT NULL DEFAULT now()+interval '5 minutes',quota_reserved boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,sha256),UNIQUE(tenant_id,invoice_key),FOREIGN KEY(tenant_id,uploaded_by) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX documents_tenant_page ON cs.documents(tenant_id,created_at DESC,id DESC);
CREATE TABLE cs.activities (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,campus_id uuid NOT NULL,building_id uuid,
 category text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),unit text NOT NULL,quantity numeric(24,6) NOT NULL CHECK(quantity>0),activity_date date NOT NULL,description text NOT NULL DEFAULT '',
 input_source text NOT NULL CHECK(input_source IN ('MANUAL','INVOICE')),document_id uuid,amount_inr numeric(20,2) CHECK(amount_inr>=0),vendor text,invoice_number text,
 fingerprint text NOT NULL,duplicate_slot text NOT NULL DEFAULT '',duplicate_reason text,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','CALCULATED','REJECTED')),
 factor_id uuid,created_by uuid NOT NULL,verified_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,document_id),UNIQUE(tenant_id,fingerprint,duplicate_slot),CHECK(verified_by IS NULL OR verified_by<>created_by),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,building_id) REFERENCES cs.buildings(tenant_id,campus_id,id),FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.factors(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,verified_by) REFERENCES cs.users(tenant_id,id),
 CHECK((input_source='MANUAL' AND document_id IS NULL) OR (input_source='INVOICE' AND document_id IS NOT NULL))
);
CREATE INDEX activities_tenant_page ON cs.activities(tenant_id,created_at DESC,id DESC);
CREATE INDEX activities_tenant_period ON cs.activities(tenant_id,period_id,status,activity_date);
CREATE TABLE cs.calculations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,activity_id uuid NOT NULL,factor_id uuid NOT NULL,
 quantity numeric(24,6) NOT NULL,factor_value numeric(24,9) NOT NULL,kg_co2e numeric(38,6) NOT NULL CHECK(kg_co2e>=0),factor_version text NOT NULL,factor_source text NOT NULL,
 provenance jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,activity_id),
 FOREIGN KEY(tenant_id,activity_id) REFERENCES cs.activities(tenant_id,id),FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.factors(tenant_id,id)
);
CREATE TABLE cs.monthly_totals (
 tenant_id uuid NOT NULL,period_id uuid NOT NULL,campus_id uuid NOT NULL,month date NOT NULL,scope text NOT NULL,category text NOT NULL,
 kg_co2e numeric(38,6) NOT NULL,record_count bigint NOT NULL,evidence_count bigint NOT NULL,
 PRIMARY KEY(tenant_id,period_id,campus_id,month,scope,category),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id)
);
CREATE TABLE cs.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),actor_id uuid,action text NOT NULL,entity_id uuid,details jsonb NOT NULL DEFAULT '{}',request_id text,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,actor_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX audit_tenant_page ON cs.audit_events(tenant_id,id DESC);
CREATE TABLE cs.idempotency_keys (
 tenant_id uuid NOT NULL,actor_id uuid NOT NULL,route text NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,route,request_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX idempotency_expiry ON cs.idempotency_keys(expires_at);
CREATE TABLE cs.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES cs.tenants(id),kind text NOT NULL CHECK(kind IN ('SCAN_INVOICE','CALCULATE','RECONCILE_UPLOAD')),
 entity_id uuid NOT NULL,dedupe_key text NOT NULL,status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','DONE','DEAD')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 5,available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,dedupe_key)
);
CREATE INDEX jobs_claim ON cs.jobs(available_at,created_at) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE cs.rate_buckets(bucket_key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE cs.worker_heartbeats(worker_id uuid PRIMARY KEY,updated_at timestamptz NOT NULL DEFAULT now());
-- Application tables: explicit tenant predicates AND enforced PostgreSQL RLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tenants','users','sessions','campuses','buildings','periods','factors','documents','activities','calculations','monthly_totals','audit_events','idempotency_keys','jobs'] LOOP
  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  IF t='tenants' THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  ELSE
   EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
-- Only the worker may claim jobs across tenants; operational payload holds IDs, not invoice text.
CREATE POLICY worker_queue ON cs.jobs TO cs_worker USING (true) WITH CHECK (true);
CREATE FUNCTION cs.deny_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable ledger: update/delete prohibited' USING ERRCODE='42501'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON cs.audit_events FOR EACH ROW EXECUTE FUNCTION cs.deny_change();
CREATE TRIGGER calculation_immutable BEFORE UPDATE OR DELETE ON cs.calculations FOR EACH ROW EXECUTE FUNCTION cs.deny_change();
CREATE FUNCTION cs.factor_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='APPROVED' THEN RAISE EXCEPTION 'Approved factors are immutable; create a new version' USING ERRCODE='42501'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER factor_immutable BEFORE UPDATE OR DELETE ON cs.factors FOR EACH ROW EXECUTE FUNCTION cs.factor_immutable();
GRANT USAGE ON SCHEMA cs TO cs_api,cs_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA cs TO cs_api,cs_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA cs TO cs_api,cs_worker;
REVOKE ALL ON cs.schema_migrations FROM cs_api,cs_worker;
REVOKE UPDATE,DELETE ON cs.audit_events,cs.calculations FROM cs_api,cs_worker;
REVOKE INSERT,UPDATE,DELETE ON cs.calculations,cs.monthly_totals FROM cs_api;
REVOKE ALL ON cs.users,cs.sessions FROM cs_worker;

REVOKE ALL ON cs.worker_heartbeats FROM cs_api;
GRANT SELECT ON cs.worker_heartbeats TO cs_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cs FROM PUBLIC;
