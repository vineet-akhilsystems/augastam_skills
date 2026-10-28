---
name: be-inpatient
description: Use when building or fixing inpatient (IP/ATD) features - admission advice, admission booking, admit/direct admission, bed master, bed allocation/transfer/retain, doctor transfer, IP case sheet save, progress notes, referrals, discharge process steps, discharge/death summary, IP medication orders, MAR doses, nurse acknowledgement, pharmacist verification, verbal orders, substitution, indents or infusions.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Inpatient: ATD, IP EMR, discharge, medication

File map, bed statuses and `-internal` routes: `.claude/rules/backend-ip-emr.md`. Step codes / reference ids: `src/task-management/ip-admission-task.util.ts` (see `be-task-engine`). Search the 5-8k-line controllers by route string.

## Admission lifecycle (`src/ip-emr/atd.controller.ts`)

| Step | Route | Writes | Side effects |
|---|---|---|---|
| Advice | OP save (`be-emr-data-model`) | `EMR_ADMISSION_ADVISE` | read by `get-admission-advice`, `admission-advice-detail` |
| Booking | `create-admission-booking`, `update-`, `get-`, `cancel-admission-booking/:tenant_id/:admission_booking_no` | `ADMISSION_BOOKINGS` (`ADMISSION_BOOKING_STATUS` booked/admitted/cancelled); advice -> `Booked` | step `0005` on bare `registration_id` (`reference_type: patient_registration`) + `0010` on `ipAdmissionReferenceId` |
| Bed request | `allocate-bed-request/:tenant_id/:admission_booking_no`, `get-bed-requests`, `get-bed-allocation-list` | | |
| Admit | `create-admission` | `IP_PATIENT_VISIT` (`visit_id`), `BED_MASTER`, `BED_ALLOCATION_HISTORY`; booking -> admitted | `0010` (starts the process for a direct admission), `processIpVisitRuleEvent` |
| Edit | `update-admission` | | `0010` only if visit `Open` and `!hasCaseForReference`, then `1003` if already acknowledged; `getIpVisitStatusTransition` -> rule event |
| Nurse ack | `acknowledge-patient` (`ipemr.controller.ts`) | `ipEmrService.acknowledgePatient` | `1003` |

Numbers (`admission_number`, `admission_booking_number`, `doctor_transfer_number`) come from `MongoDBService.generateAutogenerateNumber` (not atomic; duplicates possible under load). Indent numbers use `SEQUENCE` `$inc` (`generateIndentNumber`).

## Beds and transfers

- Bed CRUD in `ip-emr.service.ts`: `createBedEntry`, `editBedEntry` (both call `findDuplicateBedEntry` - ward/floor/category/number), `softDeleteBedEntry`, `getBedEntry`. Media: `upload-bed-media` (max 5 files, 25 MB each).
- Bed limit per licence: `checkBedLimit` exists twice - private in `atd.controller.ts` and `FacilityLicenseService.checkBedLimit` (used by the service). Change both.
- Status routes `mark-bed-clean|under-repair|repaired|blocked|unblocked`; history `get-bed-history`, `get-bed-allocation-history`; occupancy `get-bedOccupied-details`.
- Transfers: `bed-transfer`, `bed-retain`, `get-bed-transfer-requests` (`BED_TRANSFER_REQUEST`); `create-/update-/get-doctor-transfer(s)`, `doctor-transfer` (`DOCTOR_TRANSFER`); `mark-vip-handle-with-care`.

## IP case sheet (`src/ip-emr/ipemr.controller.ts`)

`POST post-ip-emr-data` -> `saveIpEmrData`:
1. 400 without `registration_id`; 204 if no `IP_PATIENT_VISIT` for `visit_id`.
2. Workflow-tagged webpart (`webpartDetails.isWorkflowTaggedWebpart` / `isWorkflow`) -> `postIPWorkflowEmrData`, then `kafkaMiddlewareService.produceIPDEmrData` (guarded by `if (true)`: fires for every tenant).
3. Sets visit `save_status: "D"` on first save.
4. `webpartDetails.isMedication` -> `createMedicationDoseTasksForOrder` **before** the write (it stamps `tm_task_id` on slots).
5. `save_type === 'RegistrationWise'` -> `beginSectionAudit` + `ipEmrService.checkAndUpdateRegistrationWiseData` + `commitCaseSheetAudit` (entity `IP_PATIENT_VISIT`); else rows go to the uppercased `db_obj_name` collection, audited by `auditIpCaseSheet`.
6. On 200: `taskEngine.completeTasksForLinkedScreen(registration_id, webpart_id)`.

Also: `update-ip-emr-data` (completes dose tasks, below), `delete-ip-emr-data`, `get-ip-emr-data`, `get-paginated-ip-emr-data`, `get-history`; progress notes `IP_PROGRESS_NOTES` + addendum `IP_ADDENDUM`; ongoing services `stop-/continue-ongoing-service`, `update-service-status` (`ip-emr.service.ts` `updateServiceStatus`); `get-payer-exclusion`.

Referrals (`IP_REFERRAL_LOGS`): `add-referral` -> `startReferralTasks` (`1014`, one case per referred doctor), `acknowledge-referral-data` -> `1015`, `add-referral-data` -> `1016`. `acknowledge-referral-data123` is a leftover copy.

## Discharge

