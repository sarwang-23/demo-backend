/** Compile-time SQL identifiers only. Keep in sync with migration 003. */
export const CARBON_TABLES=Object.freeze({
  "u_c_sources": "id tenant_id campus_id building_id department_id owner_id code name kind scope substance unit region facility_type active_from active_to description ownership_version created_by created_at",
  "u_c_boundaries": "id tenant_id period_id revision campus_ids campus_exclusions approach statement base_year recalculation_policy scope2_mode scope2_rationale sources screening evidence_ids status approved_by rejection_reason version created_by created_at",
  "u_c_period_modes": "id tenant_id period_id boundary_id activated_by created_at",
  "u_c_factors": "id tenant_id name kind substance unit use components gwp_basis source source_url region boundary version_label valid_from valid_to zero_reason status approved_by rejection_reason version created_by created_at",
  "u_c_instruments": "id tenant_id period_id name kind registry serial serial_key beneficiary region quantity_kwh valid_from valid_to vintage_from vintage_to retired_on factor_id quality_checks evidence_ids status approved_by rejection_reason version created_by created_at",
  "u_c_records": "id tenant_id period_id source_id boundary_id campus_id kind scope unit interval_start interval_end external_key description quantity_input quantity factor_id market_allocations fallback_factor_id fallback_reason evidence_ids data_quality assumptions zero_reason replaces_id status approved_by rejection_reason version created_by created_at",
  "u_c_calculations": "id tenant_id record_id scope1_kg location_kg market_kg biogenic_kg provenance created_at",
  "u_c_allocations": "id tenant_id record_id instrument_id quantity_kwh created_at",
  "u_c_voids": "id tenant_id period_id record_id reason status approved_by rejection_reason version created_by created_at",
  "u_c_actions": "id tenant_id period_id campus_id source_id title severity owner_id due_date description evidence_ids resolution resolved_by closed_by status version created_by created_at"
});
export const CARBON_JSON=["campus_ids", "campus_exclusions", "sources", "screening", "components", "quality_checks", "quantity_input", "market_allocations"];
