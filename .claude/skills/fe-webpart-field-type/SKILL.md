---
name: fe-webpart-field-type
description: Use when adding a field type or control to the form builder, a new field attribute/flag/toggle, a new webpart kind or webpart-level flag (isXxx), or when a field is not showing, not saving or behaving differently in one webpart screen (EMR, workflow, registration, grid, print).
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Webpart field types and flags

## How it works

Two levels of configuration, both saved by `configuration-service/webpart/*` (backend: `be-builder-config`).

| Level | Screen | Code | Saved as |
|---|---|---|---|
| Webpart kind/flags (`isGrid`, `isMedication`, ...) | `/webpart` (`pages/datagroup/DataGroups.jsx`) opens `NewWebpart.jsx` modal | `initialFlags` (~78-168), `allWebpartKinds` (~264, the "kind" dropdown; on edit the first kind that is `true` is selected), per-flag `<Switch>` blocks | create: `handleNewFormRequest` -> `buildRequestBody` (lists every flag **explicitly**) -> PUT `configuration-service/webpart/new-webpart`; edit: `handleUpdateWebpartConfig({...flags})` (`utils/api.js`) -> PUT `webpart/edit-draft`. Both `caches.delete("webpart-cache")` |
| Field + its attributes | `/form-builder` (`components/formBuilder/FormBuilder.jsx`) | type picker `fieldTypes` in `FieldDetails.jsx`; toggles in `FieldAttributes.jsx`; validation toggles in `components/Validation.jsx` | `handleAddField`/`handleUpdateField` (`formBuilder/utils.js`) build `{name, columnName, type, category, attributes: {...fieldAttributes, ...}}` into sessionStorage `config` (`{category: [fields]}`) + `categories`. `handleSaveWebpart(draft, formId)` (`utils/api.js`) -> `prepareCommonData` (`utils/utilities.js`) -> PUT `webpart/create-draft` or `edit-draft` with `{tenant_id, webpart_id, categories, fields, masked_fields}` (`masked_fields` from `attributes.sensitive`). Publish: `handlePublishWebpart` -> PUT `webpart/publish-webpart`, clears `webpart-cache` and `webpart-fields-cache` |

`handleAttributeChange` (FormBuilder.jsx) writes `[name]: checked|value` into `fieldAttributes`, which is spread into `attributes`, so a new toggle is saved without touching the save code.

Runtime reads webpart flags from `wpDetails.data[0].properties[0]` and field config from `properties[0].fields`. Screens render the **published** version: a draft-only change is invisible in EMR.

`components/WebpartPreview.jsx` (4.7k lines) renders single-entry webparts: `formValues` keyed by `columnName`; `handleChange` (asks to confirm if-then rules) -> `applyChange`, which writes `[name]: value`, `${name}*id` when `attributes.send_selected_id`, `additionalValues`, and runs `evaluateRule`. It does this in **three places**: `setFormValues`, `formData` (parent EMR state) and `formData3` (multi-entry). It never saves; the parent screen does (`fe-emr-visit-screen`). Rendering is one `{type === "..." && (...)}` block per type (~3500-4480). Grid webparts go to `TablePreview` (`fe-grid-webpart`).

## Add a field attribute / toggle (most common)

1. `FieldAttributes.jsx`: `<SwitchFullCol id="myFlag" label={getSystemName("my_flag")} fieldAttributes={fieldAttributes} onChange={handleAttributeChange} disabled={viewOnly} />`, inside the `selectedType` condition it belongs to. Validation-style flags go in `components/Validation.jsx` instead.
2. If it only applies to some types, add it to `fieldValidationPair[type]` (FormBuilder.jsx ~980); `onDataFieldTypeChange` resets those keys to `false` when the type changes.
3. Label: `system.my_flag` in `locales/{en,hi,ar}/global.json` (`getSystemName` falls back to the raw key).
4. Read `field.attributes.myFlag` in **every renderer copy** that shows the type (table below).
5. Note it in `custom-form-builder/docs/components/formBuilder/FieldAttributes.md`.

## Add a field type (in order)

