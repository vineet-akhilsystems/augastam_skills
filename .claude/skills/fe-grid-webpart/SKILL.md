---
name: fe-grid-webpart
description: Use when changing or debugging a grid / multi-entry webpart in the frontend - medication, orders or service grid rows, Enter/Tab/arrow keys in the grid, dropdown or filter-condition lookup in a cell, frequency/dose/unit/route defaults, dose calculator, brand/generic, "append past data", copy into a grid, adding or deleting rows, or grid data not reaching the EMR save.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Grid (multi-entry) webparts

## How it works

`TableBuilder/TablePreview.jsx` (5.5k lines) renders every webpart with `isGrid`. Callers:

| Caller | Note |
|---|---|
| `components/WebpartPreview.jsx` (`isGrid ?` branch ~2357) | EMR/workflow tasks |
| `workflow-ui/previewer.jsx` (~2542) | **identical prop list**; a new prop goes in both |
| `nursesActivity/preview/NurseIpTablePreview.jsx` | thin wrapper |
| `/table-preview` route | builder preview; columns fetched with `&version_number=`; the sync-to-parent effect is skipped on this route |

`careplanSetup/CareplanTablePreview.jsx` is a **separate** 400-line grid (uses `GridCell`), not a wrapper.

**Columns**: from the `wpDetails` prop (`data[0].properties[0].fields`, through `processColumns`); only if absent, GET `configuration-service/webpart/latest-version/${tenant}?webpart_id=`. Webpart flags (`isMedication`, `isOrders`, `isAllergy`, `isUnderAgeDoseCalculation`, `isPreviousAppend`, `isTapering`, `dontCheckDuplicate`...) come from `properties[0]`. `uniqueField` = first column with `attributes.duplicateCheck`/`duplicateCheckNotification`, else the first column (the "primary" column).

**Rows**: local `rowData` (row = `{[columnName]: value, [columnName*id]: id, ...}`), with parallel per-row arrays `rowDataId` and `filteredOptions`; keep all three aligned when inserting/deleting. The effect at ~2175 pushes `rowData` to the parent via `setTableData` when `!deepCompareArrays(rowData, tableData)`, dropping a blank last row (`filterBlank`). WebpartPreview then sets `formData[webpart_name] = rowData`. **There is no grid save endpoint**; the EMR save (`post-emr-data`, `fe-emr-visit-screen`) persists it. An effect (~1748) auto-adds a blank row when the last row is filled (`handleAddRow` in `TableBuilderActions.js`), skipped for `disableAutoAddRow`/`showDisabledTable`/no-known-allergy.

**Cells**: `TableBuilder/RenderColumn.jsx` `switch (column.type)`; `filter condition` / `filter condition v2` -> `TableBuilder/FilteredConditionDropdown.jsx`. Single-entry sibling (different code, same endpoints): `components/builder/FilterConditionDropdownField.jsx`.

## Lookup dropdowns (filter condition)

- Fetch: `tenant-service/employee/filter-condition-value/${tenantId}?module_filter=...&module_field=...&data_id=<parent value>` or `filter-condition-value-v2/...&is_<parent_lookup_type>=true`.
- Child options: `toFilterConditionOptions(options, columnName)` (`TableBuilder/utils.js`) flattens rows for `FILTER_CONDITION_ROW_KEYS = ["dose","unit","route","frequency"]`; if exactly one option comes back it is auto-selected and written to `rowDataId`. For `moduleWebpart === "service_uom"`, `handleServiceUom` (`TableBuilder/api.js`) writes the chosen UOM back to the pharmacy master (PUT `tenant-service/employee/update-pharmacy`).
- Create new value: `onCreate` -> `createLookupValue` (`api/CreateDropdownItem.js`) PUT `configuration-service/reference-lookup/add-lookup-values/...`, appends to the IndexedDB worker cache (`cache/workerClient.js`, store `lookup`/`lookup-mapping`, key from `getLookupCacheInfo`) and deletes `latest-lookup-cache` entries.
- Payer exclusion: when tenant flag `payerWiseExclusion` is on, selecting a medicine calls `checkPayerWiseExclusion` (`utils/api.js`); excluded -> toast "Payer has excluded this medicine". `payerCheckRef` prevents duplicate calls.
- Brand/generic: `handleDropdownChange` (~871) stores `col*generic_name`/`col*brand_name` when tenant `brandGenericMapping` is on, and `col*search_by` (All/Generic/Brand from Redux `Emr.activeSearchableChip`) for the medication primary column; the printout uses it.

