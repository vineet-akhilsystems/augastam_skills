---
name: be-search-builder
description: Use when changing or debugging the backend of the Search Builder (tenant-service/search-builder) - saving a search configuration, adding a search-level or column-level flag, "flag not saved on edit", duplicate search name, a search that cannot be deleted (mapped to custom source), search-by-query returning wrong/no rows or wrong counts, fuzzy matching, searching another collection, export of search builders to another tenant, or mapping action objects (MAPPING_ACTION_DB).
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder. Frontend side: `fe-search-builder`. General builder versioning/promotion: `be-builder-config`.

# Search Builder (backend)

All code: `src/search-builder/search-builder.controller.ts` (~1250 lines, logic inline, no service). `search-builder.module.ts` binds `JwtMiddleware` + `TenantMiddleware` per route; **a new route must be added to both `forRoutes` lists** or it is public (the route-auth hook will flag it). Errors go to `SearchBuilderFilter` -> `ERROR_LOGS`.

## Storage

One `SEARCH_BUILDER` document per tenant (tenant DB, `tenantCheck.tenant_schema`):

```js
{ tenant_id, tenant_name,
  data: [{
    searchbuilder_id, isActive, isSystemSearch, isSerialNumberRequired,
    showRiskFlags, isFilter, isDateRangeFilter, dateRangeDbObject, dateRangeField,   // also copied on data[]
    properties: [{                       // only properties[0] is used; edited in place, no draft/publish
      searchbuilder_name, search_group, webpart: [{ id, name }],   // "search" webparts = filter form
      redirect_to, showRiskFlags, isSerialNumberRequired, select_query,
      isFilter, isDateRangeFilter,       // filter settings; date range = dateRangeDbObject (collection) + dateRangeField (key)
      dateRangeDbObject, dateRangeField,
      created_on/by, updated_on/by,
      fields: [{                         // one entry = one result column
        name, isDropdown, isSearchable, dropdownFieldKey,
        isTatColorVisible, isWaitingTimeVisible, showPatientVisitStatus, showVulnerablePatient, showVipPatient,
        selected_action / selectedAction, // action column (MAPPING_ACTION_DB _id); frontend writes both spellings
        isManualColumn, manualKey,       // manual column: no db_fields
        db_fields: [{ key: "<COLLECTION>.<column>", selected, label,
                      shouldWrapInBrackets, shouldCalculateAge, shouldHidePhoneNumber }]
      }]
    }]
  }] }
```

`db_fields[].key` prefix is the collection name; the frontend derives `tablename` (collections to search) from it. Column/field flags are opaque to the backend: they live inside `fields` and round-trip without backend changes.

## Endpoints (`tenant-service/search-builder/...`)

| Route | Handler | Notes |
|---|---|---|
| `PUT create-data` | `createOrUpdateSearchBuilder` | body `{ tenant_id, data: { searchbuilder_id, isActive, isSystemSearch, isSerialNumberRequired, properties: {...} } }`; creates tenant doc if missing; rejects duplicate id/name (case-insensitive) with `statusCode: 500` |
| `PUT edit-searchbuilder` | `editDraft` | flat body `{ tenant_id, searchbuilder_id, searchbuilder_name, fields, ... }`; writes `TRAIL_TABLE` |
| `PUT update-searchbuilder-status` | `changesearchbuilderStatus` | `isActive` / `isSystemSearch` |
| `PUT delete-by-searchbuilder-id` | `deletesearchbuilderById` | `searchbuilder_id` is an **array**; 409 if any id is in `CUSTOM_SOURCE_MAPPING.data[].searchbuilder_data[].searchbuilderid`; system searches (`isSystemSearch`) are silently kept |
| `GET :id` | `getDataById` | whole tenant doc (`:id` = tenant id; list page uses it) |
| `GET get-searchbuilder-by-id/:tenant_id/:searchbuilder_id` | | one `data[]` item; used by every runtime screen (worklists, patient search) |
| `GET manage-searchbuilder-all/:tenant_id/:searchbuilder_id?` | | copies `searchbuilder_name`, `search_group`, `updated_*` up from `properties[0]` |
| `GET manage-searchbuilder-all-search/:tenant_id/:prefix` | | name contains prefix |
| `PUT search-by-query/:tenant_id?page&limit` | `searchBYQuery` | runs the search (below) |
| `GET system-global-setting/:tenant_id/:identifier/:key?` | | `SYSTEM_GLOBAL_SETUP`; preview reads identifier `Search` for redirect URLs |
| `PUT export-searchbuilder/:tenant_id` | | super tenant + super admin only; v1 copy also in `authorization.controller.ts` (~8338). Same-name imports get `(2)` |
| `POST fetch-mapping-object-data/:tenant_id`, `GET get-all-list-mapping-object-data/:tenant_id` | | `MAPPING_ACTION_DB` (action column options `{label: action_name, value: _id}`) |

