-- University extension. Additive migration: 001_core.sql is deliberately unchanged.
-- All operational references carry tenant_id; application roles never own these tables.
CREATE TABLE cs.u_departments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), campus_id uuid NOT NULL,
 name text NOT NULL, code text NOT NULL, owner_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,campus_id,code), UNIQUE(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_kpis (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id), code text NOT NULL, name text NOT NULL,
 domain text NOT NULL CHECK(domain IN ('ENERGY','WATER','WASTE','TRANSPORT','SOCIAL','GOVERNANCE','ACADEMIC','NORMALIZATION')),
 unit text NOT NULL, aggregation text NOT NULL CHECK(aggregation IN ('SUM','LATEST')),
 evidence_required boolean NOT NULL DEFAULT true, max_value numeric(24,6), guidance text NOT NULL,
 created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id), CHECK(max_value IS NULL OR max_value>=0)
);
CREATE TABLE cs.u_tasks (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,campus_id uuid NOT NULL,
 department_id uuid,kpi_id uuid NOT NULL,assignee_id uuid NOT NULL,reviewer_id uuid NOT NULL,
 bucket text NOT NULL, interval_start date NOT NULL,interval_end date NOT NULL,due_date date NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETE','WAIVED')),waiver_reason text,
 created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,period_id,campus_id,kpi_id,bucket,interval_start,interval_end),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,department_id) REFERENCES cs.u_departments(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,kpi_id) REFERENCES cs.u_kpis(tenant_id,id),
 FOREIGN KEY(tenant_id,assignee_id) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,reviewer_id) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),CHECK(assignee_id<>reviewer_id),CHECK(interval_start<=interval_end)
);
CREATE TABLE cs.u_submissions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),task_id uuid NOT NULL,revision integer NOT NULL,
 value numeric(24,6) NOT NULL CHECK(value>=0),unit text NOT NULL,notes text NOT NULL DEFAULT '',
 evidence_ids jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
 created_by uuid NOT NULL,approved_by uuid,rejection_reason text,correction_reason text,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,task_id,revision),FOREIGN KEY(tenant_id,task_id) REFERENCES cs.u_tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK(jsonb_typeof(evidence_ids)='array')
);
CREATE UNIQUE INDEX u_one_pending_revision ON cs.u_submissions(tenant_id,task_id) WHERE status IN ('DRAFT','SUBMITTED');
CREATE TABLE cs.u_metric_snapshots (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),submission_id uuid NOT NULL,task_id uuid NOT NULL,revision integer NOT NULL,
 period_id uuid NOT NULL,campus_id uuid NOT NULL,kpi_id uuid NOT NULL,bucket text NOT NULL,interval_start date NOT NULL,interval_end date NOT NULL,
 value numeric(24,6) NOT NULL,unit text NOT NULL,aggregation text NOT NULL,kpi_code text NOT NULL,evidence jsonb NOT NULL,approved_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,submission_id),
 UNIQUE(tenant_id,task_id,revision),FOREIGN KEY(tenant_id,submission_id) REFERENCES cs.u_submissions(tenant_id,id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES cs.u_tasks(tenant_id,id),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),FOREIGN KEY(tenant_id,kpi_id) REFERENCES cs.u_kpis(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_factors (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),category text NOT NULL,unit text NOT NULL,
 value numeric(24,9) NOT NULL CHECK(value>0),method text NOT NULL CHECK(method IN ('ACTIVITY_BASED','SPEND_BASED')),
 source text NOT NULL,source_url text NOT NULL,region text NOT NULL,boundary text NOT NULL,version_label text NOT NULL,
 valid_from date NOT NULL,valid_to date NOT NULL,currency text,price_year integer,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),created_by uuid NOT NULL,approved_by uuid,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,category,unit,region,version_label),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),CHECK(valid_from<=valid_to),
 CHECK((status='DRAFT' AND approved_by IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_by<>created_by)),
 CHECK((method='SPEND_BASED' AND currency IS NOT NULL AND price_year IS NOT NULL AND unit=currency) OR (method='ACTIVITY_BASED' AND currency IS NULL AND price_year IS NULL))
);
CREATE TABLE cs.u_emissions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,campus_id uuid NOT NULL,department_id uuid,
 category text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2','SCOPE_3','SUPPLEMENTAL')),
 scope3_category integer CHECK(scope3_category BETWEEN 1 AND 15),quantity numeric(24,6) NOT NULL CHECK(quantity>0),unit text NOT NULL,
 activity_date date NOT NULL,external_key text NOT NULL,description text NOT NULL,factor_id uuid NOT NULL,
 data_quality text NOT NULL CHECK(data_quality IN ('MEASURED','ESTIMATED','SPEND_PROXY')),assumptions text NOT NULL DEFAULT '',
 currency text,price_year integer,evidence_ids jsonb NOT NULL DEFAULT '[]',replaces_id uuid,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','CALCULATED','REJECTED')),
 created_by uuid NOT NULL,approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,external_key),UNIQUE(tenant_id,replaces_id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,department_id) REFERENCES cs.u_departments(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.u_factors(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,replaces_id) REFERENCES cs.u_emissions(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK((scope='SCOPE_3')=(scope3_category IS NOT NULL)),CHECK(jsonb_typeof(evidence_ids)='array')
);
CREATE TABLE cs.u_calculations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),emission_id uuid NOT NULL,factor_id uuid NOT NULL,
 quantity numeric(24,6) NOT NULL,factor_value numeric(24,9) NOT NULL,kg_co2e numeric(38,6) NOT NULL CHECK(kg_co2e>=0),
 provenance jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,emission_id),
 FOREIGN KEY(tenant_id,emission_id) REFERENCES cs.u_emissions(tenant_id,id),FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.u_factors(tenant_id,id)
);
CREATE TABLE cs.u_voids (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),emission_id uuid NOT NULL,reason text NOT NULL,
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','APPROVED','REJECTED')),created_by uuid NOT NULL,approved_by uuid,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,emission_id) REFERENCES cs.u_emissions(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE UNIQUE INDEX u_one_void ON cs.u_voids(tenant_id,emission_id) WHERE status IN ('SUBMITTED','APPROVED');
CREATE TABLE cs.u_scope3_screenings (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,category_number integer NOT NULL CHECK(category_number BETWEEN 1 AND 15),
 decision text NOT NULL CHECK(decision IN ('INCLUDED','EXCLUDED','NOT_ASSESSED')),rationale text NOT NULL,
 created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,period_id,category_number),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_suppliers (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,code text NOT NULL,contact_email text NOT NULL,
 category text NOT NULL,created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_supplier_requests (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),supplier_id uuid NOT NULL,period_id uuid NOT NULL,
 title text NOT NULL,questions jsonb NOT NULL,answers jsonb,evidence_ids jsonb NOT NULL DEFAULT '[]',due_date date NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','SUBMITTED','APPROVED','REJECTED','CLOSED')),
 created_by uuid NOT NULL,approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES cs.u_suppliers(tenant_id,id),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK(jsonb_typeof(questions)='array')
);
CREATE TABLE cs.u_materiality (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,title text NOT NULL,topics jsonb NOT NULL,
 impact_threshold numeric(5,2) NOT NULL CHECK(impact_threshold BETWEEN 1 AND 5),financial_threshold numeric(5,2) NOT NULL CHECK(financial_threshold BETWEEN 1 AND 5),
 min_responses integer NOT NULL CHECK(min_responses BETWEEN 5 AND 100),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','APPROVED')),snapshot jsonb,created_by uuid NOT NULL,approved_by uuid,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE TABLE cs.u_invites (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),kind text NOT NULL CHECK(kind IN ('SUPPLIER','MATERIALITY')),
 target_id uuid NOT NULL,token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),stakeholder_group text,
 expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,consumed boolean NOT NULL DEFAULT false,created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_responses (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),assessment_id uuid NOT NULL,invite_id uuid NOT NULL,
 stakeholder_group text NOT NULL,scores jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,invite_id),FOREIGN KEY(tenant_id,assessment_id) REFERENCES cs.u_materiality(tenant_id,id),
 FOREIGN KEY(tenant_id,invite_id) REFERENCES cs.u_invites(tenant_id,id)
);
CREATE TABLE cs.u_reports (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,title text NOT NULL,purpose text NOT NULL,
 period_version integer NOT NULL,snapshot jsonb NOT NULL,snapshot_hash text NOT NULL CHECK(length(snapshot_hash)=64),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','APPROVED','REJECTED')),created_by uuid NOT NULL,approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE TABLE cs.u_targets (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,baseline_report_id uuid NOT NULL,
 scopes jsonb NOT NULL,baseline_kg numeric(38,6) NOT NULL CHECK(baseline_kg>0),reduction_percent numeric(7,4) NOT NULL CHECK(reduction_percent>0 AND reduction_percent<=100),
 target_date date NOT NULL,owner_id uuid NOT NULL,created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,baseline_report_id) REFERENCES cs.u_reports(tenant_id,id),FOREIGN KEY(tenant_id,owner_id) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.u_initiatives (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),target_id uuid NOT NULL,campus_id uuid NOT NULL,
 name text NOT NULL,owner_id uuid NOT NULL,start_date date NOT NULL,end_date date NOT NULL,
 estimated_reduction_kg numeric(30,6) NOT NULL CHECK(estimated_reduction_kg>=0),investment_inr numeric(24,2) NOT NULL CHECK(investment_inr>=0),
 annual_savings_inr numeric(24,2) NOT NULL CHECK(annual_savings_inr>=0),assumptions text NOT NULL,
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','IN_PROGRESS','ON_HOLD','COMPLETED')),progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 created_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id) REFERENCES cs.u_targets(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),CHECK(start_date<=end_date)
);
CREATE TABLE cs.u_pcf_studies (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,functional_unit text NOT NULL,output_quantity numeric(24,6) NOT NULL CHECK(output_quantity>0),
 boundary text NOT NULL,study_date date NOT NULL,bom jsonb NOT NULL,result jsonb,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),created_by uuid NOT NULL,approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),CHECK(approved_by IS NULL OR approved_by<>created_by)
);
-- Row-level tenant isolation, indexes, application grants, immutable evidence ledgers.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['u_departments','u_kpis','u_tasks','u_submissions','u_metric_snapshots','u_factors','u_emissions','u_calculations','u_voids','u_scope3_screenings','u_suppliers','u_supplier_requests','u_materiality','u_invites','u_responses','u_reports','u_targets','u_initiatives','u_pcf_studies'] LOOP
  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE INDEX %I ON cs.%I(tenant_id,created_at DESC,id DESC)',t||'_page',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON cs.%I TO cs_api',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['u_metric_snapshots','u_calculations','u_responses'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON cs.%I FOR EACH ROW EXECUTE FUNCTION cs.deny_change()',t);
  EXECUTE format('REVOKE UPDATE ON cs.%I FROM cs_api',t);
 END LOOP;
END $$;
CREATE INDEX u_tasks_period ON cs.u_tasks(tenant_id,period_id,status,due_date);
CREATE INDEX u_tasks_assignee ON cs.u_tasks(tenant_id,assignee_id,status);
CREATE INDEX u_submissions_task ON cs.u_submissions(tenant_id,task_id,revision DESC);
CREATE INDEX u_emissions_period ON cs.u_emissions(tenant_id,period_id,scope,status);
CREATE INDEX u_invites_target ON cs.u_invites(tenant_id,kind,target_id);
CREATE INDEX u_responses_assessment ON cs.u_responses(tenant_id,assessment_id);
CREATE INDEX u_metric_period ON cs.u_metric_snapshots(tenant_id,period_id,kpi_code);
CREATE FUNCTION cs.u_approved_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('APPROVED','CALCULATED') THEN
  RAISE EXCEPTION 'Approved university records are immutable; use a new revision or approved void' USING ERRCODE='42501';
 END IF; RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['u_submissions','u_factors','u_emissions','u_voids','u_supplier_requests','u_materiality','u_reports','u_pcf_studies'] LOOP
  EXECUTE format('CREATE TRIGGER approved_immutable BEFORE UPDATE OR DELETE ON cs.%I FOR EACH ROW EXECUTE FUNCTION cs.u_approved_immutable()',t);
 END LOOP;
END $$;
CREATE FUNCTION cs.u_report_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.period_version<>OLD.period_version THEN
  RAISE EXCEPTION 'Report snapshot cannot be edited' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE ON cs.u_reports FOR EACH ROW EXECUTE FUNCTION cs.u_report_snapshot_immutable();
-- Latest approved revision per collection task, then latest period point per KPI source for LATEST KPIs.
CREATE VIEW cs.u_current_metrics WITH (security_invoker=true) AS
 SELECT s.* FROM cs.u_metric_snapshots s WHERE NOT EXISTS
 (SELECT 1 FROM cs.u_metric_snapshots newer WHERE newer.tenant_id=s.tenant_id AND newer.task_id=s.task_id AND newer.revision>s.revision);
-- Supplemental student travel remains separate; PCF scenarios are intentionally NOT in this inventory.
CREATE VIEW cs.u_inventory WITH (security_invoker=true) AS
 SELECT c.id,c.tenant_id,a.id AS record_id,a.period_id,a.campus_id,a.activity_date,a.category,a.scope,
 NULL::integer AS scope3_category,a.quantity,a.unit,c.kg_co2e,
 'CORE'::text AS ledger,'UNCLASSIFIED_CORE'::text AS data_quality,c.provenance,
 CASE WHEN a.document_id IS NULL THEN 0 ELSE 1 END::integer AS evidence_count
 FROM cs.calculations c JOIN cs.activities a ON a.tenant_id=c.tenant_id AND a.id=c.activity_id
 WHERE a.status='CALCULATED'
 UNION ALL
 SELECT c.id,c.tenant_id,a.id,a.period_id,a.campus_id,a.activity_date,a.category,a.scope,a.scope3_category,a.quantity,a.unit,c.kg_co2e,
 'UNIVERSITY'::text,a.data_quality,c.provenance,jsonb_array_length(a.evidence_ids)
 FROM cs.u_calculations c JOIN cs.u_emissions a ON a.tenant_id=c.tenant_id AND a.id=c.emission_id
 WHERE a.status='CALCULATED' AND NOT EXISTS
 (SELECT 1 FROM cs.u_voids v WHERE v.tenant_id=a.tenant_id AND v.emission_id=a.id AND v.status='APPROVED');
GRANT SELECT ON cs.u_current_metrics,cs.u_inventory TO cs_api;
REVOKE ALL ON FUNCTION cs.u_approved_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION cs.u_report_snapshot_immutable() FROM PUBLIC;
