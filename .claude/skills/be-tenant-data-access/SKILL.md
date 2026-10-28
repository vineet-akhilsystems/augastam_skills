---
name: be-tenant-data-access
description: Use when backend code reads or writes MongoDB through MongoDBService, picks a helper (findByQuery, paginate, findOneAndUpdate...), needs a counter, or a bug sounds like "wrong tenant", "data in the control DB", "not found", "duplicate number"; also when adding a tenant option/flag (TENANT_SETUP, Tenant type, tenantCheck) or touching facility license limits.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Tenant-safe data access and tenant settings

The one-DB-per-tenant rule, `tenant_schema` on every call and document conventions are in the backend guide. This adds what you need to act on them.

## Where the schema comes from

| Context | `dbName` argument |
|---|---|
| Protected route | `tenantCheck?.tenant_schema` (from `TenantMiddleware`) |
| Cron / script | loop `TENANT_SETUP` (`isDeleted: { $ne: true }`), use `tenant.tenant_schema` |
| Only a tenant id | `findByUniqueValue(TABLE_NAMES.TENANT_SETUP, 'tenant_id', id)` (no `dbName` = control DB) |

`resolveDb` looks the schema up in `TENANT_CLUSTER_MAP` (`config/tenantClusterMapping.config.ts`); every network maps only `DEFAULT -> MONGO_URL`, so all tenants currently share one client.

## Which helper (`src/functions/MongoDBService.ts`)

| Need | Call | Notes |
|---|---|---|
| Filters/joins | `findByQuery(coll, pipeline, db)` | aggregation, `allowDiskUse` |
| Plain filter | `findMany(coll, filter, db)` / `findOne(coll, filter, db)` / `findByUniqueValue(coll, field, value, db)` | |
| Page of results | `paginate(coll, pipeline, page, limit, db, session, getTotal)` | `{ data, extra: { page, limit, total, totalPages } }` |
| (avoid) | `findByQueryPaginate` | loads all, slices in memory |
| Insert | `createItem` (returns `{ ...insertResult, ...doc }`), `createItemMany`, `bulkCreateItems` (unordered) | |
| `$set` | `updateItem(coll, key, value, set, db)` (`'_id'` -> ObjectId), `updateItemQuery(coll, filter, set, db)` | |
| Other operators | `addItemQuery(coll, filter, updateDoc, db)` | full update doc |
| Atomic claim/counter | `findOneAndUpdate(coll, filter, update, db, options)` | |
| Upsert | `upsertItem(coll, filter, data, db)` | `$set` + `$setOnInsert.created_on` |
| Bulk | `bulkUpdateOrCreate(coll, ops, db)` | `bulkWrite` |
| Latest published version | `getLatestVersionData(coll, filter, db)` | see `be-builder-config` |
| Streams | `aggregateCursor(coll, pipeline, schema)`, `getDataStream(coll, filter, db)` | large exports |

## Traps

- `TABLE_NAMES` keys can differ from values: `PATIENT_REGISTRATION` -> `PATIENT_REGISTRATION_DB` (also `_PRE`, `PATIENT_ATTACHMENTS`).
- Webpart collections: `db_obj_name` is stored as typed (spaces -> `_`); readers use `db_obj_name.toUpperCase()`. Normalise with `.trim().toUpperCase()`.
- Dates are mixed (`Date`, epoch ms, ISO, `DD-MM-YYYY`). Check the writer before comparing.
- Never spread a request body into `$match`; pick fields.
- New counters: `findOneAndUpdate(coll, filter, { $inc: { counter: 1 } }, db, { upsert: true, returnDocument: 'after' })`. `generateAutogenerateNumber` reads then writes, and `counter + 1` string-concatenates when the stored counter is a string.
- Config modules (menu, organogram, search builder) rewrite the whole tenant `data[]` with `updateItem`; concurrent saves overwrite each other. New code: positional `$set: { 'data.$[x]...': ... }` with `arrayFilters`.
- `startSession()` uses the default client only; a transaction will not cover a tenant on another cluster.
- Pipelines start with `$match` on `tenant_id` + indexed key (existing report indexes: `scripts/report-indexes.mongodb.js`). `$lookup` stays inside the tenant DB.
- `findByUniqueValue` and `findOne` add no `isDeleted` filter; add it yourself.

