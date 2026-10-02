# Executable example and request examples

`npm run carbon:demo` executes `synthetic-workflow.mjs` through the actual domain services and an explicitly isolated memory test double. It uses no external credentials, real invoice storage, PostgreSQL or cloud resource, and never mutates your application database. Outputs are synthetic, not approved regional factors.

For a real API use the reviewed OpenAPI specification at `docs/carbon/openapi.json`. All new routes are under `/api/v2/university/carbon`. Login through the existing `/api/v2/auth/login` with the tenant ID and credentials printed by fresh-tenant provisioning. A source or evidence ID must come from your authenticated tenant, not a placeholder copied from these examples.

The companion `requests.http` contains read/preview requests and a manual-entry request template for editor REST clients. Fill the variables and method-specific JSON, use fresh idempotency keys for distinct logical operations, and use the returned record version. Factor and boundary approvals require a different user. Review the actual source quantities and evidence before submission.

Preview creates no record and reserves no certificate capacity. A successful preview is not a guarantee a later approval will succeed after concurrent changes.
