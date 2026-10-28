---
name: be-api-change
description: Use when a backend REST route, handler, controller or module is added or changed, a feature needs a new folder under src/ or a new MongoDB collection, a write endpoint needs Audit Trail entries (@Audit, req.__audit), or someone gives a URL like /patient-service/emr/... and asks where its handler lives or why it is public.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Add or change an API route, module or collection

The request flow, auth binding and response conventions are in the backend guide (`.claude/rules/backend.md`); this is the build checklist.

## Reference modules

| Shape | Copy | How it differs |
|---|---|---|
| Controller-only, logic inline | `src/step-master/` | Route list as a `const`, filter listed in `providers`, `@Audit` + `req.__audit` on writes. Its `$regex` on `step_name` (~line 115, ~227) is unescaped: don't copy that. |
| Controller -> service | `src/cancer-screening/` | Smallest split. Filter not in `providers`; the service doesn't set `error.reference_id`, so add it. |

Not as references: `src/rule-master/` (regex from unescaped input), `src/package-configuration/` and `src/ai-configuration/` (module doesn't implement `NestModule`; filter returns `statusCode: status` instead of the house `500`).

## Handler

```ts
@Put(':tenant_id/:step_id')
@Audit({ ...AUDIT_ENTITIES.STEP_MASTER, action: 'update-step-master' })   // writes only
@ApiOperation({ summary: '...' }) @ApiResponse({ status: 200, description: '...' })
async update(@Body() reqBody: any, @Param('tenant_id') tenant_id: string, @Param('step_id') step_id: string, @Req() req?: any) {
  const { tenantCheck, user, ...body } = reqBody;
  try {
    if (!body.step_name) return { statusCode: 400, message: 'Step name is required' };
    const before = await this[DBService].findOne(TABLE_NAMES.STEP_MASTER, { tenant_id, step_id, isDeleted: { $ne: true } }, tenantCheck?.tenant_schema);
    if (!before) return { statusCode: 404, message: 'Not found' };
    const after = { step_name: body.step_name /* named fields only, never ...body */, updated_by: user?.email_id, updated_on: new Date() };
    await this[DBService].updateItemQuery(TABLE_NAMES.STEP_MASTER, { tenant_id, step_id }, after, tenantCheck?.tenant_schema);
    if (req) req.__audit = { reference_id: step_id, old_value: before, new_value: after };
    return { statusCode: 200, message: 'Updated' };
  } catch (error) { error.reference_id = step_id; throw error; }
}
```

- New docs: `<thing>_id: uuidv4()`, `tenant_id`, `isActive: true`, `isDeleted: false`, `created_by: user?.email_id`, `created_on`. Match the date type (`new Date()` vs `Date.now()`) already used in that collection.
- `this[DBService]` and `this.mongoDBService` are the same object (`DBService === 'mongoDBService'`); follow the file.
- Regex from input: `escapeForRegex` (`src/reference-lookup/pincode-lookup.util.ts`).
- Acting facility: `facility_id` (body/query) or `x-facility-id` header, never `user.facilities[0]`.
- Multipart (`FileInterceptor`): bind `AuthContextMiddleware` after Jwt/Tenant, read `authContextOf(req, reqBody)` (`src/document-extraction/auth-context.middleware.ts`).

## Route binding

Add every new route to the module's Jwt and Tenant lists: full path incl. controller base, exact `RequestMethod`.

- **Double-run trap:** same method + a literal route (`search/:tenant_id`) + a generic route (`:tenant_id/:id`) = JwtMiddleware runs twice, second run 401s. Use a literal prefix (`detail/:tenant_id/:id`). See the comments in `src/step-master/step-master.module.ts`, `src/process-master/process-master.module.ts`.
- **Declaration order:** `@Get(':tenant_id')` declared above `@Get(':id')` swallows it (`src/consumables/consumables.controller.ts`).
- **`-internal` routes** (`src/ip-emr/ipemr.module.ts`: `get-er-patient-data-internal`, `get-doctor-referral-info-internal`) use `WindowServerMiddleware` and are called by this backend (`AllVisitSummaryService`, `INPATIENT_SERVICE_BASE_URL`). Keep that pairing for new server-to-server routes.
- Other caller types (public booking, partners, lambdas): see `be-local-dev-and-auth`.

## URL prefix

`configuration-service` (builder/config, clinical masters: `diagnosis-master`, `infusion-sets`), `tenant-service` (billing/admin masters, staff, tasks: `tariff`, `payer`, `step-master`), `patient-service` (OP/patient), `inpatient-service` (IP), `billing-service`, `authorization-service` (identity/tenant). For a new master, use the prefix of its closest existing master and say which. No unprefixed controllers (`consumables` is legacy).

## New module

```
src/<feature>/<feature>.module.ts | .controller.ts | .service.ts | .filter.ts | dto/ | <feature>.service.spec.ts
```

- Filter: copy `src/step-master/step-master.filter.ts`, rename the class (unique; `src/facility-tagging/facility-tagging.filter.ts` wrongly declares `AiConfigurationFilter`) and the module name passed to `createErrorLog`. Controller gets `@UseFilters(<Feature>Filter)`.
- Module: `implements NestModule`, `configure()` binds Jwt + Tenant to a `<FEATURE>_ROUTES` const. `providers`: your service(s), `MongoDBService`, `DynamoDBService`, `ErrorLogsService` (`src/functions/error-logsService.ts`, injects the other two + `Logger`), `Logger`. Listing the filter is optional. `RedisModule` is `@Global`.
- Injecting `TaskEngineService`: import `TaskManagementModule`; `NotificationService`: `NotificationModule`; `IpEmrService`: `IpEmrModule`; `FacilityLicenseService`: `FacilityLicenseModule`.
- Register in `imports` of `src/app.module.ts` (missing = silently absent, like `ClinicModule`).

## New collection

1. `config/table-names.config.ts`: key in the `TableNames` interface **and** the `TABLE_NAMES` object.
2. Indexes per tenant DB, ensure-on-use like `FacilityTaggingService.createFacilityTaggingCollection`: `collectionExists` -> `createCollection` -> `createIndexes(coll, [{ key: { tenant_id: 1, <id>: 1 }, unique: true, name }...], schema)`, in try/catch that logs and continues. Existing tenants: `POST authorization-service/authorization/create-index/:tenant_id` or a script (`be-data-migration-script`).
3. Reports: Report Builder can read any tenant collection. Credentials/tokens/OTPs/keys: add to `REPORT_BLOCKED_COLLECTIONS` in `src/functions/sqltomongoquery.ts` (names matching `TOKEN|OTP|PASSWORD|SECRET|CREDENTIAL|API_KEY` segments are auto-blocked). Join names: `resolveLookupCollectionName` adds `EMR_` to short names. Postgres mirror: `be-reports`.
4. Config, not patient data? Decide whether it travels with clone/promotion (`be-builder-config`). Patient data never moves.
5. Facility-scoped master? Prefer `FACILITY_TAGGING` (`be-builder-config`).
6. Add an `AUDIT_ENTITIES` entry and `@Audit` the writes.

## Audit (`src/audit/`)

- `@Audit({ ...AUDIT_ENTITIES.X, action })`; `module`/`object` are stored as `module`/`Objectname` and drive the Audit Trail filters (`authorization-service/trail`).
- Recorded only when the returned `statusCode` is missing or < 400.
- Set `req.__audit = { reference_id, old_value, new_value, facility_id? }`. Without it `new_value` is the body minus `user`/`tenantCheck`, `old_value` is empty and `reference_id` is the tenant id.
- `performed_by` = `?user_id`, else `user.email_id`. Facility: `__audit.facility_id` -> body/query `facility_id` -> `body.facilityData.facility_id` -> token's first facility.
- The interceptor calls `void this.auditService.record(...)`: not awaited, and `record` swallows its own errors. Never `await` audit work in a handler.
- Strip secrets from `old_value`/`new_value` (`editUser` in `authorization.controller.ts` builds `safeOld`/`safeNew`).
- Legacy handlers write `TRAIL_TABLE` by hand; when converting, keep the same `module`/`Objectname` strings.

## Find the handler for a URL

```bash
grep -rnE "@Controller\(['\"]/?<service-prefix>/<base>" src   # several controllers can share a base; ignore commented-out ones
grep -n "@Put('<route-literal>" <controller file>              # method decorator + literal route
grep -n "<route-literal>" <same folder>/*.module.ts            # which middleware binds it
```

Then the delegated service method. For big files hand off to the `his-code-explorer` agent.

## Verify

```bash
node ../.claude/tools/check-route-auth.js src/<folder>   # new route must not be listed
npx tsc --noEmit -p tsconfig.json                         # compile check; leaves dist/ alone (be-pre-pr-check step 2)
npx jest src/<folder>
```

The PostToolUse hook also reports new unbound routes (baseline `../.claude/hooks/backend-route-auth-baseline.txt`). Specs: `be-write-spec`.
