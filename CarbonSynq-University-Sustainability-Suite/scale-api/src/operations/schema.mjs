/** SQL identifier allowlist for migration 005. Credential/mail secrets are never in it. */
export const OPS_TABLES = Object.freeze({
  u_o_memberships: 'id tenant_id user_id campus_id department_id active version created_by created_at',
  u_o_document_scopes: 'id tenant_id document_id campus_id department_id visibility hold_until hold_reason version created_by created_at',
  u_o_document_grants: 'id tenant_id document_id user_id active version created_by created_at',
  u_o_notifications: 'id tenant_id user_id kind entity_id title message dedupe_key read_at email_queued created_at',
  u_o_preferences: 'id tenant_id user_id email_enabled reminders_enabled version created_at',
  u_o_exports: 'id tenant_id period_id period_version title format status row_count byte_count sha256 object_key object_version totals error_code created_by approved_by approval_reason version created_at',
  u_o_ocr_runs: 'id tenant_id document_id document_version status input_sha256 previous_extraction result_summary error_code created_by version created_at',
  u_o_reassignments: 'id tenant_id kind target_id before_state after_state reason created_by created_at'
});
export const OPS_JSON = ['totals', 'before_state', 'after_state', 'previous_extraction', 'result_summary'];
