---
paths:
  - "akhil_systems_backend/src/report/**"
---

> Backend area guide (`akhil_systems_backend/src/report`). Paths are relative to `akhil_systems_backend/`.

# src/report

- `report.controller.ts` (`patient-service/report`): schema catalog (`save-schema`, `get-collection-schema`), report execution (`Sqlquery` -> `src/functions/sqltomongoquery.ts`), saved reports with role access (`report-query-access.service.ts`), Postgres path (`pg-sqlquery`, `report-postgres-query.service.ts`), plus bespoke clinical/lab/admission/counselling reports (`report.service.ts`).
- Change SQL conversion test-first in `src/functions/sqltomongoquery.spec.ts`. Keep the WHERE placement rules (base before joins, joined after `$lookup`, array conditions after their unwind).
- Never weaken `REPORT_BLOCKED_COLLECTIONS`, the sensitive-field filter, or the Postgres function allow-list / tenant CTEs.
- Every pipeline must start with the tenant filter (`prependTenantFilter`).
- Docs: `docs/dynamic-report-api.md`, `docs/care-setting-data-flow.md`. Skills: `be-reports`.
