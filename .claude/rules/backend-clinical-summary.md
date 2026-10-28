---
paths:
  - "akhil_systems_backend/src/clinical-summary/**"
---

> Backend area guide (`akhil_systems_backend/src/clinical-summary`). Paths are relative to `akhil_systems_backend/`.

# src/clinical-summary

- Pipeline: `AiCaseSheetBundleService` (raw bundle for one IP/ER admission) -> `transform/CaseSheetTransformService` -> `ClinicalSummaryService` (calls ai_server `/v1/ip-clinical-bundle`, streams NDJSON, stores `IP_CLINICAL_SUMMARY`).
- The bundle contract is additive: add new top-level bags, never rename or reshape existing keys. No uuids/Mongo ids/timestamps in medication linkage. Field names must come from the writers (grep before using one).
- `AI_FRIENDLY_MEDICATIONS_ENABLED` switches medications, investigations and discharge workflows to the compact shapes (`docs/ai-friendly-medications.md`).
- `IPVisitData.service.ts` is a near-copy of `src/utility/utility.service.ts` and `src/functions/AllVisitSummaryService.ts`; port extraction fixes to all three.
- Transform utils are pure; add specs next to them (`discharge-edits.util.spec.ts` style).
- Skills: `be-ai`.
