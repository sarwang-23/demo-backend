export const INGESTION_TABLES=Object.freeze({
 u_i_batches:'id tenant_id period_id name kind target status close_reason version created_by created_at',
 u_i_files:'id tenant_id batch_id document_id generation plan status skip_reason version created_by created_at',
 u_i_rows:'id tenant_id batch_id file_id generation ordinal target source_ref raw_values normalized issues target_payload dedupe_key status review_reason reviewed_by carbon_record_id submission_id emission_id version created_by created_at',
 u_i_templates:'id tenant_id name kind target plan version created_by created_at'
});
export const INGESTION_JSON=['plan','source_ref','raw_values','normalized','issues','target_payload'];
