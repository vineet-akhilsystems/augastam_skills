---
name: be-ai
description: Use when adding or debugging an AI feature in the backend - ambient scribe / conversation AI, voice assistant, "transcribe" sockets, consolidated visit summary, IP clinical summary, 48-hour or discharge summary, care gaps, OCR / document extraction, AI configuration, the case-sheet bundle (ai-bundle), "AI summary is missing X", AI medication/MAR view, or upstream AI errors, timeouts and retries.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# AI features

All models run in external Augastam services (FastAPI ai_server / Clinical API). This backend gathers data, calls them, stores results and relays streams. The case-sheet pipeline and bundle contract are in `rules/backend-clinical-summary.md` (loads with `src/clinical-summary`).

## Services

| Feature | Code | Upstream | Env | Stored in |
|---|---|---|---|---|
| Scribe transcription (WS proxy) | `src/conversation-ai/conversation-ai.gateway.ts` | `AUGASTAM_AI_WS_BASE_URL` | `AUGASTAM_AI_SUBSCRIPTION_KEY`, `AUGASTAM_AI_API_SECRET`, `AUGASTAM_CHECKPOINT_INTERVAL_MS` | `CONVERSATION_TRANSCRIPT` |
| Scribe summary / webpart auto-fill | `conversation-ai.service.ts` (`configuration-service/conversation-ai`) | `AUGASTAM_AI_BASE_URL` `POST /v1/summary`, `/v1/clinical-record` (`EXTRACT_TIMEOUT_MS` 90s) | same | `CONVERSATION_NOTE`, `CONVERSATION_TRANSCRIPT` |
| Voice assistant | `src/voice-assistant/*` (`configuration-service/voice-assistant`, WS `/voice-transcribe`) | same `/v1/clinical-record` + WS | same | nothing |
| Consolidated visit summary | `src/visit-summary/*` | `AUGASTAM_VISIT_SUMMARY_BASE_URL` `/v1/summary/full` | `AUGASTAM_VISIT_SUMMARY_*` | `CONSOLIDATED_VISIT_SUMMARY` |
| IP clinical summary + care gaps | `src/clinical-summary/*` (`inpatient-service/clinical-summary`) | `AUGASTAM_CLINICAL_SUMMARY_BASE_URL` `/v1/ip-clinical-bundle` (NDJSON, `..._TIMEOUT_MS` default 300000), `/v1/care-gaps/*` | `AUGASTAM_CLINICAL_SUMMARY_*` | `IP_CLINICAL_SUMMARY` |
| Doctor-facing AI discharge summary | `ip-emr.service.ts` `saveAiDischargeSummaryData` | - | - | `AI_DISCHARGE_SUMMARY` (`AUDIT_ENTITIES.AI_DISCHARGE_SUMMARY`) |
| OCR | `src/document-extraction/*` | `AUGASTAM_OCR_BASE_URL` `/v1/extract` | `AUGASTAM_OCR_*`, `AUGASTAM_OCR_S3_BUCKET`, `AUGASTAM_OCR_FILE_RETENTION_DAYS` | `DOCUMENT_EXTRACTION` + file in tenant storage |
| Enablement | `src/ai-configuration/*` | - | `AI_SERVICES` ids (`config/config.ts`) | `AI_SERVICE_MASTER`, `AI_CONFIGURATION` |

Each module reads its env at import with a hard-coded default (`localhost:8000` / `127.0.0.1:8000`; OCR a raw IP), so a missing var fails as a connection error, not a config error.

## Upstream call pattern

- Headers `X-Subscription-Key` / `X-Api-Secret` (`aiHeaders()` / `authHeaders()`). Visit ids go as **query params** (`extractUrl`); `patient_id` is deliberately not sent.
- Region: `resolveFacilityIsIndia` (`src/functions/facilityCountry.ts`) from the facility's saved country, server-side only.
- `retryWithBackoff(fn, 3, 1000)` is copied per module and the copies differ; edit the local one:

  | Module | Retries on |
  |---|---|
  | conversation-ai, voice-assistant, visit-summary | HTTP 429/502/504 (`RETRYABLE_STATUS_CODES`), honours `retry-after`; network errors are **not** retried |
  | document-extraction | 429/502/503 and errors with no status (connection) |
  | clinical-summary | no retry |

- `failureResponse(error, kind)`: 401/403 -> 502 "credentials rejected", 413, 415, 400/422 -> 422 with provider message, else 502. Never return raw upstream errors. (The conversation-ai copy still logs "Document extraction".)
- Validate before calling (transcript/webpart caps; OCR 20 MB / 25 pages). Persist only after success.
- Multipart routes: `AuthContextMiddleware` (`src/document-extraction/auth-context.middleware.ts`) after Jwt/Tenant; read with `authContextOf`.
- OCR keeps every extraction as its own row and stores `file_provider` + `file_bucket` so signing/deleting uses the right storage. Retention sweep (`document-extraction.scheduler.ts`) is disabled (`//@Cron`).

## Streaming (IP clinical summary)

`ClinicalSummaryController.generateSummary` (`POST :tenant_id`): sets `application/x-ndjson`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, writes one JSON line per event (`progress` ... `result` / `error`), and keeps generating if the browser disconnects so the paid result is saved. Other routes: `GET :tenant_id` (saved), `GET :tenant_id/ai-bundle` (what the AI sees, `?include_empty=true`), `PUT discharge-edit`, `POST last-48-availability`, `POST sync` (care-gap decisions, no AI call), `POST care-gaps/:action`, `care-gaps/document/:action` (`proxyCareGap`).

