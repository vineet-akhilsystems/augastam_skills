---
paths:
  - "akhil_systems_backend/src/task-management/**"
---

> Backend area guide (`akhil_systems_backend/src/task-management`). Paths are relative to `akhil_systems_backend/`.

# src/task-management

- `TaskEngineService.handleStepEvent(tenant, facility, { step_code, outcome, reference_id, reference_type, reference_meta, user }, schema)` is the single entry point for domain events. Callers fire it with `.catch()`.
- A step code does nothing unless the tenant's `STEP_MASTER` has it and a `PROCESS_MASTER` graph starts at it (or an open case on the same `reference_id` has a pending task at it).
- Reference ids must be unique per process: `ip_admission:<registration_id>`, `ip_discharge:<visit_id>`, `ip_discharge_summary:<visit_id>`, `ip_referral:<referral_id>:<to>` (`ip-admission-task.util.ts`).
- Times are hospital wall clock (`TASK_WALL_CLOCK_OFFSET_MINUTES`, default IST); use the helpers in `task-recurrence.util.ts`.
- Schedulers run every minute in every instance: claim work with atomic conditional updates (see escalation `escalation_level` compare-and-set and recurrence slot claims).
- Skill: `be-task-engine`.
