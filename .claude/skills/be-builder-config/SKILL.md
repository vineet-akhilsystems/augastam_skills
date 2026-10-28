---
name: be-builder-config
description: Use when changing low-code builder configuration on the backend - webparts and their is* flags, db_obj_name/save_type, workflows, forms, menus, organogram, search builder, data attributes, reference lookups, lookup mappings, lookup cache, facility tagging - or when drafts/old versions show, a dropdown is empty or stale, or config must be exported/promoted to another tenant or environment.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Builder configuration: versions, webpart flags, lookups, promotion

## Storage shapes

Each version is a full copy in `properties[]`: `{ version, status: 'draft'|'published', created_by/on, published_by/on, ...config }`.

| Shape | Collections (id field) |
|---|---|
| One document per object | `WEBPART` (`webpart_id`), `WORKFLOW` (`workflow_id`), `FORM_CONFIG_SCHEMA` (`form_id`), `REFERENCE_LOOKUP` (`lookup_id`, `lookup_name`), `EMR_DATA_ATTRIBUTES_SETUP` (`data_attribute_id`) |
| One document per tenant, objects in `data[]` | `MENU` (`data[].menu_id`), `ORGANOGRAM` (`data[].node_id`), `SEARCH_BUILDER` (`data[].searchbuilder_id`; edits `properties[0]` in place, no draft/publish) |

Lookups and data attributes are one document per object (the backend guide is wrong there). Per-tenant docs are rewritten whole; concurrency fix in `be-tenant-data-access`.

## Lifecycle endpoints

| Module (base `configuration-service/...`) | Create | Draft / publish | Other |
|---|---|---|---|
| `webpart` | `new-webpart` | `create-draft`, `edit-draft`, `publish-webpart` | `update-webpart-status`, `latest-version/:id`, `manage-webpart-schema/:tenant_id`, `export-data` |
| `form-schema` | `new-form` | `create-draft`, `edit-draft`, `publish-form` | `update-form-status`, `export-data` |
| `workflow` | `create-workflow/:tenant_id` | `create-draft/...`, `edit-draft/...`, `publish-workflow/...` | `export-workflow/:tenant_id` |
| `reference-lookup` | `create-data` | `create-draft`, `edit-draft`, `publish-lookup` | `update-lookup-status`, `delete-lookup-by-id`, `export-data` |
| `data-attributes` | `new-data-attributes/:tenant_id` | `create-draft/...`, `edit-draft/...`, `publish-data-attributes/...` | `delete-dataAttribute-by-id/...` |
| `menu` | `create-data` | `create-draft`, `edit-draft`, `publish-menu`, **`cancel-draft`** | `delete-menu-by-id`, `export-data` |
| `organogram` | `create-data` | `create-draft`, `edit-draft`, `publish-organogram`, **`cancel-draft`** | `delete-node-by-id` |

- `cancel-draft` exists only for menu and organogram.
- `create-draft` copies the **last** version (spread), `version + 1`, `status: 'draft'`, drops `published_by/on`. Webpart `edit-draft` copies every body key except `tenant_id`/`webpart_id` into the draft (no whitelist); `isSystemWebpart`/`isActive` go to the top level.
- `publish-webpart` also copies `webpart_name`/`webpart_type` to the top level.
- These handlers write `TRAIL_TABLE` by hand (`module: 'configuration'`, `Objectname: '<x>'`).

**Version limit:** when `tenantCheck.version_display_number > 0`, `create-draft` for webpart, workflow, form-schema, reference-lookup and data-attributes keeps the newest N versions and moves the rest to `WEBPART_CONFIG_SCHEMA_PREVIOUS_VERSIONS`, `WORKFLOW_PREVIOUS_VERSIONS`, `FORM_CONFIG_SCHEMA_PREVIOUS_VERSIONS`, `REFERENCE_LOOKUP_OLD_VERSIONS`, `EMR_DATA_ATTRIBUTES_SETUP_PREVIOUS_VERSIONS`. Read both for history.

**Reading:** runtime uses the latest **published** version. `MongoDBService.getLatestVersionData(coll, filter, db)` filters `isActive: true`, takes the newest version, and if it is a draft falls back to the previous published one (or `properties: []`).

**System definitions:** `WEBPART.isSystemWebpart: true` -> writes return `{ statusCode: 401 }` (`assertWebpartWritable`); `fields[].attributes.isSystemField: true` -> `edit-draft` must keep the field identical (`assertFieldsWritable`); both in `webPart.controller.ts`, call both from new write paths. Approvals: `configuration-service/system-definition`; its auto-protection cron is commented out.

