---
name: be-emr-data-model
description: Use when changing or debugging how the OP/ER case sheet is saved, edited, signed, revised, read or copied from a previous visit, when a section is missing or saved in the wrong place, admission advice does not reach ATD, HIS sign/unsign sync or prescription send fails, or EMR save audit entries are wrong (postEmrDataV2, save_status, case-sheet audit).
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# OP / ER case sheet: save, read, sign, copy

Code map and storage model: `.claude/rules/backend-emr.md`. Below is `src/emr/emr-data/emr-data.service.ts` unless noted.

## Routes -> methods (`patient-service/emr`)

| Route | Method | v1 copy in `emr.controller.ts` |
|---|---|---|
| `PUT v2/post-emr-data/:tenant_id` (current save) | `postEmrDataV2` | `postEmrDataV2` (~5377) |
| `PUT post-emr-data/:tenant_id` (older save) | `postEmrData` | `postEmrData` (~6445) |
| `PUT edit-emr-data/:tenant_id` | `postEmrDatav2` (lowercase v) | ~7562 |
| `PATCH sign-emr-data/:tenant_id/:patient_visit_id` | `signEmrData` | ~9564 |
| `PATCH revise-emr-data/...` | `reviseEmrData` | ~9600 |
| `GET emr-data/:tenant_id` | `getEMRdata` | |
| `GET copy-patient-visits/:tenant_id` | `copyEMRdata` | |
| `POST post-vital-entry`, `post-notes-entry`, `(v2/)post-follow-up-entry` | `postVitalEntry`, ... | |

The v1 copies have **no** case-sheet audit and **no** HIS status sync. Save/sign fixes usually belong in both.

## Save flow (`postEmrDataV2`)

1. Reject empty `properties`. Load visit, remember `previousSaveStatus`.
2. `audit.beginCaseSheetAudit({...})` - must run **before** any write.
3. Load `PATIENT_REGISTRATION_EMR` and team membership (`EMPLOYEE_SETUP` `employee_type: "Team"`).
4. `cleanData` (compares with `old_data`) -> `processAdmissionAdviseSave` -> `fetchVisitwiseAndRegistrationwiseProperties`.
   - Split: key in `registration_wise[]` -> registration bag; in `visit_wise[]` -> visit; else by `webpartConfigurationArray[].save_type === "RegistrationWise"`. **A key in none of the three is silently dropped.**
5. Role routing:
   - `isNurse: true` -> data is saved under the encounter provider (`user_id = provider_id`), sets `isVitalsTaken`, `nurse_workflow_id`.
   - Not the provider and no/other-assignee `task_history_id`, or `user_role` differs from the task's role -> `saveEMRDataByNewRoles` and **return early** (no audit commit, no Kafka, no favourites).
   - Assignee of `task_history_id` -> `saveAssignedData` into `TASK_ASSIGNMENT_HISTORY` (sign sets `out_time`, `signed_by`), then cured/uncured moves (`updateToBeUpdatedAsCuredData` / `...UnCured...`, `updateNextNode*`), its own `commitCaseSheetAudit` (~784).
   - Provider -> visit-wise data renamed (`renamingKeys`, `name_lookup`) and merged onto the visit; registration-wise into `PATIENT_REGISTRATION_EMR.properties[<user_id>]` (created if missing).
6. `latest*biometry*data` / `latest*examination*data` record who updated which key.
7. `save_status` (`STATUS` in `config/status.config.ts`): `D` draft (default), `S` signed (sets `signed_date`, `signed_by`, `invoice_status: "pending"`, `order*invoice*status` / `medicine*invoice*status` when orders/medication exist - `checkMedicationOrOrdersDataSaved`), `N` assigned; literals not in `STATUS`: `R` revised, `Z` send prescription (after response: `generatePDF` + `notificationEventBuilder(..., 'PRESCRIPTION SENT')`).

## Side effects