Doctor edits of AI discharge text are kept as generated/edited pairs (`discharge-edits.util.ts`) and resent as `previous_discharge`; `validateEditedDocument` mirrors ai_server's rules.

## Case-sheet bundle: adding data

Read path: `AiCaseSheetBundleService.getAiCaseSheetBundle` (`ai-case-sheet-bundle.service.ts`) -> `CaseSheetTransformService.transform` (`transform/case-sheet-transform.service.ts`).

**Plain collection bag** (rows of one or more collections):
1. Add `{ key, collections[], scope: 'visit' | 'visit_or_registration' | 'registration', flattenData?, stripBinary? }` to `ADDITIVE_BAG_SPECS`. `loadClinicalCollectionRows` matches `tenant_id` + `registration_id`, filters by scope, flattens `data[]`, adds `_source`, returns `[]` on error.
2. In `case-sheet-transform.service.ts`: add the key to the bundle interface (~line 100), to `ADDITIVE_TRANSFORM_BAG_KEYS` (cleaned with `cleanDeep`) and to the output object (~line 378).

**Bag needing custom logic**: add a `load*` method next to `loadAdmissionMedications` / `loadPatientImmunizations`, call it from `getAiCaseSheetBundle`, then transform it in the service. Use `stripBinaryFields` for documents; mark `for_current_visit` when history is included.

Then: grep the writer for every field name; compare `GET ai-bundle` for one real admission before/after; add a spec beside the util (`discharge-edits.util.spec.ts` style). Allergy rows win over the webpart text fallback (`buildAllergyStopGap`); growth chart only when `isPediatricAge(resolvePatientAgeYears(...))`.

## Medications in the AI bundle

- `transform/medication-mar-link.util.ts` `linkMedicationsToMar(medications, indents)` wraps each line as `{ advised, administration, linkage }` from `IP_EMR_MEDICATION` lines' `smat_dose_time` slots and `IP_PHARMACY_INDENT` (`service_uuid` used for matching, never emitted).
- With `AI_FRIENDLY_MEDICATIONS_ENABLED` (`isAiFriendlyMedicationsEnabledFromEnv`; `TransformOptions.aiFriendlyMedications` overrides) `ai-friendly-medications.util.ts` buckets slots into `given` / `overdue` / `skipped_or_missed` / `still_due`.
- A change to `smat_dose_time` or slot statuses in medication/MAR code must be checked against both utils. Examples: `docs/ai-friendly-medications.md`.

## Transcription WebSocket proxy

| | Scribe | Voice assistant |
|---|---|---|
| Gateway | `ConversationAiGateway` (default namespace) | `VoiceTranscribeGateway` (`/voice-transcribe`) |
| In | `augastam:transcribe:start|audio|stop` | `voice:transcribe:start|audio|stop` |
| Out | `augastam:transcribe:segment|error|closed` | `voice:transcribe:segment|error|closed` |
| Persistence | yes (below) | none |

- `handleConnection` decrypts the token (own `decryptToken` copy) and disconnects on failure, but stores no identity: `tenant_id`, `patient_visit_id`, `registration_id` come from the **start payload** (`tenant_schema` is resolved server-side from that `tenant_id`). Tenant spoofing is possible; do not copy this for new gateways, bind identity at connect.
- `handleStart` ends any previous session for the socket, opens `new WebSocket(buildUpstreamUrl(sessionId, query), { headers })`: credentials in headers, ids + `is_india` in the query string (never log the URL). Missing credentials -> `:error` and return.
- Per-socket `Map<socket.id, session>`; `endSession` is the single exit path (stop, disconnect, upstream close/error, restart) and clears the timer, flushes, releases the lock, closes upstream. `sweepStaleSessions` every 15 min kills sessions older than 4h.
- Audio frames are forwarded only while upstream is OPEN.

### Transcript durability (scribe)

Designed flow: Redis live buffer `augastam:transcript:<tenant>:<visit>` (24h TTL, seeded from Mongo on start), `checkpointTick` every `AUGASTAM_CHECKPOINT_INTERVAL_MS` (10s) `$set`s it into `CONVERSATION_TRANSCRIPT`, one recording per visit via lock `augastam:recording-lock:*`.

**Today Redis is never connected**, so `getCache` returns null: the lock fails open, the buffer stays empty and `checkpointTick` / the final flush return early. The gateway persists nothing; the transcript reaches Mongo only when the client posts it to `generate-visit-summary` (`generateVisitSummary` writes `CONVERSATION_TRANSCRIPT.segments` from the body). A crash before that loses the recording server-side.

## AI configuration

`ai-configuration` stores enablement per tenant/facility/user, but nothing outside that module reads `AI_CONFIGURATION`, so AI routes do not enforce it. A new switchable feature must add its id to `AI_SERVICES` / `AI_SERVICE_MASTER` and read `AI_CONFIGURATION` itself (agree the behaviour; it would be the first enforcement).

## Adding an AI feature

1. Env vars (base URL + key + secret) read in the service; document them for `be-local-dev-and-auth`.
2. Copy a module's `retryWithBackoff` / `failureResponse` / `extractUrl`; return `{ statusCode, message, data }`.
3. Bind Jwt + Tenant (+ `AuthContextMiddleware` for multipart) in the module's `configure()`.
4. Audit: `@Audit` + `req.__audit` (conversation-ai, document-extraction) or who/when trail with the output on its own document (clinical summary).
5. Spec request building and failure mapping with mocked `HttpService`; gateway specs follow `voice-transcribe.gateway.spec.ts` (env before require, mocked `ws`, stubbed timers).
