---
name: be-reports
description: Use when working on backend reporting - Report Builder SQL that returns wrong rows/counts or is "not supported", report schema/collection catalog, saved reports and who can see them, CSV export, Postgres reports (pg-sqlquery), report-sync / stale Postgres data / adding a synced table or column, dashboard count cards, or fixed reports such as TAT, clinical, lab or counselling reports.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Reports

Guards and test-first rules for `src/report` are in `rules/backend-report.md`. Docs: `docs/dynamic-report-api.md`, `docs/care-setting-data-flow.md`, `script/report-schema-apis.md`.

## Where things live

| Need | Code |
|---|---|
| Report routes (`patient-service/report`) | `src/report/report.controller.ts` (~4.7k lines) |
| SQL -> Mongo | `src/functions/sqltomongoquery.ts` (`sqlToMongoForReport`), spec `sqltomongoquery.spec.ts` (runs pipelines with `mingo`) |
| Saved-report visibility | `src/report/report-query-access.service.ts` (+ spec) |
| Postgres path | `report-postgres-query.service.ts`, `report-postgres-schema.service.ts` (`POSTGRES_REPORT_SCHEMA = 'public'`) |
| Fixed reports | `report.service.ts`, `report.controller.ts` (clinical, lab, surgery/admission advise, counselling), `src/emr/patientemr.controller.ts` (`getTatReport`, `get-doctor-emrUses-report`) |
| Mongo -> Postgres mirror | `src/report-sync/*` |
| Indexes | `scripts/report-indexes.mongodb.js` (mongosh, `APPLY=true` to write), `scripts/report-indexes.postgres.sql` |

## Mongo SQL builder flow

1. **Catalog**: `POST save-schema/:tenant_id` samples every collection not `isReportCollectionBlocked` and stores field paths, `array_paths`, versioned paths in `SCHEMA`. Bump `REPORT_SCHEMA_SHAPE_VERSION` (top of the controller) when recording more. `GET get-collection-schema/:tenant_id` adds aliases and webpart labels.
2. **Run**: `POST Sqlquery/:tenant_id` (`reportquery`): `sql` or UI `parts`, `page`, `limit`, `dateField/dateTable/dateFrom/dateTo`, `parts.topN`, `exportCsv`. `resolveReportAggregationInput` -> `sqlToMongoForReportQuery` -> `prependTenantFilter` (`$match: { tenant_id }` first) -> `runPaginatedReportAggregation` (`pageBeforeJoins` cuts the page on the base collection before `$lookup` when joins keep one row per base row; else `$facet` rows + count). CSV drops skip/limit.
   - `POST Sqlquerys/:tenant_id` is an older runner (`reportquerys`, plain `sqlToMongo`, no paging or date filter, CSV via a temp file). Check which one the screen calls before fixing.
3. Joined collections are scoped in `$lookup` to `tenant_id: { $in: [tenantId, null] }` (shared docs without a tenant are visible).

Converter behaviour worth knowing: short clinical names resolve to `EMR_<NAME>` (`resolveLookupCollectionName`); arrays on a path are unwound outermost first (`data` always an array); version arrays read the latest published version; base duplicates collapse to latest `created_on` (`buildRootDedupStages`); `*` in names (`medicine_name*id`) is backtick-quoted by `quoteNestedFieldPaths`; ORDER BY capped at 32 keys; a `YYYY-MM-DD` literal covers the whole UTC day.

Guards: `REPORT_BLOCKED_COLLECTIONS` (`LOGIN_SESSIONS`, `LOGIN_ACTIVITY_LOGS`, `OTP_COLLECTION`, `SSO_REPLAY_TOKEN`, `PASSWORD_POLICY`, `TENANT_SETUP`, `AI_CONFIGURATION`, `NOTIFICATION_VENDOR_SERVICE_CONFIG`, `SCHEMA`), `system.*`, name pattern TOKEN/OTP/PASSWORD/SECRET/CREDENTIAL/API_KEY; `isReportSensitiveFieldPath` (`password*`, `passwd`, `pwd`, `secret`, `api_key`, `otp` segments); `$` segments rejected. A new collection with secrets must be added to the blocked set.

### Changing the converter

1. Failing case in `sqltomongoquery.spec.ts` first.
2. WHERE placement (`splitWhereConditions`): base conditions before joins, joined after their `$lookup`, array conditions after the deepest unwind they read.
3. Grouped reports unwind only what they select/group (unwinding changes COUNT).
4. `npx jest src/functions/sqltomongoquery.spec.ts src/report`.

## Saved reports and access

