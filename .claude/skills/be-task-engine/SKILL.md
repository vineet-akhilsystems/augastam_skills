---
name: be-task-engine
description: Use when a clinical or front-desk action should create, complete, skip, hide or escalate a Task Management task, when tasks do not appear, appear for the wrong role/ward, never close or duplicate, when adding a step code or process, or when recurring tasks, escalation emails, MAR dose tasks or linked-screen completion misbehave (handleStepEvent, STEP_MASTER, PROCESS_MASTER, TASK_CASE).
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Task engine

Entry point, reference-id rule, wall clock and scheduler concurrency: `.claude/rules/backend-task-management.md`.

Code (`src/task-management/`): `task-engine.service.ts` (core), `ip-admission-task.util.ts` (step-code constants + reference-id builders), `task-recurrence.util.ts`, `task-roles.util.ts` (`normalizeRoles`, `roleAllowed`), `task-recurrence.scheduler.ts`, `task-escalation.scheduler.ts`, controller `tenant-service/task-management` (`step-event`, `complete-task`, `set-task-active`, `cases`, `nurse-cases`, `task`, `patient-pending-tasks`, `case-tasks`). Config: `src/step-master` (`check-code`), `src/process-master`.

## Model

| Collection | Holds |
|---|---|
| `STEP_MASTER` | `step_code` (4-digit string), `step_type` (`form` / `system` / `approval` ...), `default_role[]`, `is_clinical`, linked screen (`linked_screen_type/id/name`), `sla_minutes`, recurrence (frequency, times, end rule), escalation levels |
| `PROCESS_MASTER` | `nodes[]` (`node_id`, `step_id`, `is_start`, `is_end`) + transitions |
| `TASK_CASE` | one running process per `reference_id` (`status: open/closed`, `reference_type`, `reference_meta`) |
| `TASK_MANAGEMENT` | one task per node instance: `status` (`pending`, `completed`, `rejected`, `skipped`...), `due_on`, `escalation_level`, `is_inactive`, `parent_task_id`, `is_fanout_child`, `assigned_doctor_ids` |

Older, separate models still live: `TASK_ASSIGNMENT_HISTORY` (EMR role handoff), `TASK_HISTORY` (EMR workflow tasks from `EmrDataService.triggerTaskData`), `TASK_CONFIGURATION`, `NURSE_TASK`, `MANUAL_TASK_ASSIGNMENT` (shown in Task Management via `withManualTaskDetails`).

## `handleStepEvent` behaviour

1. No step with that `step_code` -> `{ statusCode: 404 }`.
2. Open case on `reference_id`: merge `reference_meta`; complete the newest pending task at that step (or `task_id` if given). No such task -> ignored (`applicable: false`).
3. No open case: start a case only if some process has a **start node** at this step; the start task is created and completed at once.
4. `advance()` creates next tasks; `closeCaseIfFinished` closes only when an end node was reached and nothing is pending or still recurring.


## Step codes in use

| Code | Event | Reference id | Fired from |
|---|---|---|---|
| `0001` | patient registration | `registration_id` | `patient-registration.controller.ts` `autogenerate` |
| `0003` | appointment booked | `patient_id` (the registration case; passes `tm_task_id` as `task_id`) | `appointment.controller.ts` `save-appointment-slot` |
| `0005` | admission request raised | `registration_id` | `atd.controller.ts` `create-admission-booking` |
| `0010` | IP admission | `ip_admission:<registration_id>` | `atd.controller.ts` booking, `create-admission`, `update-admission` |
| `1003` | nurse acknowledgement | `ip_admission:...` | `ipemr.controller.ts` `acknowledge-patient`; `update-admission` |
| `0012` | medication advised | `ip_med_order:<registration_id>:<service*uuid>` | `ipemr.controller.ts` `createOrExtendMedicationOrderTask` |
| `0013` | MAR dose (fan-out children) | same case | `addChildTasks` in `ipemr.controller.ts` and `activity_dashboard.service.ts` `createDoseTasksForNewSlots` |
| `1009`, `1010` | mark for discharge, sent for billing | `ip_discharge:<visit_id>` | `ipemr.controller.ts` `syncDischargeProcessTasks` (`add-discharge-process-logs`, status `completed`) |
| `1011` | discharge summary prepared (`DISCHARGE_SUMMARY_STEP_CODE`) | `ip_discharge:<visit_id>` | `ipemr.controller.ts` `syncDischargeSummaryTasks` (`save-discharge-summary-data`, status `ready`/`finalized`) |
| `1013`, `1012` | summary readiness, finalization | `ip_discharge_summary:<visit_id>` | `syncDischargeSummaryTasks` (`ready`/`definalized` -> 1013, `finalized` -> 1012, `cancelled` -> 1012 inactive) |
| `1014`-`1016` | referral request / ack / sign-off | `ip_referral:<referral_id>:<doctor_id>` | `ipemr.controller.ts` `startReferralTasks`, `sendReferralTaskEvent` |