1. `FieldDetails.jsx` `fieldTypes`. `fieldOptions` limits cross-tab webparts to a short list and ocular motility to `dropdown`; extend those if needed.
2. `fieldValidationPair` + `Validation.jsx` for its validation toggles; type-specific config in `FieldDetails.jsx` (see the `medicine instruction` block ~972).
3. Control in `components/builder/` (WebpartPreview imports these), then the same control in `webparts/components/` and `components/registration/builder/` if those screens must show it.
4. `WebpartPreview.jsx`: a `{type === "x" && <XField .../>}` block next to the others, calling `handleChange(e, false, false, field)`.
5. `workflow-ui/previewer.jsx` (+ `workflow-ui/WorkflowMultiEntryTable.jsx` cell `if (type === ...)`).
6. `components/registration/RegistrationWebpartPreview.jsx`.
7. `TableBuilder/RenderColumn.jsx` `switch (column.type)` (grid cell; `default:` renders a fallback).
8. `components/MultipleEntryPreview.jsx`.
9. Display/print: `prescription/allPrintTypes.js`, `prescription/utils.js`, `components/modals/SidePreviousModal.jsx`, `workflow/Preview/TaskPreview.jsx` (they branch on `file upload`, `date`, `textfield-dropdown`, `WordProcessor`...).

## Add a webpart kind / flag (`isXxx`)

1. `NewWebpart.jsx`: `initialFlags`, the `flags` destructure, `buildRequestBody` (create path drops anything not listed), the `<Switch>` (or an `allWebpartKinds` entry for a mutually exclusive kind). Kind switches reset sibling flags (`isGrid: false, ...` blocks ~1568); include the new one if it conflicts.
2. Consumers read `wpDetails?.data?.[0]?.properties?.[0]?.isXxx` (WebpartPreview ~260, TablePreview ~190).
3. Check `be-builder-config` for whether the backend must store or act on it.

## Calculated fields ("Evaluate Rule")

- A field with `attributes.evaluateRule` gets its value from a rule (`selectedRule`, `ruleTargetField`) fetched by lookup name in the rule-loading effect of `WebpartPreview.jsx` (comment "Get the rules if evaluate rule is true"). It loads rules from the **first** field with `evaluateRule` only (`parsedConfig3.find(...)`), and `applyChange` evaluates every calculated field against that one list. A second calculated field in the same webpart (e.g. infusion total volume and duration next to flow rate) gets the wrong rule or none.
- Rule expressions can reference `data.<field>` values and option multipliers (`code` / `minute` / `hour`, resolved near the "duration.minute" comment).
- Same single-list logic in `TableBuilder/TablePreview.jsx`, `workflow-ui/previewer.jsx` and `components/registration/RegistrationWebpartPreview.jsx`, without all of the token handling: fix a calculation bug in each copy the screen uses.
- First check in `/form-builder` whether the field is rule-driven or a formula field: different code path.

Render chain to find which copy a screen uses: EMR visit and standalone previews (e.g. `/infusion-sets` via `features/infusionSets/InfusionSetEditor.jsx`) go `EMRPreview` -> `TaskPreview` -> `FormPreview` -> `pages/Preview.jsx` -> `components/WebpartPreview.jsx`; workflow-ui pages use `workflow-ui/previewer.jsx`; registration uses `RegistrationWebpartPreview`.

## Copies to change together

| Screen | Renderer | Controls from |
|---|---|---|
| EMR visit, workflow tasks | `components/WebpartPreview.jsx` | `components/builder/` |
| Newer workflow renderer | `workflow-ui/previewer.jsx` | `webparts/components/` |
| Registration | `components/registration/RegistrationWebpartPreview.jsx` | `components/registration/builder/` |
| Grid cells | `TableBuilder/RenderColumn.jsx` | inline |

Fix the copy the screen imports, then grep the others and say whether they need it.

## Bug-prone spots

- **Not showing**: not published; `hideField`; a `scopingList` rule hides it; type has no renderer in that screen. Trap: `medicine instruction` is selectable in the picker but has **no** renderer in WebpartPreview, previewer or RenderColumn (only `prescription/utils.js` `isInstructionField` knows it).
- **Not saving**: key is `columnName` (renaming it orphans saved data); `send_selected_id` adds `col*id`; keys in `readOnlyArray` are stripped on EMR save; logic added to only one of the three `applyChange` write paths.
- Scoping/visibility regressions after touching `consolidateScopingLists` handling in `applyChange`.
- Performance rewrites of WebpartPreview have caused regressions; edit the one block you need.

## Verify

- `npm start`; `/webpart` create/edit the webpart; `/form-builder` add the field, save, publish; check `/form-preview`; open a patient visit and the workflow-ui screen that uses it.
- DevTools Network: `edit-draft` payload has `attributes.myFlag`; `post-emr-data` `properties[<webpart name>]` has the value.
- No tests cover these files; run `fe-pre-pr-check`.