Other readers of `SEARCH_BUILDER`: `pre-registration.controller.ts` (`get-searchbuilder-by-id`, its own copy), `master-api.controller.ts` (~548, finds a search by name and builds a pipeline from selected `db_fields`), `authorization.controller.ts` (template/default config ~4975, menu redirect `/searchbuilder/<id>`), `authorizationv2.controller.ts` (collection lists for promotion). Field keys offered to the builder come from `patient-service/patient-registration/keys/:tenant_id?db_object=` (published webpart `columnName`s for that `db_obj_name`) and `module-keys/:tenant_id?module=` (config collections such as MENU, ORGANOGRAM); collections list from `configuration-service/form-schema/db-objects/:tenant[/module]`.

## Adding a search-level flag (e.g. `showXyz`)

Follow the filter settings (`isFilter`, `isDateRangeFilter`, `dateRangeDbObject`, `dateRangeField`, commit `6e2e3192`), which are stored on both `data[]` and `properties[0]`:

1. **Create, tenant's first search**: `createOrUpdateSearchBuilder` builds `data[0]` from a fixed key list (`isActive` ... `dateRangeField`); add yours there. When the tenant document exists it spreads `data` and `data.properties`, so nothing else is needed.
2. **Edit**: `edit-searchbuilder` only overwrites keys already present in `properties[0]` (`for (let key in draftObject)`), so a new key is dropped for every existing search. Add a block beside the `isFilter` ones:

```ts
      if (searchbuilderData.hasOwnProperty('showXyz')) {
        draftObject.showXyz = searchbuilderData.showXyz;
        searchbuilder_details.showXyz = searchbuilderData.showXyz;
      }
```

3. Readers use `item.properties[0].flag ?? item.flag`. A flag toggled from the list page goes in `changesearchbuilderStatus` too (like `isActive`). A column-level flag needs no backend change.

## search-by-query

Body = filter values keyed by column name + `tablename: [collections]` + `isPatientsearch`.

1. Runs an aggregation on `tablename[0]` only: `$match { tenant_id }` -> unwind `data` (for config collections) -> per non-empty string filter an `$or` of fuzzy regex on `data.properties.<k>`, `properties.<k>`, `<k>` (`generateFuzzyRegex`: escapes input, lets vowels appear between letters) -> `$skip/$limit`. Count = same pipeline minus skip/limit plus `$count`.
2. Rows are flattened: config docs -> latest **published** `data.properties` version (no published version -> `null` row); data docs -> top level + scalar `properties.*`; `{ _id, collectionName }` pointers are resolved with `getItem`.
3. `isPatientsearch` with more than one collection: for each row, finds rows in the other collections by `registration_id` and returns one merged row per match; this branch returns no `totalCount`.

Returns `{ result, query, totalCount, totalPages, currentPage }`; `query` (the pipeline) is shown in the builder preview.

## Bug-prone spots

- `tablename` comes from the request body and is used as the collection name: any collection of the tenant DB can be read. Do not widen this; validate against an allow-list if you touch it.
- `searchbuilder_details === -1` checks never fire (`find` returns `undefined`): `edit-searchbuilder` with an unknown id throws on `.properties` (filter -> 500); `get-searchbuilder-by-id` returns an empty body.
- Non-string filters (arrays, numbers, booleans) are ignored by search-by-query; dropdown filters on worklists are applied on the frontend.
- No `isDeleted` filter; delete removes the item from `data[]`.
- Writes replace the whole `data` array (read-modify-write); concurrent edits of two searches in one tenant can lose one.
- Return codes: duplicate name is `statusCode: 500` with HTTP 200; frontend shows success unless it checks `statusCode`.

## Verify

- `npx tsc --noEmit -p tsconfig.json`; `node ../.claude/tools/check-route-auth.js` for new routes.
- Locally: create a search, edit it, reload via `get-searchbuilder-by-id` and confirm your key is in the stored document; run `search-by-query` with and without filters and check `totalCount`.
- Spec pattern: `be-write-spec` (instantiate the controller, `controller[DBService] = { findByUniqueValue: jest.fn(), updateItem: jest.fn(), createItem: jest.fn(), findByQuery: jest.fn() }`).

Last audited: 2026-10-28 against akhil_systems_backend@demo-environment 175335d8