## Tenant record (`TENANT_SETUP`, control DB)

- Type: `Tenant` in `src/middlewares/types/tenant.ts`. `TenantMiddleware` (`tenantCheck.middleware.ts`) takes the id from `params.tenant_id`, `body.tenant_id`, `params.id`, `body.id`, `query.tenant_id`, `query.id`, matches it case-insensitively and does **not** check `isDeleted`.
- Fields in use: `tenant_schema`, `bucketName`, `cloudProvider.code` (`AWS` default, `GCP`, `AZURE`, `BHARATHCLOUD`, `MINIO`, `CUSTOM_S3`), `autogenerate`, `tariff`, `default_workflow_id`, `version_display_number`, `isSuperTenant`, `promoted_tenant_id`, `isNotificationEnabled`, `isChatServiceEnabled`, `multiple_booking`, `brandGenericMapping`, `exportData`, Kafka flags `isEMR_Producer/Consumer`, `isAppointment_Producer/Consumer` (the type misspells `isAppointmenr_Producer`; code reads `isAppointment_Producer`).
- Frontend reads the whole record from `GET authorization-service/authorization/get-current-tenant/:tenant_id?` (frontend side: `fe-tenant-flag`).

### Add a tenant option/flag

1. Add it to the `Tenant` interface.
2. `create-tenant` (`authorization.controller.ts`, ~line 300): add it to the explicit tenant literal (`isChatServiceEnabled: data?.isChatServiceEnabled || false` is the pattern).
3. `update-tenant/:tenant_id` (~line 780): fields are copied one by one (`tenantDetails.x = userData?.x ?? tenantDetails?.x ?? <default>`); add yours or it is silently dropped.
4. Read `tenantCheck?.x` in handlers with a default. No migration for an optional flag.
5. Promotion does not copy tenant flags (it only sets `isPromoted` on the target); set them in each environment.

### Tenant endpoints (`authorization-service/authorization`)

`create-tenant`, `update-tenant/:tenant_id`, `delete-tenant` (soft), `get-all-tenants`, `search-tenant/:tenant_id`, `get-current-tenant/:tenant_id?`, `get-all-tenants-info`, `create-super-tenant`, `check-tenant-schema-available`, `create-index/:tenant_id`, `sync-tenant/:tenant_id`, `clone-tenant/:source/:target`, `validate-tenant/:tenant_id`, `save-tenant-notification-configuration/:tenant_id`, facilities: `create-facility`, `edit-facility/:facility_id`, `delete-facility/:tenant_id`, `get-facility/:tenant_id`, `search-facility/:tenant_id`. Promotion routes: `be-builder-config`.

Safety: tenant deletion is soft; never call `MongoDBService.deleteDatabase` from an HTTP path. Cross-tenant reads only in super-tenant/admin flows (`user.isAdmin`/`isSuperAdmin`, tenant `isSuperTenant`).

## Facility licenses (`src/facility-license/`)

- Facilities live in one `FACILITY_MASTER` doc per tenant DB, `data[]`; `FacilityLicenseService.getFacility` finds by `facility_id`.
- Limits on the facility: `allowed_user_count`, `role_user_limits[]`, `allowed_bed_count`, `license_expiry_date`, `license_alert_days_before_expiry`. Missing limit = unlimited.
- Checks: `checkUserLimit`, `checkLoginUserLimit`, `checkEmployeeRoleLimit` (employee create/update), `checkLoginRoleLimit` (login), `checkBedLimit` (ip-emr), `isPastLoginGrace` (`LICENSE_LOGIN_GRACE_DAYS = 5`). Call the matching one before creating users/employees/beds; import `FacilityLicenseModule`.
- `FacilityLicenseScheduler` (`EVERY_DAY_AT_2AM`) sends expiry warnings.
- `resolveFacilityIsIndia` (`src/functions/facilityCountry.ts`) reads the facility country (AI region); never throws.