- `savequery/:tenant_id`: `name`, `group_name`, `report_category`, roles required; name unique per group + category (case/space-insensitive). Also `updatequery/:tenant_id/:query_id`, `deletequery` (soft), `GetSqlquery`, `list-sql-queries`, `report-categories`, `migrate-query-roles` (one-off).
- Roles: `ReportQueryAccessService.resolveRolesFromBody` accepts `roles` (`[{role_id}]` or ids), `role_id`, or legacy `provider_type` (role name), validated against tenant roles; `provider_type` is still written for old clients.
- Visibility: admins see all; others by login role, or `?role_id=` if they hold that role.

## Postgres path

- `get-postgres-schema`, `refresh-postgres-schema` (tenant table list cached ~5 min), `pg-sqlquery/:tenant_id` (`ReportPostgresQueryService`).
- Parsed with `node-sql-parser`: one SELECT, no user `WITH`; every referenced table is shadowed by a CTE `"<t>" AS (SELECT * FROM public."<t>" WHERE tenant_id = $1)`; `ALLOWED_FUNCTIONS` allow-list (blocks `dblink`, `query_to_xml`); text amounts cast for SUM/AVG/comparisons; 30 s statement timeout; limit max 5000.
- Only tables in `public` with a `tenant_id` column are visible: report-sync tables and billing-service tables.

## Report sync (Mongo -> Postgres)

Enabled only with `REPORT_SYNC_ENABLED=true`. Needs a Mongo replica set (else status `unsupported`).

- `SYNC_SOURCES` (`report-sync.schema.ts`): `PATIENT_REGISTRATION_DB` -> `public.patient_registration` (PK `tenant_id, registration_id`), `IP_PATIENT_VISIT` -> `public.patient_admission` (PK `tenant_id, visit_id`). Bookkeeping in schema `report_sync`.
- `ReportSyncListener`: leader via `pg_try_advisory_lock(hashtext('report_sync_leader'))`, re-checked every 60 s; leader runs `ensureSchema` and one change stream per Mongo cluster (insert/update/replace/delete). Resume token saved only after Postgres accepts; idle streams persist `postBatchResumeToken`.
- `ReportSyncService.applyChange` -> `mapSourceDocument` -> upsert/delete. `isDataError` (Postgres codes 22/23/42): the listener parks after `MAX_DATA_ERROR_ATTEMPTS`; batch resync retries row by row and parks bad rows (`recordError`).
- `ReportSyncScheduler`: reconcile every 15 min, full resync 02:00, monitor every 5 min.
- Routes `patient-service/report-sync`: `GET health/:tenant_id`, `GET resync-status/:tenant_id`, `POST resync/:tenant_id?mode=`, `POST replay-errors/:tenant_id`.

### Adding a synced table or column

1. `report-sync.schema.ts`: define the `SyncTable` (snake_case; include `tenant_id`, `mongo_id`, `is_deleted`, `created_on`, `updated_on`; PK starts with `tenant_id`), add it to `SYNC_SOURCES`, add `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `SCHEMA_DDL`.
2. `report-sync.mapper.ts`: write `map<Thing>(doc)` with `toText` (handles `{label,value}` and arrays), `toBool`, `toDate` (YYYY-MM-DD, DD/MM/YYYY, ISO, Date), `toTimestamp`; return `null` to skip; register it in `MAPPERS`.
3. Indexes in `scripts/report-indexes.postgres.sql`.
4. Backfill one tenant: `npx ts-node -r tsconfig-paths/register scripts/report-sync-backfill.ts --tenant-schema=<DB>` (writes to the Postgres in `.env`; safe to re-run). Compare `countRows` with Mongo, then `POST refresh-postgres-schema/:tenant_id`.

## Dashboards and count cards (not the SQL builder)

| Thing | Where |
|---|---|
| Count card definitions (`COUNT_CONFIG`) | `tenant-service/task-configuration/create-count-config`, `get-count-config` |
| OP card values | `tenant-service/dashboard/get-dashboard-count/:tenant_id/:dashboard_type` (`src/dashboard/dashboard.controller.ts`) |
| IP card values | `inpatient-service/ip-emr/get-ip-visit-count/:tenant_id/:count_config_id?` (`ipemr.controller.ts`) |
| Dashboard layout (`DASHBOARD_CONFIG`) | `save-dashboard-config/:tenant_id`, `get-count-config-list` in `dashboard.controller.ts` |
| Pharmacy/nursing cards | `inpatient-service/activity-dashboard/get-dashboard-counts/:tenant_id` |

"Add a column to the TAT report" means editing that fixed report, not `sqltomongoquery.ts`.

## Performance

Every pipeline starts with `$match: { tenant_id }`, so `{ tenant_id: 1, created_on: -1 }` matters most; add indexes through the two scripts.