| Action | Route -> code | Tasks |
|---|---|---|
| Discharge process step | `add-discharge-process-logs` -> `ipEmrService.createDischargeProcess` (`DISCHARGE_PROCESS_DATA.discharge_process_data[]`, `discharge_step` matched trimmed + lower-case) | only when `discharge_status === 'completed'`: `syncDischargeProcessTasks` -> `1009` "mark for discharge" (skipped if any `TASK_CASE` already exists for `ip_discharge:<visit_id>`), `1010` "sent for billing". Kafka partition 14 when `isIpEMR_Producer`. |
| Cancel / integrated | `cancel-discharge-process`, `integrated-discharge-process` | |
| Summary save | `save-discharge-summary-data` -> `saveDischargeSummaryData` (`DISCHARGE_SUMMARY`, one per `summary_type`; `discharge_summary` and `death_summary` exclude each other) | `syncDischargeSummaryTasks`: `ready`/`finalized` -> `1011` on `ip_discharge:<visit_id>`; `ready`/`definalized` -> reactivate + `1013` on `ip_discharge_summary:<visit_id>` (meta `signatory_doctors`); `finalized` -> `1012`; `cancelled` -> `1012` task set inactive |
| AI summary | `save-/get-ai-discharge-summary-data` (`AI_DISCHARGE_SUMMARY`) | none; audited with `audit.record` (`AI_DISCHARGE_SUMMARY` / `AI_TEMPLATED_DISCHARGE_SUMMARY`). Generation: `be-ai`. |

`DISCHARGE_PROCESS_DATA` is also read by task-engine recurrence end rules (`dischargeEndRuleMet`), so renaming a step name changes when recurring nursing tasks stop.

## Medication order -> MAR

| Stage | Code |
|---|---|
| Order save (`isMedication`) | `createOrExtendMedicationOrderTask`: case `ip_med_order:<registration_id>:<service*uuid>` (`reference_type: ip_medication_order`), step `0012`, then `addChildTasks` step `0013` per unscheduled slot (`smat_dose_time.rows[].slots[]` without `tm_task_id`), cap `MEDICATION_DOSE_TASK_CAP = 60`; the generic MAR stub is `markTaskSuperseded` |
| Dose charted | `update-ip-emr-data` -> `completeMedicationDoseTasks`: slot status newly `administered` / `not administered` / `skipped` -> `completeTaskById(..., isSystemTriggered=true)` |
| Frequency change / substitution | `activity_dashboard.service.ts` `substituteMedicine` -> `mergeRescheduledDoseTime` (keeps actioned and pre-`effective_from` slots), `createDoseTasksForNewSlots`, `supersedeDoseTasks`; refused once an indent exists |
| Read | `get-medication-details`, `get-infusion-medication`, `get-mar-data` (`ipEmrService.getMARData`) |

Parallel copies: `MEDICATION_DOSE_TASK_CAP` and `MEDICATION_MAR_STEP_CODE` are declared in both `ipemr.controller.ts` and `activity_dashboard.service.ts`. Task failures are caught and never block the clinical save. AI view of medications/MAR: `be-ai`.

## Pharmacy / nursing dashboard (`inpatient-service/activity-dashboard`)

`src/activity_dashboard/activity_dashboard.service.ts` (+ class-validator DTOs in `dto/activity_dashboard.dto.ts`). Orders are `IP_EMR_MEDICATION` docs (`group_id`, `data[]` lines keyed by `service*uuid`).

| Feature | Routes -> methods |
|---|---|
| Nurse acknowledgement | `acknowledge-medication` (`acknowledgeMedicationByGroupIds`), `get-medicines-by-date` |
| Pharmacist verification | `update-pharmacist-verification` / `update-home-medication-verification` -> `saveLineVerification(scope)` |
| Verbal orders | lines with `data.verbal_order`, `verbal_order_status`; `get-verbal-orders`, `get-verbal-order-medicines`, `approve-verbal-order` (`approveVerbalOrders`: rejects self-approval, already-actioned and non-verbal lines). Pharmacist cannot verify an unapproved verbal line; rejected ones are hidden (`buildPharmacistVerbalOrderGateStage`). |
| Reconciliation | `get-home-medication-reconciliation`, `save-medication-reconciliation`, history (`IP_HOME_MEDICATION`, `IP_MEDICATION_RECONCILIATION`) |
| Substitution | `get-substitute-medicines`, `substitute-medicine` |
| Indents | `get-advised-medicines`, `save-indent`, `get-indent-list`, `acknowledge-indent-medicine`, `get-indent-acknowledge-history`, `get-indent-by-id` (`IP_PHARMACY_INDENT`) |

Rules: dates are `DD-MM-YYYY` strings - compare through `normalizeToDdMmYyyy` / `buildDdMmYyyyDayExpr`; counts exclude discharged visits (`buildNotDischargedMatch`); dose credentials (`dualVerification.password1`) live in these docs - never return them.

## Infusions

- Calculation: `src/infusion/infusion.service.ts` (`inpatient-service/infusion`), formulas from reference lookup "Infusion Calculation Configuration"; `verifyUser` for dual verification.
- Templates: `src/infusion-sets/infusion-sets.service.ts` (`configuration-service/infusion-sets`).
- Frequency master: `tenant-service/service` `create-/update-/get-smat-frequency-master` (`SMAT_FREQUENCY_MASTER`).

## Gotchas

- `src/emr/ipEmr.controller.ts` (`inpatient-service/ip-emr/v2`) is an older generic copy with no auth binding; live screens use `src/ip-emr`.
- Unbound routes today (run `node ../.claude/tools/check-route-auth.js`): `mark-bed-*`, `allocate-bed-request`, `get-bed-history`, `get-bed-transfer-requests`, `patient-admission`, `integrated-discharge-process`.
- Match beds by ward/floor/category, not number alone.
- ER visits live in `PATIENT_VISIT`; `get-er-patient-data(-internal)` joins them with the IP visit.

Related: `be-rules-alerts-notifications`, `be-front-desk` (payer/tariff), `be-print-pdf-templates`.
