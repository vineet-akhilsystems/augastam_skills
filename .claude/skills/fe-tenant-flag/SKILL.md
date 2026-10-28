---
name: fe-tenant-flag
description: Use when a frontend behaviour must be configurable per tenant or per facility - "tenant-wise flag", "facility-wise setting", "make it configurable", a new checkbox/field in Tenant Setup or Facility Setup, a tenant flag not taking effect or reading undefined, or exporting/promoting tenant configuration across environments.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Tenant and facility flags

## How it works

**Write (tenant)**: `tenantCreate/Tenant.jsx` (tenant create/edit screen) renders `tenantCreate/TenantSetup.jsx` (5k lines).
- `tenantData` state with defaults (`useState({...})` ~89-260), filled from `alltenantSetupData` (the tenant doc from GET `authorization-service/authorization/get-all-tenants`) in the effect at ~344 (`setTenantData({... X: alltenantSetupData?.X || false ...})`), checkbox UI further down (e.g. "Allow Cross Doctor Visit Copy" ~2450), and an effect (~1043) that calls `setTenantSetupData(tenantData)`.
- `Tenant.jsx` `handleCreateTenant`: edit -> PUT `authorization-service/authorization/update-tenant/${id}` with `{tenant_name, tenant_id, tenant_schema, ...tenantSetupData}` (flat); create -> POST `create-tenant` with `tenant_setup: tenantSetupData` (nested).
- Backend `update-tenant` copies fields **one by one** into `TENANT_SETUP`; a flag without a backend line is silently dropped (`be-tenant-data-access`).

**Write (facility)**: `facilityCreate/FacilityPage.jsx` renders `facilityCreate/FacilitySetup.jsx`: defaults in `facilityData` (`useState` ~90-250), load from facility `data` (`setFacilityData((prevFacilityData) => ...)` ~318-480), checkbox (e.g. `AllowCrossDoctorVisitCopy` ~1457), `setFacilitySetupData(facilityData)`. `FacilityPage` saves `properties: [facilitySetupData]` via PUT `authorization-service/authorization/edit-facility/${id}` / `create-facility`, **only when `isFacilitySetupApplicable`** is on for that facility.

**Read**: `components/Topbar.js` `fetchData` effect (runs once on mount) -> `getSetupData([...keys])` (`appointment/AppointmentAction.jsx`) -> PATCH `authorization-service/authorization/fetch-facility-key-value?tenant_id=&facility_id=<first facility in sessionStorage "facility">` with `{key: [...]}` -> response is a bare `{key: value}` object -> `dispatch(setX(setupData?.X ?? default))` -> Redux `tenantSetup` (`Redux/Reducers/tenantSetupSlice.js`). Screens read `useSelector((s) => s.tenantSetup?.X)`. A few screens call `getSetupData` directly for one-off keys (`AppointmentForm.jsx`, `Visit/TaskHistory.jsx`).

**Source selection (backend)**: if the facility has `isFacilitySetupApplicable`, **every** key is read from the facility `properties[0]`; otherwise every key comes from `TENANT_SETUP`. There is no per-key fallback (the comment in `Topbar.js` says otherwise). Hence the TODO in `tenantSetupSlice.js`: a tenant flag missing from Facility Setup reads `undefined` for facility-setup facilities. Keys found nowhere are omitted; if none are found the response is `{statusCode: 400, message: "Key value not found."}`.

**Persistence**: `tenantSetup` is in the redux-persist whitelist (sessionStorage, per tab). A changed flag reaches a user only when `Topbar` mounts again: log out and in (or full reload of that tab). Other open tabs keep the old value.

## Add a flag (in order)

| # | File | Change |
|---|---|---|
| 1 | `tenantCreate/TenantSetup.jsx` | default in `tenantData` init; `X: alltenantSetupData?.X \|\| false` in the load effect; checkbox `checked={tenantData?.X}` / `setTenantData({...tenantData, X: e.target.checked})` in the matching section |
| 2 | `facilityCreate/FacilitySetup.jsx` | same three places (`facilityData` default, load from `data`, checkbox) |
| 3 | backend | `update-tenant` / `create-tenant` field copy, and facility handling if needed (`be-tenant-data-access`) |
| 4 | `Redux/Reducers/tenantSetupSlice.js` | `initialState.X`, reducer `setX`, export the action |
| 5 | `components/Topbar.js` | key in the `getSetupData([...])` list, import `setX`, `dispatch(setX(setupData?.X ?? false))` |
| 6 | consuming screen | `const X = useSelector((s) => s.tenantSetup?.X ?? false)` |
| 7 | `custom-form-builder/docs/tenantCreate/TenantSetup.md` | Description / Behavior (Off default, On) / Use Case, like the existing entries |

Pattern to copy end to end: `AllowCrossDoctorVisitCopy` (all files above, consumed in `components/modals/SidePreviousModal.jsx`) or `payerWiseExclusion` (consumed in `TableBuilder/FilteredConditionDropdown.jsx`).

Keep the key name identical in all layers (case matters: `AllowCrossDoctorVisitCopy` is capitalised everywhere). Non-boolean values (objects like `revise_properties`, `template_properties_on_sidebar`) need their own dispatch shape in `Topbar.js`.

## Cross-environment export

`tenantCreate/CrossEnvTenant.jsx` (`/export-cross-tenant`) exports configuration masters (webparts, lookups, menus, search builder, report builder, data attributes, lookup mapping, custom source mapping, step master, process master) via `authorization-service/authorization/.../export-*` calls with `network=<target env>`. Step master is exported **before** process master because processes re-point to steps in the target. It does not carry Tenant Setup flags: set new flags in Tenant/Facility Setup on each environment (or check `be-tenant-data-access` for promote/clone behaviour). A new exportable master goes into `exportData`, `selectedExportData`, the grid UI and the sequential import calls, keeping dependency order.

## Bug-prone spots

- Flag saved in tenant but ignored at a facility with Facility Setup on (step 2 missing).
- Flag never stored: backend `update-tenant` doesn't copy it.
- Stale value: persisted slice; tester didn't log out/in.
- `|| false` in the load effect turns a saved `0`/`""` into `false`; use `??` for numbers/strings.
- `getSetupData` uses only the **first** facility in sessionStorage `facility`.
- `TenantSetup.jsx`/`FacilitySetup.jsx` are huge: add lines next to a neighbouring flag, don't reformat.

## Verify

- `npm start`; Tenant edit screen: toggle, save; reload the tenant: checkbox still on (proves backend storage).
- Log out/in; DevTools Network `fetch-facility-key-value` response has the key; Redux DevTools `tenantSetup.X`.
- Repeat with a facility that has Facility Setup on.
- No tests cover these files; run `fe-pre-pr-check`.