`0001`, `0003`, `0005`, `0012`, `0013` are local constants in their files (`0013` twice); the rest are exported from `ip-admission-task.util.ts`.

## Adding a step event

1. Constant (+ reference-id builder for a new process) in `ip-admission-task.util.ts`.
2. Import `TaskManagementModule` in the caller's module; inject `TaskEngineService`.
3. After the domain write succeeds: `this.taskEngine.handleStepEvent(tenant_id, facility_id, { step_code, outcome: 'complete', reference_id, reference_type, reference_meta: { registration_id, visit_id, ... }, user }, tenantCheck?.tenant_schema).catch(...)`. Put `registration_id` in `reference_meta`: linked-screen completion, ward filtering and patient task lists key on it.
4. Guard repeat events if re-saving must not start a second case (see `hasCaseForReference` in `update-admission`, the `TASK_CASE` check in `syncDischargeProcessTasks`).
5. Tenant config: step with that code in `STEP_MASTER`, process whose start node uses it.
6. Spec with a fake `mongoDBService` (`be-write-spec`).

## Other entry points

- `completeTaskById(tenant, facility, task_id, outcome, user, remarks, role_id, schema, isSystemTriggered)`: UI completion; system completions (MAR doses) pass `true` to skip the approval role gate.
- `completeTasksForLinkedScreen(tenant, registration_id, webpart_id(s), user, schema)`: open cases matched by `reference_meta.registration_id` or `reference_id`; completes the oldest pending `form` task for that screen (after advancing its recurrence). Called by IP `post-ip-emr-data` and `emr-template.controller.ts`; the OP EMR save does not call it.
- `setPendingTaskActive(tenant, reference_id, step_code, active, schema, reason)` / `setTaskActiveById` (admin only, not `system` steps): inactive = `is_inactive: true`, still pending, hidden; reactivation restarts the SLA (`sla_minutes`, default 60) and resets `escalation_level`.
- `addChildTasks(tenant, facility, case_id, parent_task_id, step_code, items[])`: the step must be a node of that case's process, else nothing is created. `markTaskSuperseded` hides stub tasks.
- `getPendingLeafTasksByPatient` (IP visit list overdue column), `getCases` / `getNurseCases` / `getCaseTasks` / `getTaskWithCase`.

## Visibility (`taskVisibleToViewer`)

Admin sees all -> `assigned_doctor_ids` restricts to those users and their teams (`teamIdsOf`) -> manual tasks visible -> `roleAllowed(default_role, role_id)` -> nurses see only `is_clinical`. Nurse case lists (`role_id` resolving to a Nurse role) are filtered by the "Nurse Ward Tagging" lookup against `IP_PATIENT_VISIT.currentWard`: no tagging = see all; with tagging, cases without an IP ward are dropped.

## Recurrence and escalation

- Recurrence: at most `MAX_RECURRENCE_CATCH_UP = 10` slots per run, nothing older than 12 h, `MAX_TIMES_PER_DAY = 4`. End rules are met when the visit's `DISCHARGE_PROCESS_DATA` reaches the listed stage (`dischargeEndRuleMet`), so discharge step names matter.
- Escalation (`task-escalation.scheduler.ts`): pending, active, `due_on <= now`, `escalation_level < 3`; email via `NodemailerService` after a compare-and-set on `escalation_level`.

## Gotchas

- **Recurring times come from a snapshot.** `buildRecurrenceState` copies the step's times into the series when it starts ("so later edits don't reshape a series already running"); `advanceRecurrence` reads only that copy. Editing `STEP_MASTER` times therefore doesn't change open series: a "task time wrong for recurring tasks" ticket is usually old snapshots, not the display.
- **Where users see tasks:** the frontend Task Management screen is `custom-form-builder/src/features/taskManagement` (`TaskManagement.jsx`, `utils/`); check how it renders `dose_time` before changing the backend.

- An event on a reference that already has an open case from another process is ignored; that is why admission uses `ip_admission:` and not the bare `registration_id` (the registration case keeps it open).
- Use `is_inactive`, not `isActive`, on tasks.

Related: `be-inpatient` (IP flows), `be-rules-alerts-notifications` (rule-created tasks), `be-front-desk`.
