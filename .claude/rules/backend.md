---
paths:
  - "akhil_systems_backend/**"
---

> Workspace copy of the backend guide. Paths are relative to `akhil_systems_backend/`; run commands inside that folder. The route-auth checker is `../.claude/tools/check-route-auth.js` (run from `akhil_systems_backend/`).

# Backend guide: akhil_systems_backend

Augastam HIS/EMR backend (Akhil Systems): a multi-tenant hospital information system. NestJS 10 + TypeScript, ~245k lines in 84 modules under `src/`. MongoDB (native driver) is the system of record; Postgres holds report tables; Redis is wired for caching, locks and presence (but see "Things that bite"); notifications go through SQS, Kafka or a DB queue; Socket.IO for real time.

## Commands

```bash
npm install                     # README says yarn; the lockfile in use is package-lock.json
npm run start:dev               # watch mode; port comes from NETWORK (TEST 5002, DEMO 5001, DEV 5003, UAT 5004, PROD 5006)
npm run start:debug             # VS Code launch config "Systems Backend (Debug)" attaches to this
npx tsc --noEmit -p tsconfig.json   # compile check, writes nothing (~20s); use this to verify changes
npm run build                   # nest build -> dist/ ; build:prod also obfuscates. Overwrites what a local `node dist/src/main` serves: only when asked
npm run lint                    # eslint --fix over src/test (most rules are off)
npx jest src/path/to/file.spec.ts          # one spec file (jest rootDir is src/)
npx jest -t "name of test"                 # one test by name
npx jest --findRelatedTests src/x/y.ts     # specs touching a file
node --test test/notification-queue-delivery.cjs   # notification queue harness (node:test, not jest)
node ../.claude/tools/check-route-auth.js            # routes with no auth middleware bound
npm run tag:facilities -- --tenant=<id>     # facility-tagging migration (dry run unless --apply)
```

Swagger UI is at `/api` whenever `NETWORK` is not `PROD`. `.env` is required (not committed); `NETWORK` must be one of TEST/DEMO/DEV/UAT/PROD or `config/config.ts` crashes at import.

## How a request flows

1. `src/main.ts`: helmet, 20mb body limit, express-session, CORS allow-list (add new frontend origins there).
2. Auth middleware is bound **per route** inside each module's `configure()`: `consumer.apply(JwtMiddleware).forRoutes({ path: '/<prefix>/...', method })`, then `TenantMiddleware` on the same list. A route missing from that list is public. There is no global guard; `RBACGuard` exists but is unused.
3. `JwtMiddleware` (`src/middlewares/jwt.middleware.ts`) decrypts the `Authorization` header (`iv:ciphertext`, AES-256-CBC with `TOKEN_ENCRYPTION_KEY`, not a JWT), requires `?user_id=` equal to the token's user and `?facility=[{"value":...}]` covering the token's facilities (admins skip the facility check), and puts the payload on `req.body.user`. `BYPASS_AUTH=true` in `.env` replaces all of this with a mock admin for local testing. Use that switch; do not comment code in `jwt.middleware.ts` / `windowserver.middleware.ts` to test locally (git history shows 100+ such commits in three months, and a hook now asks before editing those files).
4. `TenantMiddleware` loads `TENANT_SETUP` for the `tenant_id` param/body/query and puts it on `req.body.tenantCheck` (type: `src/middlewares/types/tenant.ts`).
5. Handlers strip those first: `const { tenantCheck, user, ...body } = reqBody;`, then call the DB as `this[DBService].method(TABLE_NAMES.X, ..., tenantCheck?.tenant_schema)`.
6. Handlers mostly **return** `{ statusCode, message, data }` with HTTP 200 rather than throwing; errors are thrown with `error.reference_id` set and caught by the module's own `@Catch()` filter (`<module>.filter.ts`), which writes `ERROR_LOGS` via `ErrorLogsService`.
7. `AuditInterceptor` (global) records a `TRAIL_TABLE` entry for handlers decorated with `@Audit({ ...AUDIT_ENTITIES.X, action })` when the returned `statusCode` is < 400. Handlers can set `req.__audit = { reference_id, old_value, new_value }`.