## Webpart anatomy

Published version: `webpart_name`, `webpart_type`, `webpart_group`, `webpart_code`, `db_obj_name` (stored trimmed, spaces -> `_`; readers use `.toUpperCase()` as the collection), `save_type` (`'RegistrationWise'` -> `PATIENT_REGISTRATION_EMR`, anything else -> visit; explicit `registration_wise`/`visit_wise` lists in the save payload win, see `storeFor` in `src/audit/case-sheet-audit.ts`), `fields[]` (`columnName`, `type`, `attributes`), and `is*` flags set in `createOrUpdateWebpart` (`new-webpart`, ~line 554).

| Flag | Read in (besides `webPart.controller.ts`) |
|---|---|
| `isGrid` | EMR (all copies), `PdfService`, AI bundle, workflow, master-api, export |
| `isMedication` | EMR, `ip-emr.service`, `ipemr.controller`, `activity_dashboard.service`, `infusion.service`, `case-sheet-transform.service`, `report.controller` |
| `isInfusionMedication` | `infusion.service` (continuous infusion requires it), `infusion-sets.service`, `ipemr.controller` |
| `isInfusion` | nothing (stored only) |
| `isVitalSign` | EMR, workflow, the 3 visit-summary copies (`utility.service`, `IPVisitData.service`, `AllVisitSummaryService`) |
| `isMultientryVitals` | `emr-data.service`, `audit.service` |
| `isDiagnosis` | EMR, AI bundle, report, visit-summary copies |
| `isExamination`, `isBiometry`, `isOpticalMotility` | EMR, `sub-emr.service`, `PdfService`, export; `isOpticalMotility` also emr-template, `ip-emr.service` |
| `isCrossTab` (`Half`, `MultiEntry`) | EMR, `sub-emr.service`, `PdfService` |
| `isProgressNotes` / `isAddendumType` | `ip-emr.service` / `emr-template.controller` |
| `isImmunisation` | `immunization.controller`, visit-summary copies |
| `isFollowupAppointment` | `patientemr.controller`, report, export |
| `isOrders` / `isService` | EMR / EMR, IP EMR, report |
| `isHistory`, `isPrevious` | EMR, export; `isHistory` also `activity_dashboard.controller` |
| `isTemplate` | EMR, `PdfService`, IP EMR, workflow, step-master, appointment, pre-registration |
| `isMedicalIllustration` / `isDilation` | EMR / `dilation.controller` |
| `isAdmissionAdvise`, `isWorkflowTemplate`, `isTapering`, `isCured`, `isPachymetry` | nothing (stored only); `isPreviousAppend` only export |
| `isSystemWebpart` | form-schema, workflow, master-api, pre-registration, system-definition, export, `ConfigPromotionService` |

Live check: `grep -rlw "<flag>" src`. Trace: `clinical-data-tracer` agent; EMR storage: `be-emr-data-model`.

## Lookups

- `REFERENCE_LOOKUP` (`src/reference-lookup/reference-lookup.controller.ts`): values in `properties[].lookup_values[]`; hierarchy via `parent_lookup_name`/`parent_list_value`. Readers: `parent-lookup`, `get-multi-level-lookup`, `get-paginate-lookup-values`, `get-lookup-bulk-data`, `pincode-lookup`. Fields reference a lookup via `attributes.dataSource`.
- `LOOKUP_MAPPING`: filtered projections over another collection (`condition`/`not_condition`, `location`), served by `GET lookup-mapping/:tenant_id/:lookup_mapping_name?`. CRUD: `add-/get-/update-/delete-lookup-mapping`; diagnosis master writes here too.
- Cache keys: `tenant:<id>:referenceLookup:byid|byname:<x>`, `tenant:<id>:lookupMappingData:<name>[...]`. Endpoints: `upload-lookup-cache`, `clear-lookup-cache`, `upload-cache-all-tenants` (`LambdaFunctionMiddleware`). Redis never connects today (`onModuleInit` in `src/redis/redisService.ts` skips `initialize()`), so every read misses. Only speciality-lookup publish deletes keys; add `delCacheByPattern` to any write you touch.
- Translations: `MULTI_LINGUAL` (`configuration-service/multi-lingual`).

