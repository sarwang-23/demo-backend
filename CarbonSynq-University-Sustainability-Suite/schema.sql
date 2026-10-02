CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_version VALUES (1, CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS universities (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, location TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL CHECK(role IN ('ORGANISATION_ADMIN','DATA_ENTRY','REVIEWER','MANAGEMENT')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL,
  UNIQUE(id,university_id)
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campuses (id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), name TEXT NOT NULL, code TEXT NOT NULL, UNIQUE(id,university_id), UNIQUE(university_id,code));
CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, university_id TEXT NOT NULL, campus_id TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(id,university_id), FOREIGN KEY(campus_id,university_id) REFERENCES campuses(id,university_id));
CREATE TABLE IF NOT EXISTS reporting_periods (id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPEN','LOCKED')), UNIQUE(id,university_id), CHECK(start_date <= end_date));
CREATE TABLE IF NOT EXISTS emission_factors (id TEXT PRIMARY KEY, category TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')), unit TEXT NOT NULL, value REAL NOT NULL CHECK(value>0), version TEXT NOT NULL, source TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL, file_size INTEGER NOT NULL CHECK(file_size>0 AND file_size<=10485760), sha256 TEXT NOT NULL,
  content BLOB NOT NULL, status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','LINKED')),
  extraction_json TEXT NOT NULL, reviewed_json TEXT, invoice_key TEXT, uploaded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(id,university_id), UNIQUE(university_id,sha256), UNIQUE(university_id,invoice_key),
  FOREIGN KEY(uploaded_by,university_id) REFERENCES users(id,university_id)
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), period_id TEXT NOT NULL,
  campus_id TEXT NOT NULL, building_id TEXT, category TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')), quantity REAL NOT NULL CHECK(quantity>0 AND quantity<=1000000000),
  unit TEXT NOT NULL, activity_date TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  input_source TEXT NOT NULL CHECK(input_source IN ('MANUAL','INVOICE')), document_id TEXT UNIQUE,
  amount_inr REAL CHECK(amount_inr>=0), vendor TEXT, invoice_number TEXT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','REJECTED','CALCULATED')),
  entered_by TEXT NOT NULL, verified_by TEXT, rejection_reason TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(id,university_id),
  FOREIGN KEY(period_id,university_id) REFERENCES reporting_periods(id,university_id),
  FOREIGN KEY(campus_id,university_id) REFERENCES campuses(id,university_id),
  FOREIGN KEY(building_id,university_id) REFERENCES buildings(id,university_id),
  FOREIGN KEY(document_id,university_id) REFERENCES documents(id,university_id),
  FOREIGN KEY(entered_by,university_id) REFERENCES users(id,university_id),
  FOREIGN KEY(verified_by,university_id) REFERENCES users(id,university_id)
);
CREATE TABLE IF NOT EXISTS calculations (
  id TEXT PRIMARY KEY, university_id TEXT NOT NULL, activity_id TEXT NOT NULL UNIQUE,
  factor_id TEXT NOT NULL REFERENCES emission_factors(id), quantity REAL NOT NULL, factor_value REAL NOT NULL,
  kg_co2e REAL NOT NULL CHECK(kg_co2e>=0), factor_version TEXT NOT NULL, factor_source TEXT NOT NULL, calculated_at TEXT NOT NULL,
  FOREIGN KEY(activity_id,university_id) REFERENCES activities(id,university_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES universities(id), user_id TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, request_id TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,university_id) REFERENCES users(id,university_id)
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit entries cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit entries cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id), route TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  result_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,route,request_key)
);
CREATE INDEX IF NOT EXISTS activities_tenant_period ON activities(university_id,period_id,status);
CREATE INDEX IF NOT EXISTS activities_tenant_date ON activities(university_id,activity_date);
CREATE INDEX IF NOT EXISTS audit_tenant_time ON audit_logs(university_id,created_at);
CREATE INDEX IF NOT EXISTS documents_tenant_time ON documents(university_id,created_at);
