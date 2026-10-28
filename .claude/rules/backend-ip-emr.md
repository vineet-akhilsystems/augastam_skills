---
paths:
  - "akhil_systems_backend/src/ip-emr/**"
---

> Backend area guide (`akhil_systems_backend/src/ip-emr`). Paths are relative to `akhil_systems_backend/`.

# src/ip-emr

- `atd.controller.ts`: admission booking, admission, beds, bed/doctor transfers, admission advice (logic inline, 8k lines). `ipemr.controller.ts` + `ip-emr.service.ts`: IP EMR data, progress notes/addendum, referrals, ongoing services, discharge process/summary, medications, MAR. Both mount at `inpatient-service/ip-emr`.
- Bed statuses come from `STATUS` in `config/status.config.ts` (`Vacant`, `Occupied`, `Retain`, `Blocked`, `On Cleaning`, `Under Repair`). Match beds by ward/floor/category as well as number.
- Task engine step codes and reference-id builders live in `src/task-management/ip-admission-task.util.ts`; fire events with `.catch()` so they never block the clinical action.
- `-internal` routes are for server-to-server calls (`WindowServerMiddleware`).
- Skills: `be-inpatient`, `be-task-engine`, `be-ai`.