| Effect | Where | Notes |
|---|---|---|
| HIS sign/unsign | `syncEncounterEmrStatus` -> `pushEncounterEmrStatus` | Only when signed state flips; POSTs `{report_base_url}/api/VCP/UpdateEncounterEmrStatus` StatusCode `C`/`O`, 3 attempts; result audited as `HIS_ENCOUNTER_EMR_STATUS`. |
| Admission advice | `processAdmissionAdviseSave` | Section **name** regex (`admission.*advi[sc]e`, `admission.*request`, `^admission$`, ...) -> upsert `EMR_ADMISSION_ADVISE` (string literal, not in `TABLE_NAMES`). ATD `get-admission-advice` reads it; booking marks it `Booked`. Renaming the webpart breaks the link. |
| Kafka | `kafkaMiddlewareService.produceEmrData` | when `tenantCheck.isEMR_Producer`. |
| Favourites | `updateDoctorFavouriteCount` | `setImmediate`. |
| Workflow tasks | `triggerTaskData` | Writes `TASK_HISTORY` rows from the tenant's `isTaskManagement` workflow (old task model, not the task engine). |

## Sign / revise / edit

- `signEmrData`: sets `save_status`, `signed_*`; HIS sync; `auditCaseSheet` op `sign-case-sheet`.
- `reviseEmrData`: only provider or team doctor; refuses if already `R`; `isReviseAllowed` + `revise_validity` minutes after `signed_date`. Team doctors update `nonAssignedUserLogs`.
- `postEmrDatav2` (edit): deletes the provider's editable rows (`delete*EditedDataOfProvider`, `deleteEditableOldEmrDataOfProvider`) then re-inserts; audited.

## Read / copy

- `getEMRdata`: visit + `mergeDoctorProperties` (registration bags of all providers) + `findLatestRegEMRData` (latest registration-wise data across the patient's encounters, `cleanCuredData`).
- `copyEMRdata(source, target)`: target `save_status === 'N'` -> latest registration data; else from `previous_visit_id`. Skips webparts/fields in tenant `noCopyConfiguration`. `fetcthModifiedDataForCopy` (sic) shapes the result.
- Readers outside `src/emr`: `extractDischargeData` has 4 copies - `src/utility/utility.service.ts`, `src/utility/utility.controller.ts`, `src/clinical-summary/IPVisitData.service.ts`, `src/functions/AllVisitSummaryService.ts`. Pointer helpers `isWebpartPointer` / `resolveWebpartPointer` exist only in the three service readers (not in `src/emr`). A storage change must be ported to all of them.

## Case-sheet audit (`src/audit/`)

Use the two-phase API, not `@Audit`, because one save scatters across visit, registration bag, task bags and pointer collections.

```ts
const session = await this.audit.beginCaseSheetAudit({
  properties, registration_wise, visit_wise, webpartConfigurationArray,
  patient_visit_id, tenant_schema, acting_user_id, provider_id, is_nurse, task_history_id,
  visit_doc,                       // CaseSheetAuditInput, case-sheet-audit.ts
});
// ... write ...
this.audit.commitCaseSheetAudit(session, { tenant_id, operation: 'save-case-sheet', performed_by, facility_id /*, entity */ });
```

- `begin*` reads "before" on the request path; `commit*` re-reads "after" in `setImmediate`, diffs per section, drops unchanged sections and no-op autosaves. Entity defaults to `AUDIT_ENTITIES.OP_PATIENT_VISIT`.
- One known before/after pair (sign, revise): `EmrDataService.auditCaseSheet` -> `audit.recordAsync`.
- IP: `beginSectionAudit(sections, scope, visit_id, schema)` for registration-wise webparts and `recordWebpartRowsAsync` (`auditIpCaseSheet`) in `src/ip-emr/ipemr.controller.ts`, entity `IP_PATIENT_VISIT`.
- Specs: `src/audit/case-sheet-audit.spec.ts`, `audit.diff.spec.ts`.

## Adding a section behaviour / new write path

1. Find the branch (nurse / assignee / new role / provider) - the same change is often needed in all four, then in `emr.controller.ts`.
2. Keep `begin` before the first write and `commit` after it, on every return path you add.
3. Grid sections: rows in the webpart's `db_obj_name` collection + `{ _id, collectionName }` pointer on the visit/bag.
4. Spec with a fake DB (`be-write-spec`); check readers (`extractDischargeData` copies, `be-print-pdf-templates`, `be-ai`).

## Bug-prone spots

- `saveEMRDataByNewRoles` early returns are not audited.
- `copyEMRdata` builds anchored `RegExp`s from unescaped ids.
- Row system columns (`provider*id`, `task*history*id`, `entered*by`, `is*Cured`) drive "my rows" filters and edit deletion; keep them.

Related: `be-builder-config`, `fe-emr-visit-screen`, `clinical-data-tracer` agent.