**Facility tagging** (`FACILITY_TAGGING`, `src/facility-tagging/facility-tagging.service.ts`): camelCase docs `{ tenantId, facilityId, master, recordId }`, unique index on the four. Facility from `x-facility-id` or `?facility_id` (`extractFacilityId`). Consumers: `getTaggedRecordSet` + `isItemTagged`, or `filterLookupValues`, which returns `[]` when the facility has no tags. Used in `employee.controller.ts`, `payer.controller.ts`. Seed: `npm run tag:facilities` (dry run), `-- --apply`, `--tenant=`, `--masters=`, `--network=`.

## Export and promotion (patient data never moves)

| Path | Code | Auth |
|---|---|---|
| v1 `PUT authorization-service/authorization/{form-schema,reference-lookup,menu,webpart,lookup-mapping}/export-data`, `search-builder/export-searchbuilder/:tenant_id`, `workflow/export-workflow/:tenant_id`, `POST export-data-attributes` | `authorization.controller.ts` + `AuthorizationService.export*`, `getChildLookups`, `extractImageIdsForLookups` | none bound except `export-data-attributes` (Jwt + Tenant); `DataMigrationGuard` only on menu, search-builder, data-attributes |
| v2 `PUT .../authorization/v2/...` form-schema, reference-lookup, webpart, workflow, report-builder, lookup-mapping, step-master, process-master, custom-source-mapping | `authorizationv2.controller.ts` | all `DataMigrationGuard`; Jwt only on the last four |
| `PUT .../promote-tenant/:source_tenant_id/:target_tenant_id` | v1 only | Jwt bound |
| `PUT .../promote-new-tenant/...` and `.../v2/promote-new-tenant/...` | both controllers | none bound; trusts `?user_id` being an `isRootUser` (known gap) |
| `PUT .../clone-tenant/:source_tenant_id/:target_tenant_id` | `MongoDBService.cloneTenant` | Jwt bound |
| `POST inpatient-service/utility/promote-config/:tenant_id?network=` | `src/utility/config-promotion.service.ts` | Jwt + `DataMigrationGuard` |
| `PUT configuration-service/<module>/export-data` | per-module copies | per module |

`DataMigrationGuard` (`src/guards/dataMigrationGuard.ts`), target `?network=`: TEST -> TEST/DEMO; DEMO -> UAT/TEST/DEMO; UAT -> UAT/PROD/DEMO; PROD -> PROD/UAT; any other NETWORK (incl. DEV) -> 403. From UAT/PROD it also checks `promoted_tenant_id`/`isSuperTenant`/`isSuperAdmin` for the unauthenticated `?user_id`. Target DB: `<ENV>_MONGO_URL` / `<ENV>_MONGO_DB_NAME`.

`ConfigPromotionService.promoteConfig` (body: `source_tenant_id`, `destination_tenant_id`, `items[{ workflow_id, webpart_ids }]`, `lookup_ids`, `include_workflow_webparts`, `dry_run`) promotes only the latest published version of workflows, webparts and lookups (incl. those referenced by `LOOKUP_FIELD_TYPES` fields). Result per type `{ created, versioned, unchanged, conflicts, skipped_no_published }`; same name/different id = conflict; workflow `role`/`provider`/`specialization` kept from the target. Always `dry_run: true` first.

## Checklist: add a webpart property/flag

1. `createOrUpdateWebpart`: add `isMyFlag: webpartData?.isMyFlag || false` to the version-1 literal.
2. `create-draft` spreads the last version and `edit-draft` copies body keys, so both carry it; confirm nothing filters it.
3. Listing: `manageWebpartAll` and `managesearchwebpartAll` (GET/POST `manage-webpart-schema`, ~lines 1600-3270) copy flags onto each item in several blocks; add yours to every block or the builder list won't show it.
4. Consumers: decide for EMR save/read/copy (both `emr.controller.ts` and the services), `PdfService`, AI bundle/transform, reports, the 3 visit-summary copies, IP EMR.
5. Export: v1 and v2 `webpart/export-data` rebuild the target webpart from a hand-picked flag list (`requestBody.webpartInfo?.isGrid`... in `authorization.controller.ts` ~line 8700 and `authorizationv2.controller.ts` ~line 610); add yours to both or it is lost. `promote-tenant`, `AuthorizationService.exportWebpartData` and `ConfigPromotionService` copy whole versions.
6. Frontend: `fe-webpart-field-type`. New route: `be-api-change`.
