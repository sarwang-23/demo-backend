-- Additive university operations. Existing accounting migrations are unchanged.
CREATE TABLE cs.u_o_memberships (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), user_id uuid NOT NULL,
 campus_id uuid NOT NULL, department_id uuid, active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,department_id) REFERENCES cs.u_departments(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE UNIQUE INDEX u_o_member_scope ON cs.u_o_memberships(tenant_id,user_id,campus_id,(coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid)));
CREATE TABLE cs.u_o_document_scopes (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,document_id uuid NOT NULL,visibility text NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','DEPARTMENT','CAMPUS')),
 campus_id uuid,department_id uuid,hold_until timestamptz,hold_reason text,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,document_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,department_id) REFERENCES cs.u_departments(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 CHECK((visibility='PRIVATE' AND campus_id IS NULL AND department_id IS NULL) OR (visibility='CAMPUS' AND campus_id IS NOT NULL AND department_id IS NULL) OR (visibility='DEPARTMENT' AND campus_id IS NOT NULL AND department_id IS NOT NULL))
);
CREATE TABLE cs.u_o_document_grants (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,document_id uuid NOT NULL,user_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,document_id,user_id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_o_credentials (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),purpose text NOT NULL CHECK(purpose IN ('RESET','INVITE')),
 user_id uuid,email text NOT NULL,name text,role text CHECK(role IN ('ADMIN','ENTRY','REVIEWER','LEADERSHIP')),
 token_hash text NOT NULL CHECK(length(token_hash)=64),password_stamp text,expires_at timestamptz NOT NULL,
 consumed_at timestamptz,revoked_at timestamptz,created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(token_hash),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 CHECK((purpose='RESET' AND user_id IS NOT NULL AND password_stamp IS NOT NULL) OR (purpose='INVITE' AND user_id IS NULL AND name IS NOT NULL AND role IS NOT NULL))
);
CREATE INDEX u_o_credentials_account ON cs.u_o_credentials(tenant_id,email,purpose,expires_at);
CREATE TABLE cs.u_o_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,user_id uuid NOT NULL,kind text NOT NULL,entity_id uuid,
 title text NOT NULL,message text NOT NULL,dedupe_key text NOT NULL,read_at timestamptz,email_queued boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,user_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_o_preferences (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,user_id uuid NOT NULL,email_enabled boolean NOT NULL DEFAULT false,reminders_enabled boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,user_id),FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_o_mail (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),user_id uuid,credential_id uuid,kind text NOT NULL,
 envelope text,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','CAPTURED','CANCELLED','FAILED')),
 dedupe_key text NOT NULL,delivery_id text,error_code text,expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),delivered_at timestamptz,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,dedupe_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,credential_id) REFERENCES cs.u_o_credentials(tenant_id,id)
);
CREATE TABLE cs.u_o_exports (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,period_id uuid NOT NULL,period_version integer NOT NULL,title text NOT NULL,format text NOT NULL CHECK(format IN ('csv','jsonl')),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','READY','APPROVED','FAILED','REJECTED')),
 row_count integer,byte_count bigint,sha256 text,object_key text,object_version text,totals jsonb,error_code text,created_by uuid NOT NULL,approved_by uuid,approval_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND sha256 IS NOT NULL AND object_version IS NOT NULL))
);
CREATE TABLE cs.u_o_ocr_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,document_id uuid NOT NULL,document_version integer NOT NULL,input_sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','COMPLETE','FAILED','CANCELLED')),
 previous_extraction jsonb,result_summary jsonb,error_code text,created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE UNIQUE INDEX u_o_one_pending_ocr ON cs.u_o_ocr_runs(tenant_id,document_id) WHERE status IN ('QUEUED','PROCESSING');
CREATE TABLE cs.u_o_reassignments (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),kind text NOT NULL CHECK(kind IN ('TASK','SOURCE','ACTION')),target_id uuid NOT NULL,before_state jsonb NOT NULL,after_state jsonb NOT NULL,reason text NOT NULL,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['u_o_memberships','u_o_document_scopes','u_o_document_grants','u_o_credentials','u_o_notifications','u_o_preferences','u_o_mail','u_o_exports','u_o_ocr_runs','u_o_reassignments'] LOOP
  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE INDEX %I ON cs.%I(tenant_id,created_at DESC,id DESC)',t||'_page',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON cs.%I TO cs_api',t);
 END LOOP;
END $$;
REVOKE UPDATE ON cs.u_o_reassignments FROM cs_api;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON cs.u_o_reassignments FOR EACH ROW EXECUTE FUNCTION cs.deny_change();
CREATE TRIGGER approved_immutable BEFORE UPDATE OR DELETE ON cs.u_o_exports FOR EACH ROW EXECUTE FUNCTION cs.u_approved_immutable();
ALTER TABLE cs.users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE cs.u_c_sources ADD COLUMN ownership_version integer NOT NULL DEFAULT 1;
-- Source accounting identity remains immutable; ONLY accountable ownership may change.
DROP TRIGGER immutable ON cs.u_c_sources;
CREATE FUNCTION cs.c_source_owner_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'owner_id'-'ownership_version') IS DISTINCT FROM (to_jsonb(OLD)-'owner_id'-'ownership_version') OR NEW.ownership_version<>OLD.ownership_version+1 THEN
  RAISE EXCEPTION 'Source accounting identity is immutable; only audited ownership transfer is allowed' USING ERRCODE='42501';
 END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON cs.u_c_sources FOR EACH ROW EXECUTE FUNCTION cs.c_source_owner_only();