Other auth schemes exist for non-staff callers: `WindowServerMiddleware` (server-to-server, no facility check), `AppointmentMiddleware`/`SecureMiddleware` (public online appointment, `x-api-token` + encrypted body), `PreRegSecureMiddleware` (pre-registration), mobile app Bearer JWT, `SuperTenantMiddleware`/`TenantAndUserMiddleware`, `LambdaFunctionMiddleware` (HMAC of timestamp), data-exchange `TenantAuthMiddleware` + `TenantCredentialsGuard` scopes, `ChatEnabledMiddleware`. Multipart routes lose `req.body.user`/`tenantCheck` to multer unless `AuthContextMiddleware` is bound after Jwt/Tenant (read back with `authContextOf`).

**Route-binding trap:** when a literal-prefixed route (`search/:tenant_id`) and a generic route (`:tenant_id/:id`) share a method, Nest runs `JwtMiddleware` twice and the second run rejects with 401. Use distinct literal prefixes (`detail/:tenant_id/:id`). See comments in `src/step-master/step-master.module.ts` and `src/process-master/process-master.module.ts`.

## Multi-tenancy and data access

- Every tenant has its own Mongo database named by `tenantCheck.tenant_schema`; `MongoDBService.resolveDb(dbName)` maps it to a cluster via `config/tenantClusterMapping.config.ts`. Omitting `tenant_schema` silently reads/writes the default control DB (`MONGO_DB_NAME`). `TENANT_SETUP`, `USER` lookups at login are the main legitimate default-DB reads.
- `src/functions/MongoDBService.ts` is the only data layer (Mongoose models are used only by `src/chat`). `findByQuery` takes an aggregation pipeline, not a filter. Collection names live in `config/table-names.config.ts` (interface + object; add both).
- Conventions on documents: soft delete with `isDeleted: true` (filter `isDeleted: { $ne: true }`), `isActive`, `created_by/created_on`, `updated_by/updated_on`; ids are `uuidv4()` strings in a `<thing>_id` field.
- Keys containing `*` (`provider*id`, `provider*name`, `entered*by`) are system/bookkeeping columns; the AI transform renames them to `_`.
- Regex built from user input must be escaped (several places don't).
- Number generation: registration numbers use `SEQUENCE` with an atomic `$inc` (`fetchSequenceDataTransaction` in the registration controller); `MongoDBService.generateAutogenerateNumber` (`AUTOGENERATE_SCHEMA`) is read-then-write and not safe under concurrency.

## Architecture map

URL prefix decides the area: `authorization-service/*` (tenants, facilities, users, login, export/promotion), `tenant-service/*` (employees, services, tariffs, payers, process/step masters, task management, files, dashboards), `configuration-service/*` (low-code builder, lookups, rules, AI config, chat), `patient-service/*` (registration, appointments, OP EMR, reports), `inpatient-service/*` (IP EMR, admission/beds, clinical summary, activity dashboard, utility), `billing-service/*`.

- **Low-code builder (the core idea):** screens are data. `WEBPART` documents (one per webpart, `properties[]` = versions with `status: draft|published`) define fields and many `is*` behaviour flags plus `db_obj_name`, the collection the data is saved to. `WORKFLOW` orders webparts per provider/specialization; `FORM_CONFIG_SCHEMA` defines forms; `REFERENCE_LOOKUP`/`LOOKUP_MAPPING` hold masters. Menu, organogram and search-builder use one document per tenant with `data[].properties[]` versions; reference lookups (`REFERENCE_LOOKUP`) and data attributes (`EMR_DATA_ATTRIBUTES_SETUP`) use one document per object. All have create-draft / edit-draft / publish endpoints (`cancel-draft` only for menu and organogram); see `be-builder-config`. Old versions move to `*_PREVIOUS_VERSIONS` collections.
- **OP EMR** (`src/emr`): two live, parallel implementations. Services (`emr-data.service.ts`, `patient-visit/patient-visit.service.ts`, `sub-emr/sub-emr.service.ts`) behind controllers at `patient-service/emr`, and `emr.controller.ts` at `patient-service/emr/v1` (15k lines, logic inline). 110 of its 116 methods also exist in the services; recent fixes are applied to both, and a few endpoints exist only in v1 (e.g. `update-risk-flag`). Change both copies unless you know which route the frontend calls. Data: `PATIENT_VISIT` (encounter, visit-wise data), `PATIENT_REGISTRATION_EMR` (registration-wise data keyed per provider `properties[<user_id>]`), `TASK_ASSIGNMENT_HISTORY` (per-role task bags), grid webparts stored in `EMR_*` collections behind `{ _id, collectionName }` pointers on the visit.
- **Inpatient** (`src/ip-emr`): `atd.controller.ts` (admission, booking, beds, transfers), `ipemr.controller.ts` + `ip-emr.service.ts` (IP EMR data, progress notes, referrals, discharge process/summary, MAR). `IP_PATIENT_VISIT` is the IP visit; ER visits are `PATIENT_VISIT` with `source` ER (see `docs/care-setting-data-flow.md`).
- **Task engine** (`src/task-management`): `TaskEngineService.handleStepEvent(tenant, facility, { step_code, outcome, reference_id, ... }, schema)` advances `PROCESS_MASTER` graphs into `TASK_CASE`/`TASK_MANAGEMENT`. Domain code fires it fire-and-forget with `.catch()` (step codes: registration `0001`, appointment `0003`, admission request `0005`, IP admission `0010`, medication advised `0012`, MAR `0013`, discharge `1009`-`1011`). Recurrence and escalation crons run every minute.
- **Rules and notifications** (`src/rule-master`, `src/notification`): rule conditions + actions (ACKNOWLEDGED / TASK_CREATED / RESOLVED) are evaluated in `NotificationService`, queued via `QUEUE_TYPE` (SQS | KAFKA | DB), delivered to vendors and to `NotificationGateway` rooms.
- **AI**: `clinical-summary` builds an IP case-sheet bundle (`ai-case-sheet-bundle.service.ts` -> `transform/`) and streams NDJSON from ai_server; `conversation-ai` and `voice-assistant` proxy audio WebSockets; `document-extraction` is OCR; `visit-summary` is the consolidated visit summary. All call external Augastam AI services configured by `AUGASTAM_*` env vars.
- **Reporting**: `report.controller.ts` turns saved SQL into Mongo pipelines (`src/functions/sqltomongoquery.ts`, with a blocked-collections list) or runs it on Postgres with tenant-filtered CTEs; `report-sync` mirrors `PATIENT_REGISTRATION_DB` and `IP_PATIENT_VISIT` into Postgres through change streams (leader via advisory lock, needs a replica set). See `docs/dynamic-report-api.md`.
- **Printing**: `src/functions/PdfService.ts` renders webpart data into `REPORT_BUILDER` HTML formats with Puppeteer.
- **Files**: storage provider is chosen per tenant (`tenantCheck.cloudProvider`): S3, GCP, Azure, custom S3, MinIO (BharathB3), FTP; all implement `FileUploadProvider`; metadata in `ASSETS`.
- **Schedulers**: `ScheduleModule.forRoot()` in `app.module.ts`; every running instance (each pm2 process, each laptop on a shared DB) runs every cron.

  | Job | File | Schedule |
  |---|---|---|
  | Task recurrence / escalation | `src/task-management/task-recurrence.scheduler.ts`, `task-escalation.scheduler.ts` | every minute |
  | Notification retry | `src/notification/notification-retry.scheduler.ts` | **disabled** (`return;` first line) |
  | Report sync reconcile / full resync / monitor | `src/report-sync/report-sync.scheduler.ts` | 15 min / 02:00 / 5 min |
  | Facility license, password expiry | `facility-license.scheduler.ts`, `password-expiry.scheduler.ts` | 02:00, 01:00 |
  | Key rotation | `src/functions/cronScheduleService.ts` | never runs (`KeyRotationScheduler` not provided) |
  | OCR retention, system-definition protection | `document-extraction.scheduler.ts`, `system-definition-protection.scheduler.ts` | **disabled** (`@Cron` commented) |

  New job: copy `TaskRecurrenceScheduler` (`private running` flag returns early on overlap; load `TENANT_SETUP` `{ isDeleted: { $ne: true } }` projecting `tenant_id, tenant_schema`; per-tenant `try/catch` so one tenant never stops the sweep; reset the flag in `finally`); add it to the module's `providers`. The flag guards one process only: before any side effect (email, task, alert), **claim** the item with a conditional update that re-checks the state you read and continue only if it matched (`task-escalation.scheduler.ts`: `updateItemQuery({ ..., escalation_level: current }, { escalation_level: next })`, bail on `!matchedCount`). Redis locks always fail (see below); for whole-job leadership use a Postgres advisory lock like `ReportSyncListener`. Alerts: stamp what was sent and leave it unset on failure so the next run retries (password/license jobs). Unit-test the per-item decision with a fake DB and fixed clock (`password-expiry.scheduler.spec.ts`).

## Things that bite

- `src/utility/utility.service.ts`, `src/clinical-summary/IPVisitData.service.ts` and `src/functions/AllVisitSummaryService.ts` are near copies (`extractDischargeData`, vitals, allergies). Port fixes to all three.
- Two classes are named `IpEmrController` (`src/emr/ipEmr.controller.ts` at `inpatient-service/ip-emr/v2` and `src/ip-emr/ipemr.controller.ts`). Some files keep a commented-out `@Controller(...)` above the real one.
- Many files are 4k-15k lines. Edit surgically; do not reformat (Prettier is configured but files are not formatted, and reformatting creates unreviewable diffs).
- Gateways, `retryWithBackoff` and token decryption are deliberately duplicated per module; follow the local copy.
- Not every module is registered: `ClinicModule` is commented out of `app.module.ts`.
- `Dockerfile` copies `.env` into the image.
- Redis is currently never connected: `RedisService.onModuleInit` has `await this.initialize()` commented out, so every Redis call silently no-ops (`getCache` returns null, `acquireLock` returns false, rate limiting fails open). Lookup caching, chat presence and recording locks therefore run without Redis.

## Tests

Specs sit next to the code (`*.spec.ts`). The house pattern instantiates the controller/service directly with `null` dependencies and swaps the DB: `controller[DBService] = { findByQuery: jest.fn(), ... }` (see `src/patient-registration/patient-notes.controller.spec.ts`). Gateway specs set `process.env` before `require` because env is read at module load. Many old specs are 19-line Nest "should be defined" stubs built with `Test.createTestingModule`; they need the full provider graph (and some a live Mongo) to pass, so don't use them as a template.

## Workflow

- Integration branch is `development`; `test-environment` auto-deploys over SSH (`.github/workflows/test-environment-deploy.yml`: `npm ci`, `pm2 reload`).
- Branches: `feature/ASPL-<id>-...`, `bug/aspl-<id>-...`, `task/...`, `feat/...`; commit messages often start with `[ASPL-<id>]:`. PR titles carry the semver used for release notes in `versions/<x.y.z>.md`; work items are Azure DevOps (`SAAS_HIS`).
- One-off data scripts live in `scripts/` and follow one pattern: `NestFactory.createApplicationContext(AppModule)`, loop non-deleted `TENANT_SETUP`, dry run unless `--apply`.

For ticket work use the workspace `build-feature` skill. Area guides for `src/emr`, `src/ip-emr`, `src/clinical-summary`, `src/report`, `src/task-management`, `src/notification`, `src/chat` and `src/functions` are in `.claude/rules/backend-<area>.md` and load when those folders are touched.
