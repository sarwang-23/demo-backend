-- Additive Scope 1/2 upgrade. 001 and 002 stay byte-for-byte unchanged.
CREATE TABLE cs.u_c_sources (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 campus_id uuid NOT NULL,building_id uuid,department_id uuid,owner_id uuid NOT NULL,code text NOT NULL,name text NOT NULL,
 kind text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),substance text NOT NULL,unit text NOT NULL,region text NOT NULL,
 facility_type text NOT NULL,active_from date NOT NULL,active_to date NOT NULL,description text NOT NULL,created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 UNIQUE(tenant_id,code),UNIQUE(tenant_id,id,campus_id,unit),CHECK(active_from<=active_to),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,building_id) REFERENCES cs.buildings(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,department_id) REFERENCES cs.u_departments(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES cs.users(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_boundaries (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),campus_ids jsonb NOT NULL,campus_exclusions jsonb NOT NULL,
 approach text NOT NULL CHECK(approach IN ('OPERATIONAL_CONTROL','FINANCIAL_CONTROL')),statement text NOT NULL,
 base_year integer NOT NULL,recalculation_policy text NOT NULL,scope2_mode text NOT NULL CHECK(scope2_mode IN ('DUAL','LOCATION_ONLY')),
 scope2_rationale text NOT NULL,sources jsonb NOT NULL,screening jsonb NOT NULL,evidence_ids jsonb NOT NULL,created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')), approved_by uuid, rejection_reason text, version integer NOT NULL DEFAULT 1, FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id), CHECK(approved_by IS NULL OR approved_by<>created_by),
 UNIQUE(tenant_id,period_id,revision),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_period_modes (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,boundary_id uuid NOT NULL,activated_by uuid NOT NULL,
 UNIQUE(tenant_id,period_id),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),
 FOREIGN KEY(tenant_id,boundary_id) REFERENCES cs.u_c_boundaries(tenant_id,id),FOREIGN KEY(tenant_id,activated_by) REFERENCES cs.users(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_factors (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 name text NOT NULL,kind text NOT NULL,substance text NOT NULL,unit text NOT NULL,use text NOT NULL CHECK(use IN ('DIRECT','LOCATION','MARKET_CONTRACT','RESIDUAL','GRID_FALLBACK')),
 components jsonb NOT NULL CHECK(jsonb_typeof(components)='array'),gwp_basis text NOT NULL,source text NOT NULL,source_url text NOT NULL,
 region text NOT NULL,boundary text NOT NULL,version_label text NOT NULL,valid_from date NOT NULL,valid_to date NOT NULL,zero_reason text,
 created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')), approved_by uuid, rejection_reason text, version integer NOT NULL DEFAULT 1, FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id), CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK(valid_from<=valid_to),UNIQUE(tenant_id,kind,substance,unit,use,region,version_label)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_instruments (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('EAC','PPA','SUPPLIER_PRODUCT')),
 registry text NOT NULL,serial text NOT NULL,serial_key text NOT NULL,beneficiary text NOT NULL,region text NOT NULL,
 quantity_kwh numeric(24,6) NOT NULL CHECK(quantity_kwh>0),valid_from date NOT NULL,valid_to date NOT NULL,
 vintage_from date NOT NULL,vintage_to date NOT NULL,retired_on date NOT NULL,factor_id uuid NOT NULL,quality_checks jsonb NOT NULL,evidence_ids jsonb NOT NULL,
 created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')), approved_by uuid, rejection_reason text, version integer NOT NULL DEFAULT 1, FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id), CHECK(approved_by IS NULL OR approved_by<>created_by),UNIQUE(tenant_id,serial_key),CHECK(valid_from<=valid_to),CHECK(vintage_from<=vintage_to),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.u_c_factors(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_records (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,source_id uuid NOT NULL,boundary_id uuid NOT NULL,campus_id uuid NOT NULL,kind text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),unit text NOT NULL,interval_start date NOT NULL,interval_end date NOT NULL,
 external_key text NOT NULL,description text NOT NULL,quantity_input jsonb NOT NULL,quantity numeric(24,6) NOT NULL CHECK(quantity>=0),
 factor_id uuid NOT NULL,market_allocations jsonb NOT NULL,fallback_factor_id uuid,fallback_reason text,evidence_ids jsonb NOT NULL,
 data_quality text NOT NULL CHECK(data_quality IN ('MEASURED','ESTIMATED')),assumptions text NOT NULL,zero_reason text,replaces_id uuid,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','CALCULATED','REJECTED','CANCELLED')),
 approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 UNIQUE(tenant_id,external_key),UNIQUE(tenant_id,replaces_id),CHECK(interval_start<=interval_end),
 CHECK(approved_by IS NULL OR approved_by<>created_by),CHECK(quantity>0 OR length(zero_reason)>=10),
 FOREIGN KEY(tenant_id,source_id,campus_id,unit) REFERENCES cs.u_c_sources(tenant_id,id,campus_id,unit),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,boundary_id) REFERENCES cs.u_c_boundaries(tenant_id,id),
 FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.u_c_factors(tenant_id,id),FOREIGN KEY(tenant_id,fallback_factor_id) REFERENCES cs.u_c_factors(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,replaces_id) REFERENCES cs.u_c_records(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_calculations (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 record_id uuid NOT NULL,scope1_kg numeric(38,6),location_kg numeric(38,6),market_kg numeric(38,6),biogenic_kg numeric(38,6) NOT NULL,
 provenance jsonb NOT NULL,UNIQUE(tenant_id,record_id),FOREIGN KEY(tenant_id,record_id) REFERENCES cs.u_c_records(tenant_id,id),
 CHECK((scope1_kg IS NULL)<>(location_kg IS NULL)),CHECK(scope1_kg>=0),CHECK(location_kg>=0),CHECK(market_kg>=0),CHECK(biogenic_kg>=0)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_allocations (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 record_id uuid NOT NULL,instrument_id uuid NOT NULL,quantity_kwh numeric(24,6) NOT NULL CHECK(quantity_kwh>0),
 UNIQUE(tenant_id,record_id,instrument_id),FOREIGN KEY(tenant_id,record_id) REFERENCES cs.u_c_records(tenant_id,id),
 FOREIGN KEY(tenant_id,instrument_id) REFERENCES cs.u_c_instruments(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_voids (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),
 record_id uuid NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','APPROVED','REJECTED')),
 approved_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 CHECK(approved_by IS NULL OR approved_by<>created_by),FOREIGN KEY(tenant_id,record_id) REFERENCES cs.u_c_records(tenant_id,id),
 FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);
CREATE TABLE cs.u_c_actions (
id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES cs.tenants(id),

 period_id uuid NOT NULL,campus_id uuid NOT NULL,source_id uuid,title text NOT NULL,severity text NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 owner_id uuid NOT NULL,due_date date NOT NULL,description text NOT NULL,evidence_ids jsonb NOT NULL DEFAULT '[]',resolution text,resolved_by uuid,closed_by uuid,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED','CLOSED')),version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL, FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES cs.u_c_sources(tenant_id,id),FOREIGN KEY(tenant_id,owner_id) REFERENCES cs.users(tenant_id,id),
 FOREIGN KEY(tenant_id,resolved_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,closed_by) REFERENCES cs.users(tenant_id,id),
 CHECK(closed_by IS NULL OR closed_by<>resolved_by)
,
created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), UNIQUE(tenant_id,id)
);

CREATE UNIQUE INDEX u_c_one_draft_boundary ON cs.u_c_boundaries(tenant_id,period_id) WHERE status='DRAFT';
CREATE UNIQUE INDEX u_c_one_active_void ON cs.u_c_voids(tenant_id,record_id) WHERE status IN ('SUBMITTED','APPROVED');
CREATE INDEX u_c_records_period ON cs.u_c_records(tenant_id,period_id,status,source_id);
CREATE INDEX u_c_records_source_dates ON cs.u_c_records(tenant_id,source_id,interval_start,interval_end);
CREATE INDEX u_c_instruments_period ON cs.u_c_instruments(tenant_id,period_id,status);
CREATE INDEX u_c_allocations_instrument ON cs.u_c_allocations(tenant_id,instrument_id);
CREATE INDEX u_c_actions_due ON cs.u_c_actions(tenant_id,period_id,status,due_date);
ALTER TABLE cs.u_targets ADD COLUMN scope2_basis text NOT NULL DEFAULT 'LOCATION' CHECK(scope2_basis IN ('LOCATION','MARKET'));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['u_c_sources','u_c_boundaries','u_c_period_modes','u_c_factors','u_c_instruments','u_c_records','u_c_calculations','u_c_allocations','u_c_voids','u_c_actions'] LOOP

  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE INDEX %I ON cs.%I(tenant_id,created_at DESC,id DESC)',t||'_page',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON cs.%I TO cs_api',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['u_c_sources','u_c_period_modes','u_c_calculations','u_c_allocations'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON cs.%I FOR EACH ROW EXECUTE FUNCTION cs.deny_change()',t);
  EXECUTE format('REVOKE UPDATE ON cs.%I FROM cs_api',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['u_c_boundaries','u_c_factors','u_c_instruments','u_c_records','u_c_voids'] LOOP
  EXECUTE format('CREATE TRIGGER approved_immutable BEFORE UPDATE OR DELETE ON cs.%I FOR EACH ROW EXECUTE FUNCTION cs.u_approved_immutable()',t);
 END LOOP;
END $$;
GRANT SELECT ON cs.u_c_period_modes TO cs_worker;
-- Serialize activation with old-ledger writes using the same tenant/period key.
CREATE FUNCTION cs.c_legacy_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.scope IN ('SCOPE_1','SCOPE_2') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':university:scope12-period:'||NEW.period_id::text,0));
  IF EXISTS(SELECT 1 FROM cs.u_c_period_modes WHERE tenant_id=NEW.tenant_id AND period_id=NEW.period_id) THEN
   RAISE EXCEPTION 'Enhanced Scope 1/2 is active: use the carbon source ledger for this period' USING ERRCODE='23514';
  END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER carbon_mode_guard BEFORE INSERT OR UPDATE ON cs.activities FOR EACH ROW EXECUTE FUNCTION cs.c_legacy_mode_guard();
CREATE TRIGGER carbon_mode_guard BEFORE INSERT OR UPDATE ON cs.u_emissions FOR EACH ROW EXECUTE FUNCTION cs.c_legacy_mode_guard();
CREATE FUNCTION cs.c_activate_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':university:scope12-period:'||NEW.period_id::text,0));
 IF EXISTS(SELECT 1 FROM cs.activities WHERE tenant_id=NEW.tenant_id AND period_id=NEW.period_id AND status<>'REJECTED') OR
    EXISTS(SELECT 1 FROM cs.u_emissions WHERE tenant_id=NEW.tenant_id AND period_id=NEW.period_id AND scope IN ('SCOPE_1','SCOPE_2') AND status<>'REJECTED') THEN
  RAISE EXCEPTION 'Legacy Scope 1/2 records exist; activate in a clean period or perform a reviewed migration' USING ERRCODE='23514';
 END IF; RETURN NEW; END $$;
CREATE TRIGGER activate_guard BEFORE INSERT ON cs.u_c_period_modes FOR EACH ROW EXECUTE FUNCTION cs.c_activate_mode_guard();
-- Active rows preserve voided calculations in storage but exclude them from totals.
CREATE VIEW cs.u_c_active WITH (security_invoker=true) AS
 SELECT c.*,r.period_id,r.source_id,r.campus_id,r.kind,r.scope,r.quantity,r.unit,r.interval_start,r.interval_end,r.data_quality,
 jsonb_array_length(r.evidence_ids) AS evidence_count
 FROM cs.u_c_calculations c JOIN cs.u_c_records r ON r.tenant_id=c.tenant_id AND r.id=c.record_id
 WHERE r.status='CALCULATED' AND NOT EXISTS
 (SELECT 1 FROM cs.u_c_voids v WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.status='APPROVED');
CREATE OR REPLACE VIEW cs.u_inventory WITH (security_invoker=true) AS
 SELECT c.id,c.tenant_id,a.id AS record_id,a.period_id,a.campus_id,a.activity_date,a.category,a.scope,
 NULL::integer AS scope3_category,a.quantity,a.unit,c.kg_co2e,
 'CORE'::text AS ledger,'UNCLASSIFIED_CORE'::text AS data_quality,c.provenance,
 CASE WHEN a.document_id IS NULL THEN 0 ELSE 1 END::integer AS evidence_count
 FROM cs.calculations c JOIN cs.activities a ON a.tenant_id=c.tenant_id AND a.id=c.activity_id WHERE a.status='CALCULATED'
 UNION ALL
 SELECT c.id,c.tenant_id,a.id,a.period_id,a.campus_id,a.activity_date,a.category,a.scope,a.scope3_category,a.quantity,a.unit,c.kg_co2e,
 'UNIVERSITY'::text,a.data_quality,c.provenance,jsonb_array_length(a.evidence_ids)
 FROM cs.u_calculations c JOIN cs.u_emissions a ON a.tenant_id=c.tenant_id AND a.id=c.emission_id
 WHERE a.status='CALCULATED' AND NOT EXISTS
 (SELECT 1 FROM cs.u_voids v WHERE v.tenant_id=a.tenant_id AND v.emission_id=a.id AND v.status='APPROVED')
 UNION ALL
 SELECT c.id,c.tenant_id,c.record_id,c.period_id,c.campus_id,c.interval_end,c.kind,c.scope,NULL::integer,c.quantity,c.unit,
 COALESCE(c.scope1_kg,c.location_kg)::numeric(38,6),'CARBON_SCOPE12'::text,c.data_quality,c.provenance,c.evidence_count FROM cs.u_c_active c;
GRANT SELECT ON cs.u_c_active,cs.u_inventory TO cs_api;
REVOKE ALL ON FUNCTION cs.c_legacy_mode_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION cs.c_activate_mode_guard() FROM PUBLIC;

ALTER TABLE cs.u_c_boundaries ADD CONSTRAINT c_boundaries_approval_state CHECK ((status='APPROVED')=(approved_by IS NOT NULL));

ALTER TABLE cs.u_c_factors ADD CONSTRAINT c_factors_approval_state CHECK ((status='APPROVED')=(approved_by IS NOT NULL));

ALTER TABLE cs.u_c_instruments ADD CONSTRAINT c_instruments_approval_state CHECK ((status='APPROVED')=(approved_by IS NOT NULL));

ALTER TABLE cs.u_c_records ADD CONSTRAINT c_records_approval_state CHECK ((status='CALCULATED')=(approved_by IS NOT NULL));

ALTER TABLE cs.u_c_voids ADD CONSTRAINT c_voids_approval_state CHECK ((status='APPROVED')=(approved_by IS NOT NULL));
