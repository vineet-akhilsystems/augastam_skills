---
name: fe-report-builder
description: Use when changing or debugging the frontend SQL report builder or report preview - "report builder", "SQL report", "saved report", report filter, join, key field, column, alias, group by/summary, calculated or serial column, export to Excel/CSV/PDF/print, Postgres/billing reports, reports shared by role, "assigned report preview", or report-builder:check failing.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# SQL report builder

Not to be confused with `src/reportBuilder/` (the **print format** editor `TextEditor.jsx`, see `fe-prescription-printout`).

## How it works

| Route | Component |
|---|---|
| `/report-builder` | `pages/reportBuilder/ReportBuilder.jsx` (~4.7k lines): pick module/objects, fields, joins, filters, group/summary, extra columns; run, save, export |
| `/report-preview/:reportId` | `pages/reportBuilder/ReportPreview.jsx`: read-only run of a saved report (opened from the builder, or a menu entry for assigned reports) |
| `/report-viewer` | `pages/reportViewer/ReportViewer.jsx`: legacy, no `PrivateRoute`, old `configuration-service/report-builder/GetSqlquery` and `Sqlquery` endpoints. Don't extend |

Endpoints (`reportBuilderUtils.js`; `getReportSchemaSource(module)` returns `"postgres"` when the module name matches `/BILLING/i`, else `"mongo"`):

| Purpose | Mongo | Postgres (BILLING) |
|---|---|---|
| Schema | `GET patient-service/report/get-collection-schema/{tenant}` | `get-postgres-schema/{tenant}` (+ `refresh-postgres-schema`, `report-sync/resync?mode=`, `resync-status`) |
| Run | `POST patient-service/report/Sqlquery/{tenant}` `{sql, page, limit}` | `pg-sqlquery/{tenant}` |

Saved reports (`reportSavedQueries.js`, all with `role_id` query param from `sessionStorage.role_id` via `getReportRoleParams`): `GET GetSqlquery/{tenant}`, `POST savequery/{tenant}`, `POST updatequery/{tenant}/{id}`, `POST deletequery/{tenant}/{id}` (soft delete). `persistReportQuery` never throws; it returns `{ok, message}`. Roles a report is shared with: `report.roles[]`, older reports `role_id`.

### Data flow

```
UI state --buildReportSql (reportSqlBuilder.js)--> sql --run--> rows
UI state --buildReportSavePlanPayload (reportBuilderUtils.js)--> plan
plan --applySavePlanToReportBody--> body (+ column_order, custom_columns, serial_column,
        hidden_columns, calculated_columns, group_options; top-level AND query_config.*)
saved report --normalizeSavedReportState / parseReportSqlToTableState, parseWhereToFilters
        (reportSqlParser.js)--> UI state
```

Plan keys: `sql_query, version, editor_mode, base_object, objects, fields, field_aliases, joins, join_plan, join_warnings, join_type, join_types_by_edge, join_keys_by_edge, filters, group_by, summary_fields, selected_date_range, custom_date_range`. Code mode (`editor_mode: "code"`) derives the plan from SQL via `parseSqlToPlan`.

Filter row: `{module: "<table.column or column>", operator, value, conjunction: "AND"|"OR"}`. Filters always go to WHERE (never LEFT JOIN ON).

## Add a filter operator (files in order)

1. `FilterModal.jsx`: `OPERATORS`; also `NO_VALUE_OPERATORS` / `MULTI_VALUE_OPERATORS` and the value input branch (~line 121) if it takes no/many values.
2. `reportSqlBuilder.js`: `SUPPORTED_FILTER_OPERATORS` and `buildFilterCondition`.
3. `reportSqlParser.js`, three places: `parsePredicate` (SQL -> row; `COMPARISON_OPERATORS` for symbol ops, keyword list if new keyword), `LIST_FILTER_OPERATORS` / `NO_VALUE_FILTER_OPERATORS`, and `buildWhereTextFromFilters` (row -> WHERE text).
4. `reportSqlParser.test.js`: round trip table -> SQL -> table.
5. Backend must support it in both dialects (`be-reports`).

## Add an export format

`reportExport.js` (add `downloadXFile`, reuse `buildExcelRows`/`buildCsv` shaping, respects `REPORT_EXPORT_ROW_LIMIT` = 5000) -> `handleExport` in **both** `ReportBuilder.jsx` and `ReportPreview.jsx` + their buttons. Print/PDF goes through `reportPrint.js` + `PrintableReport.jsx`. Export rows are re-fetched with `fetchExportRows` (page 1, export limit) then `applyExtraColumnsToRows` and `omitHiddenColumns`, so they match the screen.

## Add a column option

`ExtraColumnsModal.jsx` (`onApply` payload) -> normalizer in `reportBuilderUtils.js` (`normalizeCustomColumns`, `normalizeSerialColumn`, `normalizeHiddenColumns` style) or `reportSqlBuilder.js` if it changes SQL (`normalizeCalculatedColumns`) -> save in `ReportBuilder.jsx` save handler (~line 555: set on `reportBody` and `reportBody.query_config`) -> restore in the saved-report loader (~line 2600-2650) -> read in `ReportPreview.jsx` (it restores from `report.query_config.*`).

## Copies to change together (mirror rule)

`scripts/sync-report-builder.js` mirrors 13 files to `augastam-ip-module/src/reportDashboard`: `reportSqlBuilder.js, reportSqlParser.js, FilterModal.jsx, ReportPreview.jsx, ResultCard.jsx, reportExport.js, reportPrint.js, PrintableReport.jsx, reportQuickFilterUtils.js, useStableCallback.js, SavedReports.jsx, ReportModal.jsx, reportSavedQueries.js`. **Not mirrored:** `ReportBuilder.jsx`, `reportBuilderUtils.js`, `ExtraColumnsModal.jsx`, `ReportObjects.jsx`, CSS. A mirrored file that imports a new export from `reportBuilderUtils.js` also needs that export in the IP repo's own copy.

```bash
npm run report-builder:check   # exit 1 = drift, exit 2 = ../augastam-ip-module not checked out
npm run report-builder:sync    # overwrite IP copies (ask first; it's another repo)
```

## Bug-prone spots

| Symptom | Look at |
|---|---|
| Join on wrong key / rows multiply | `join_keys_by_edge`, `suggestJoinKeyPairs`, `normalizeJoinKeysEntry` |
| Filter silently dropped | `getFilterFieldName` (unqualified `module` after the column was deselected); `unresolvedModules` |
| Reopened report differs from saved | parser can't map the SQL (code mode only), or a new option saved only top-level and not in `query_config` |
| Billing report empty / schema missing | module not matching `/BILLING/i`; Postgres sync stale (resync) |
| Report invisible to a user | saved without their role; `role_id` missing in sessionStorage |
| Work vanished after a merge | happened before (restored in `6254a5ba0`); diff the 4.7k-line file carefully |
| `FileFormat.jsx` | dead file with a hard-coded devtunnels URL and tenant; don't import it |

## Verify

- `npm start` -> `/report-builder`: build a 2-table report with a filter of each operator, run, page, save, reopen, switch Table <-> Code, export CSV/Excel, print; open `/report-preview/<id>` as a non-admin with the role.
- Tests: `npx react-scripts test --watchAll=false src/pages/reportBuilder` (`reportSqlParser`, `reportSavedQueries`).
- `npm run report-builder:check`, then `fe-pre-pr-check`.
