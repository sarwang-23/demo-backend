-- Worker privilege hardening. Closes the password_hash exposure re-introduced by 005_operations.sql.
-- 005 granted blanket SELECT on cs.users to cs_worker, undoing the revoke in 001_core.sql.
-- The worker only needs the reset-link validity signal, so it now reads a counter
-- instead of the hash and holds column-level grants on non-secret columns only.
ALTER TABLE cs.users ADD COLUMN password_version integer NOT NULL DEFAULT 1;
-- Stamp existing RESET credentials with the user's current version so links issued before this
-- migration stay valid, and remain invalidated once the password changes.
ALTER TABLE cs.u_o_credentials ADD COLUMN password_version integer;
UPDATE cs.u_o_credentials c SET password_version=u.password_version FROM cs.users u
 WHERE u.tenant_id=c.tenant_id AND u.id=c.user_id AND c.password_version IS NULL;
REVOKE ALL ON cs.users,cs.sessions FROM cs_worker;
GRANT SELECT (id,tenant_id,email,name,role,active,created_at,email_verified_at,password_version) ON cs.users TO cs_worker;
