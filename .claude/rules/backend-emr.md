---
paths:
  - "akhil_systems_backend/src/emr/**"
---

> Backend area guide (`akhil_systems_backend/src/emr`). Paths are relative to `akhil_systems_backend/`.

# src/emr

- Live logic is in the services: `emr-data/emr-data.service.ts` (save/edit/sign/read/copy/prescription), `patient-visit/patient-visit.service.ts` (encounters, visit lists), `sub-emr/sub-emr.service.ts` (favourites, investigations, rule engine, illustrations). Their controllers and `patientemr.controller.ts` mount at `patient-service/emr`.
- `emr.controller.ts` (`patient-service/emr/v1`, 15k lines) is a **live parallel copy**: 110 of its 116 methods also exist in the services above, and changes are routinely made in both (e.g. `processAdmissionAdviseSave`). A few endpoints exist only in v1 (`update-risk-flag`, `getFavouritesByType`, `getNurseDoctorList`, `getPrescriptionData`). When fixing EMR behaviour, grep the method name in both and fix both unless you know which route the frontend calls. Most v1 routes have no auth middleware bound.
- `ipEmr.controller.ts` here is `inpatient-service/ip-emr/v2` and shares its class name with `src/ip-emr/ipemr.controller.ts`.
- Several controllers keep a commented-out `@Controller(...)` above the real one; the uncommented decorator is the route base.
- Storage: visit-wise data on `PATIENT_VISIT` (grid rows behind `{ _id, collectionName }` pointers), registration-wise data in `PATIENT_REGISTRATION_EMR.properties[<user_id>]`, role bags in `TASK_ASSIGNMENT_HISTORY.properties`. `save_status`: `D` draft, `S` signed, `N` assigned.
- Keep `auditService.beginCaseSheetAudit` / `commitCaseSheetAudit` around any new write path.
- Skills: `be-emr-data-model`, `be-builder-config`, `be-api-change`, `be-print-pdf-templates`.