GRANT UPDATE(owner_id,ownership_version) ON cs.u_c_sources TO cs_api;
ALTER TABLE cs.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE cs.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('SCAN_INVOICE','CALCULATE','RECONCILE_UPLOAD','OPS_SWEEP','SEND_MAIL','BUILD_EXPORT','OCR_DOCUMENT'));
GRANT SELECT ON cs.users,cs.periods,cs.u_tasks,cs.u_submissions,cs.u_c_actions,cs.u_inventory,cs.u_c_active,cs.u_calculations,cs.u_emissions,cs.u_voids,cs.u_c_records,cs.u_c_calculations,cs.u_c_voids,cs.u_o_credentials,cs.u_o_preferences,cs.u_i_rows,cs.u_i_files TO cs_worker;
GRANT SELECT,INSERT,UPDATE ON cs.u_o_notifications,cs.u_o_mail,cs.u_o_exports,cs.u_o_ocr_runs TO cs_worker;
-- In-app notifications are emitted in the SAME transaction as each audit event.
CREATE FUNCTION cs.o_notify_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid; target uuid; label text;
BEGIN
 IF NEW.action='TENANT_PROVISIONED' THEN
  INSERT INTO cs.jobs(tenant_id,kind,entity_id,dedupe_key) VALUES(NEW.tenant_id,'OPS_SWEEP',NEW.tenant_id,'OPS_SWEEP:'||NEW.tenant_id) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING;
 END IF;
 IF NEW.action IN ('U_TASK_CREATED','O_TASK_REASSIGNED') THEN
  SELECT assignee_id,id INTO recipient,target FROM cs.u_tasks WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;label:='Collection task assigned';
 ELSIF NEW.action='U_SUBMISSION_SUBMITTED' THEN
  SELECT t.reviewer_id,t.id INTO recipient,target FROM cs.u_submissions s JOIN cs.u_tasks t ON t.tenant_id=s.tenant_id AND t.id=s.task_id WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.entity_id;label:='Submission awaiting your review';
 ELSIF NEW.action IN ('U_SUBMISSION_REJECTED','U_METRIC_APPROVED') THEN
  SELECT s.created_by,t.id INTO recipient,target FROM cs.u_submissions s JOIN cs.u_tasks t ON t.tenant_id=s.tenant_id AND t.id=s.task_id WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.entity_id;label:=CASE WHEN NEW.action='U_METRIC_APPROVED' THEN 'Submission approved' ELSE 'Submission returned for correction' END;
 ELSIF NEW.action='O_SOURCE_REASSIGNED' THEN
  SELECT owner_id,id INTO recipient,target FROM cs.u_c_sources WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;label:='Source responsibility assigned';
 ELSIF NEW.action IN ('C_ACTION_CREATED','O_ACTION_REASSIGNED','C_ACTION_CLOSED','C_ACTION_OPEN') THEN
  SELECT owner_id,id INTO recipient,target FROM cs.u_c_actions WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;label:='Corrective action updated';
 ELSIF NEW.action IN ('C_RECORD_REJECTED','C_RECORD_CALCULATED') THEN
  SELECT created_by,id INTO recipient,target FROM cs.u_c_records WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;label:=CASE WHEN NEW.action='C_RECORD_CALCULATED' THEN 'Carbon entry approved and calculated' ELSE 'Carbon entry returned for correction' END;
 ELSIF NEW.action='C_RECORD_SUBMITTED' THEN
  INSERT INTO cs.u_o_notifications(tenant_id,user_id,kind,entity_id,title,message,dedupe_key)
   SELECT NEW.tenant_id,u.id,NEW.action,NEW.entity_id,'Carbon entry awaiting independent review','Sign in to review the source evidence and calculation. No automatic approval.','audit:'||NEW.id
   FROM cs.users u WHERE u.tenant_id=NEW.tenant_id AND u.active AND u.role IN ('ADMIN','REVIEWER') AND u.id IS DISTINCT FROM NEW.actor_id
   ON CONFLICT(tenant_id,user_id,dedupe_key) DO NOTHING;
 ELSIF NEW.action='O_EXPORT_READY' THEN
  SELECT created_by,id INTO recipient,target FROM cs.u_o_exports WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;label:='Inventory export ready for independent approval';
 END IF;
 IF recipient IS NOT NULL THEN
  INSERT INTO cs.u_o_notifications(tenant_id,user_id,kind,entity_id,title,message,dedupe_key)
  VALUES(NEW.tenant_id,recipient,NEW.action,target,label,'Sign in to review the current record. Notifications never change approval or calculation status.','audit:'||NEW.id)
  ON CONFLICT(tenant_id,user_id,dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operations_notifications AFTER INSERT ON cs.audit_events FOR EACH ROW EXECUTE FUNCTION cs.o_notify_audit();
-- Backfill one recurring tenant-scoped sweep; runtime jobs remain fenced.
INSERT INTO cs.jobs(tenant_id,kind,entity_id,dedupe_key)
 SELECT id,'OPS_SWEEP',id,'OPS_SWEEP:'||id FROM cs.tenants
 ON CONFLICT(tenant_id,dedupe_key) DO NOTHING;

REVOKE ALL ON FUNCTION cs.o_notify_audit(), cs.c_source_owner_only() FROM PUBLIC;