## Keyboard

`FilteredConditionDropdown` `handleSelectKeyDown` decides first: recent-suggestion list owns arrows/Enter; Enter with typed text and a highlighted option picks it (`pickFocusedOption`); Enter with unmatched text saves it to the row (and creates it if creatable). Everything else goes to `TablePreview` `handleKeyDown` (~2526): Enter without prior arrow navigation jumps to the next row (`handleRowClick(rowIndex + 1)`); Tab moves through `refs.current`, wrapping to a new row; Escape closes dropdowns; ignored in `modal-wise` mode.

## Medication specifics

| Behaviour | Where |
|---|---|
| Field defaults (`attributes.hasdefaultValue`/`defaultValue`) | `RenderColumn.jsx` effect (~229): only rows without `${uniqueField}*id` at mount (new rows), dependent columns only after the medicine is chosen, never read-only/hidden/non-empty cells; dropdowns wait for options |
| Paediatric dose | `RenderColumn.jsx` effect using `service*paediatric*dose` (pharmacy master), weight from the `Vitals` webpart in `contextTaskData`, DOB; doc `custom-form-builder/docs/TableBuilder/ServicePaediatricDoseCalculation.md` |
| Total quantity / tapering / variable dose | `calculateTaperingAndVariableTotalDose` (~1485) -> POST `patient-service/emr/medication-calculation/${tenant}`; target column has `attributes.codeFieldOptions`; also called from `components/TaperingMedication.jsx`, `components/VariableDose.jsx` |
| Append past data (`isPreviousAppend`) | effect ~1823 appends the previous visit's rows, sets `hasAppendedData` |
| Prefill / copy into grid | effect ~2470 reads `patientPrefillData[webpartName]`; `appliedPrefillRef` compares content so a re-render can't clobber appended rows but a new prefill (AI "Copy to EMR", copy previous visit) still applies |
| Delete | `handleDeleteRow` (~1307) also removes tapered child rows; bulk delete via `selectedRowsForDelete`; billed rows can't be deleted |

Primary-field enforcement ("fill the primary field before the next row") was added in July 2026 and removed again (commit `4468426a1`); don't reintroduce it without asking.

## Bug-prone spots

- Enter selecting the wrong option or adding a row: the two key handlers above interact; test typed text, arrow-selected, and mouse-selected cases.
- Defaults not applying: row already has `*id` (loaded row), options not loaded, cell hidden by scoping, or a dependent column before the medicine.
- New lookup value not visible: worker cache not updated (no `storeName`/`cacheKey`) or `latest-lookup-cache` key mismatch.
- Unit/route/dose not binding: the child column's `columnName` must match a `FILTER_CONDITION_ROW_KEYS` entry, else labels fall back to `unit`.
- Parallel arrays (`rowData`, `rowDataId`, `filteredOptions`) out of step after delete/insert.
- Changing only `WebpartPreview` or only `previewer.jsx` props.

## Verify

- `npm start`; open a patient visit with a medication grid: add two medicines with Enter and Tab, pick a single-option unit, delete a row, save draft, reload; data must round-trip in `post-emr-data` `properties[<webpart name>]`.
- Also check the workflow-ui screen and `/table-preview`.
- No tests cover TableBuilder; run `fe-pre-pr-check`.
