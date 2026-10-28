---
name: fe-emr-visit-screen
description: Use when changing or debugging the frontend patient visit / EMR screen (/patient) - workflow stages and tasks shown in the visit, save as draft, sign, revise, the previous visit side panel, copy previous visit, a new right-sidebar side modal, a new task property, visit dates/age, or modals overlapping each other or the voice widget.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# EMR visit screen

## How it works

```
visit list row (components/visitlist/TableBody.jsx handleRowClick)
  setParamsEMR({pid, eid, vDate, task_history_id})
  navigate("/patient", {state: {workflowId, patient, visitDate}})
-> ComponentRoute.js  <Route path="/patient" element={<Patient />}>   (no PrivateRoute)
-> "EMR Flow/Patient.jsx"   reads useLocation().state; renders
     <EMRPreview wId={workflowId} key={patient?.patient_id}>   (EMR/EMRPreview.jsx)
     <PatientVisits>   right sidebar ("EMR Flow/PatientVisits.jsx")
   header + save buttons: "EMR Flow/PatientHeader.jsx"
```

**State** lives in `PatientContext` (`"EMR Flow/PaitentContext.jsx"`, provider is app-wide): `paramsEMR` (mirrored as plain JSON to sessionStorage `localParamsEMR` and restored from it on reload), `contextTaskData` (array, one entry per task: `{[webpart_name]: data}`; multi-entry webparts carry `allData` + `webpartDetails`), `patientPrefillData` (what webparts render from), `oldPatientPrefillData` (snapshot of the loaded visit, sent as `old_data`), `contextRegistrationWiseArray`, `contextVisitWiseArray`, `contextReadOnlyArray`, `uniqueFieldWiseWebpartName`. Redux `visitData` (`features/patientVisit/visitDataSlice`) only holds visit-list state; `Emr` slice holds `saveStatus`, `activeSearchableChip`, etc.

**Workflow**: `EMRPreview` -> `fetchWorkflowVersions(workflowId, version)` (`utils/api.js`) GET `configuration-service/workflow/get-workflow/properties/${tenant}/${id}`; uses the last version if `published`, else the one before. `stages` (filtered by `hasAccess`) -> `process[0].tasks` -> `renderTask` (~373) -> `TabTaskPreview` (if `task.properties.isTab`) or `TaskPreview` (`workflow/Preview/`) -> `WebpartPreview` per webpart (`fe-webpart-field-type`).

**Read**: `EMRPreview` effect (~895) GET `patient-service/emr/emr-data/${tenant}?registration_id=&patient_visit_id=` -> `setPatientPrefillData(patient_details)` and `setOldPatientPrefillData` (it synthesizes a `Vitals` array from flat vital keys if missing).

**Save** (buttons in `PatientHeader.jsx`, functions in `"EMR Flow/EmrActions.js"`):

| Action | Call | Body essentials |
|---|---|---|
| Save as Draft | `handleSubmitVisit({save_status: "D"})` -> PUT `patient-service/emr/post-emr-data/${tenant}` | `properties` = merged `contextTaskData` keyed by **webpart name**, minus `readOnlyArray` keys; `registration_wise`, `visit_wise`, `biometry_array`, `examination_array`, `task_history_id`, `old_data`, `webpartConfigurationArray`, `autoFetchSingleEntry` |
| Signed and Print | same, `save_status: "S"`, `out_time` | |
| Other doctor's edited data | `handleEditedSubmitVisit` -> PUT `emr/edit-emr-data/${tenant}` | `editedData` = `contextTaskDataEditedByDoctor` |
| Revise | `handleRevise` -> PATCH `emr/revise-emr-data/${tenant}/${eid}`, gated by tenant `revise_properties` | |

`saveStatus` `N` = new/unsaved visit, `D` draft, `S` signed. `handleSaveAsSigned` (PATCH `sign-emr-data`) exists but nothing calls it. Task-wise save (`configs.shouldTaskWiseSave`) posts from `TaskPreview` `handleSubmitVisit`. Backend side: `be-emr-data-model`.

## Previous visits and copy (`components/modals/SidePreviousModal.jsx`, 4.6k lines)

