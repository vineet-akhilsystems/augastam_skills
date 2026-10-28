---
name: fe-search-builder
description: Use when changing or debugging the frontend Search Builder (custom-form-builder) - creating or editing a search configuration, adding a column, filter, dropdown/searchable filter, column or field toggle (TAT colour, waiting time, VIP, hide phone, calculate age, brackets, label), action column, manual column, search group, redirect, serial number, risk flags, the search preview, or a worklist / patient search whose columns or filters come from a search builder and show stale, missing or wrong data.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src`; run commands inside `custom-form-builder`. Backend side (storage, endpoints, search-by-query): `be-search-builder`.

# Search Builder (frontend)

A search builder is saved config: a filter form (one or more webparts whose name starts with `search`) plus result **columns** (`fields[]`), each column grouping one or more `db_fields` (`"<COLLECTION>.<column>"`). Screens such as the OP visit worklist read that config and render columns and column filters from it.

## Screens and routes (`ComponentRoute.js`)

| Route | File | Role |
|---|---|---|
| `/search-configuration` | `searchBuilder/SearchBuilder.js` | list, search by name, activate/deactivate, delete (409 = mapped to Custom Source Mapping), opens `/new-search` with `state: { id, tenantIdExists }` |
| `/new-search` | `searchBuilder/NewSearch.js` (1.7k lines) | the editor |
| `/search-preview` (modal via `CommonModal2` `from="search"`) | `searchBuilder/SearchPreview.js` | preview **and the Create/Save button** |
| `/searchbuilder/:id` | `SearchPreview.js` standalone | runtime search page; menus redirect here (`redirect_value = "/searchbuilder/<id>"`) |
| `/all-search` | `searchBuilder/AllSearch.jsx` | grouped list of searches |

## Editor (`NewSearch.js`)

- State: column list is `targetElements`; available keys `searchFields` (from `patient-service/patient-registration/keys/${tenant}?db_object=` or `module-keys?module=` when "Module Search" is on); collections from `configuration-service/form-schema/db-objects/${tenant}?search=true` (or `/module`); filter webparts from `configuration-service/webpart/latest-version-type/${tenant}?prefix=search` -> `selectedWebpartValues` (`addValue`).
- Building columns: tick keys, drag them (`handleDragStart`) onto the drop zone; `handleDrop(e, -1)` prompts for a name and creates `{ name, db_fields }`, dropping onto an existing column appends unique keys. Column reorder: `handleDragStart1` / `handleDragOver` / `handleDragEnd`.
- Edit mode: `isSearchIdPresent` (id in `manage-searchbuilder-all`) -> effect ~284 loads `properties[0]` into state. New search-level state must be loaded here too.
- Column options: `components/modals/RenameModal.jsx` (opened by `handleEditTargetName`). Handlers ~102-195 write onto `targetElements[index]`: `isDropdown` (clears `isSearchable`; `dropdownFieldKey` picks one field), `isSearchable` (clears `isDropdown`), `isTatColorVisible`, `isWaitingTimeVisible`, `showPatientVisitStatus`, `showVulnerablePatient`, `showVipPatient`.
- Field options: `components/modals/EditFieldModal.jsx` (`handleEditSelectedItem`) writes onto `db_fields[i]`: `label`, `shouldWrapInBrackets`, `shouldCalculateAge` (toggle shown only for `DOB`), `shouldHidePhoneNumber` (only for `PATIENT_PHONE`).
- Action column: `setIsActionColumn(true)`; options from `getMAppingActionList` (`appointment/AppointmentAction.jsx`, `tenant-service/search-builder/get-all-list-mapping-object-data`).
- Manual column: saved as `{ name, isManualColumn: true, manualKey }` (`handleManualColumnSave`); render side is the registry in `components/ManualColumn/ManualColumnCell.jsx` (add a renderer under the same key). The registry is not yet imported by any list in this repo; wire `<ManualColumnCell column row />` into the list that needs it.
- Search-level toggles: `ToggleModuleSearch`, `ToggleSystemSearch`, `ToggleShowRiskFlags`, `ToggleSerialNumberRequired`, `ToggleRedirect` (`pageRedirect`), plus `searchGroup`.
- Filter settings (`isFilter`, `isDateRangeFilter`, `dateRangeDbObject`, `dateRangeField`): added on `development` in commit `267f77a81`. As of the last audit they were **not yet on `production-build`**, so a branch started from production doesn't have them; check with `git -C custom-form-builder grep -n -w isDateRangeFilter origin/production-build -- src/searchBuilder` (Visit.jsx's `isDateRangeFilterOpen` is unrelated). On `development` this commit shifts the `NewSearch.js` / `SearchPreview.js` line hints below by about +25 to +45. In that commit, `NewSearch.js` holds them as state, loads them in edit mode, and fills the date-field options from the same `keys` / `module-keys` endpoints (`fetchDateRangeKeys`). Both `openModal` and `SearchPreview` `handleSubmit` refuse to save with the date range on but no collection or field. The values are sent in both payloads, and the backend saves them (`be-search-builder`). No screen reads them yet; a worklist that should apply the date range must read `properties[0].dateRangeField ?? dateRangeField` itself. Use it as the model for a new search-level setting.
- Longer write-up of every screen: `custom-form-builder/docs/searchBuilder/SearchBuilder.md` (in the repo).

## Save (`SearchPreview.js` `handleSubmit` ~190)

Create -> `PUT tenant-service/search-builder/create-data` with `{ tenant_id, data: { searchbuilder_id: uuidv4(), isActive, isSystemSearch, isSerialNumberRequired, showRiskFlags, properties: { searchbuilder_name, search_group, webpart, fields, redirect_to, ... } } }`, then `navigate(-1)`. Edit -> `PUT .../edit-searchbuilder` with the same values flat. Afterwards it deletes the `patient-header-cache` Cache Storage entry for the tenant.

## Add a new toggle: checklist

| Level | Steps |
|---|---|
| Column (`fields[i].x`) | handler in `NewSearch.js` like `handleTatColorChange`; prop + checkbox in `RenameModal.jsx`; pass both props in the `<RenameModal>` call; read `column.x` in the consumer. No backend change. |
| Field (`db_fields[j].x`) | handler like `handleHidePhoneNumber`; prop + checkbox in `EditFieldModal.jsx`; read `field.x` in the consumer. No backend change. |
| Search (`x` on the search) | state + toggle in `NewSearch.js`; load it in the edit effect (~284); pass through `CommonModal2` (`from === "search"` block, ~254-269) to `SearchPreview`; add to **both** `updateSearchBuilder` and `newSearchBuilder` in `handleSubmit`; **backend `editDraft` needs an explicit `hasOwnProperty('x')` block** (see `be-search-builder`). Read with `data.x ?? data.properties[0].x`. In `history/Visit.jsx` the config keeps only `{ sColumn, isSerialNumberRequired }`: add `x` to the initial `searchData` (~132), to `setSearchData` and `cache.put` after the fetch (~1044-1062) **and** to the cached read (~1027), or the worklist uses a stale/missing value. |

## Runtime consumers

They pick the search via Custom Source Mapping: `getCustomSourceMapping(feature, "searchbuilder_data")` (`utils/LookupFunctions.js`, `configuration-service/organogram/get-custom-source-mapping`), then `GET tenant-service/search-builder/get-searchbuilder-by-id/${tenant}/${id}` and use `properties[0].fields` as `sColumn`. Mapping is edited in `components/customSourceMapping/CustomSourceMapping.jsx`.

| Screen | Feature | Notes |
|---|---|---|
| OP visit worklist `history/Visit.jsx` | `search` | config cached in Cache Storage `patient-header-cache` key `${tenant}` (shown first, refreshed after fetch, ~1015); header filters ~2718 (`isDropdown`: options = unique values of the loaded rows, `save_status` uses visit-status config) and ~2861 (`isSearchable`: text box); filtering is **client-side** on loaded rows (`otherFilters` effect ~363). The date range comes from the worklist's own picker (`fromDate`/`toDate` -> `appointment_date_from`/`_to` query params ~1261, ~1374), not from the search builder. Cells: `components/visitlist/TableBody.jsx` (TAT ~220/708, hide phone ~516, brackets ~789, waiting time ~795, vulnerable ~802) |
| Patient search `PatientSearch/PatientSearch.js` | `search` | rows from `patient-registration/magic-search` |
| Registration/billing worklist `pages/registration/RegistrationWorklist.jsx` | `billing_search` | `development` only (ASPL-172425), not on `production-build` yet; has a test `RegistrationWorklist.test.jsx` |
| Pre-registration `components/workflow/PreRegistrationModalInput.jsx` | fixed id `PRE_REGISTRATION_SEARCHBUILDER_ID` (`constants/searchbuilder.js`) | `getSearchConfig` in `api/search-builder/index.js` |
| Appointments `appointment/AppointmentAction.jsx` | by id | |

`showRiskFlags`, `showVipPatient`, `dropdownFieldKey` and action columns are saved here but not read by any screen in this repo (read in other modules/repos, e.g. the IP module). A new reader goes in the consumer list above.

## Bug-prone spots

- Worklist shows old columns after a save: `patient-header-cache` was not cleared (only SearchPreview save clears it, and only in the browser that saved). Other users see the old config until their cache entry is refreshed by the next fetch.
- Search-level flag works on create but resets on edit: missing in `updateSearchBuilder`, in the edit-mode load effect, or in backend `editDraft`.
- Action column: `handleActionSelection` writes `selectedAction` on an existing column but `RenameModal` reads `selected_action`; check both when a selection "doesn't stick".
- `isDropdown` and `isSearchable` are mutually exclusive by design.
- Searchable filter on a column with several `db_fields` does nothing: the input (~2886) stores the filter under the column `name` (one field -> under that field), the `otherFilters` effect then finds no `item[name]` and returns true (match all); only the hard-coded `"patient detail"` case checks `first_name/middle_name/last_name/patient_phone`. `columnConfig` (~367) is found by field suffix, never by column name. Fix by resolving the column by `name` and matching `some()` over its `db_fields`.
- Collections in the hard-coded config list (`MENU`, `REFERENCE_LOOKUP`, ... `PATIENT_VISIT`, `TASK_ASSIGNMENT_HISTORY`) switch the editor to Module Search and the preview to non-patient search; the list is duplicated in `NewSearch.js` (~305) and `SearchPreview.js` (~129). Change both.
- Preview links per collection (`redirectURL` from `system-global-setting/${tenant}/Search`) are a hand-written chain ~508-565 in `SearchPreview.js`.
- Save does not check `response.data.statusCode`; a duplicate name (backend `statusCode: 500`) still navigates back.

## Verify

- `npm start`; Configuration -> Search Builder: create a search with a filter webpart and two columns, toggle your option, Save, reopen (`/new-search`) and confirm it is still set; check the network payload of `create-data` / `edit-searchbuilder`.
- Open the consuming screen (OP worklist for feature `search`) after clearing Cache Storage `patient-header-cache`, and confirm the column/filter renders.
- `CI=true npm test -- src/pages/registration/RegistrationWorklist.test.jsx` (react-scripts) if registration worklist is touched; then `fe-pre-pr-check`.

Last audited: 2026-10-28 against custom-form-builder@production-build 3c7871e41 (filter settings checked on development 267f77a81)