- One visit's data: `fetchOneVisitData` branches by `source_type`: `IP` (discharge summary), `OLD_OP` (`visit_url`), `ER` (`inpatient-service/ip-emr/get-er-patient-data`), else POST `patient-service/emr/previous-all-history/${tenant}`. `latestVisitFetchIdRef` drops responses from an older click.
- Copy whole visit: `handleCopyToCurrentVisitData` GET `emr/copy-patient-visits/${tenant}?registration_id&patient_visit_id&target_visit_id`. Copy one doctor's slice: `handleCopyToCurrentVertical` GET `emr/copyPatientVisit/...&task_history_id=`, allowed only for own visits unless tenant `AllowCrossDoctorVisitCopy` (`canCopyVisitData`).
- Both: `filterDetailsBySelectedWebparts` -> `remapCopyKeysToWebpartNames` (data keys like `medication` -> current webpart names like `Medications`; exact, `webpart_name`, `db_obj_name`, then unambiguous fuzzy; never overwrites) -> `setPatientPrefillData(prev => mergeCopiedVisitData(prev, ...))`. Grids pick it up through `patientPrefillData[webpartName]` (`fe-grid-webpart`).
- **Rule: merge, never replace.** Empty copied values are skipped; grid rows go through `duplicateCheckRespectToKeyName`; cross-tab/examination/biometry replace (multi-entry cross-tab appends).
- AI summary inside the modal is gated by AI service code `SUMAI` (`useAiService(AI_SERVICE_CODES.SUMMARIZE_AI)`).
- Tenant `patient_visit_auto_open` opens this modal on load (`PatientVisits.jsx`).

## Add a right-sidebar side modal

1. Component in `components/modals/Side<Name>Modal.jsx`; copy the overlay/panel styles of `SidePreviousModal` (overlay `zIndex: 9999`, panel `10000`, `isVisible` slide transition).
2. `PatientVisits.jsx`: `const [is<Name>Open, set...] = useState(false)`, an entry in `sideBarIcons` (`closeAllModals(); set...(true); e.stopPropagation();`, `icon`, `name`), and mount `<Side<Name>Modal isOpen=... onClose=... />` with the others at the bottom. Add it to `closeAllModals` if it must close when another opens.
3. Text through `t("system.*")`; any API per `fe-call-api`.

## Add a task property (flag on a workflow task)

1. `workflow/StageComponents/Task.jsx`: initial `taskProperties` (~55-85), the switch UI (`handlePropertyChange("myFlag", e.target.checked)`), and the reset `useEffect` (~134) that **rebuilds properties from an explicit list**; omit it there and the flag is lost on redirect-type change.
2. Read `task.properties.myFlag` in `TaskPreview.jsx` and `TabTaskPreview.jsx` (both), or in `EMRPreview` `renderTask` if it changes layout.
3. Published workflow only: republish the workflow to test.

## Bug-prone spots

- Copy overwriting current entries or binding to nothing (key mismatch): fix in `remapCopyKeysToWebpartNames`/`mergeCopiedVisitData`, keep merge semantics.
- Dates: `convertDateFormat` in the modal splits on `/` (`DD/MM/YYYY[ time]`) and returns other formats unchanged; `paramsEMR.vDate` comes from `formatDateToDDMMYYYY(..., "navigation")`. Convert server timestamps to local time with the existing helpers, not new string slicing. Age for a past visit: `calculateAgefromVisitDate(visit_date, dob)` (`utils/utilities.js`), not `calculateAgefromDOB`.
- Z-index: side modals 9999/10000; `SideTemplateModal` uses 99999 inside; the voice widget (`components/AugastamVoiceWidget/AugastamVoiceWidget.css`) uses very high values. Check new overlays against both (`fe-voice-ai-widgets`).
- `paramsEMR` empty after reload in a new tab (sessionStorage is per tab).
- `Patient` is not behind `PrivateRoute`; don't rely on route permission checks here.

## Verify

- `npm start`, open a visit from the visit list: change data, Save as Draft, reload (data from `emr-data`), open Patient Visit panel, copy a previous visit, confirm nothing existing was lost, then Sign.
- DevTools Network: `post-emr-data` body `properties` keys are webpart names.
- No tests cover these files; run `fe-pre-pr-check`.
