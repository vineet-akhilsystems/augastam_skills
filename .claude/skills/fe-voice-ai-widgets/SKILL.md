---
name: fe-voice-ai-widgets
description: Use when changing or debugging AI features in the frontend EMR - voice assistant, Augastam or Jatayu voice widget, "Fill Section" by voice, voice typing, AI visit summary, document extraction/OCR fill, AI enabled or hidden per facility, the AI gate/AI master setup, or AI-filled data duplicating or overwriting EMR rows.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Voice and AI widgets

## How it works

### Gating (fail closed)

- `components/Topbar.js` calls `getEnabledAiServiceCodes()` (`services/aiServiceConfigApi.js`: `GET configuration-service/ai-configuration/configuration?tenant_id&facility_id&individualServiceInfo=1`) once per page load and dispatches `setAiServices` (`Redux/Reducers/aiServicesSlice.js`, not persisted). Any error or missing facility -> `[]`.
- `hooks/useAiService.js`: `useAiService(code)` is false until loaded; default export `AiGate` (`<AiGate code={...}>`).
- Codes (`constants/aiServices.js`, `AI_SERVICE_CODES`): `IP_CLINICAL_AI`, `SUMMARIZE_AI` = `"SUMAI"`, `CONVERSATIONAL_AI` = `"CONVOAI"`, `OCR_AI` = `"OCRAI"`. Configured per facility at `/ai-master-setup` (`components/ai-master-setup`).

### Surfaces

| Surface | Code | Gate |
|---|---|---|
| Visit voice widget | `EMR/EMRPreview.jsx` picks by `tenantSetup.ai_voice_provider` (Facility/Tenant Setup): anything not matching `/jatayu/i` -> `components/AugastamVoiceWidget/AugastamVoiceWidget.jsx`; Jatayu -> `components/JatayuVoiceWidget/` (legacy) | Augastam: `CONVOAI` (its summary part also `SUMAI`); Jatayu: **none** |
| Section "Fill Section" | `components/VoiceAssistant/SectionVoiceFill.jsx` + `useVoiceFill.js`, mounted in `components/WebpartPreview.jsx`, `TableBuilder/TableHeader.jsx`, `components/modals/SideSummaryModal.jsx`, `pages/Preview.jsx` | `CONVOAI` |
| Header voice assistant | `VoiceAssistant/HeaderVoiceAssistant.jsx` in `Template/templateHelperComponents/TemplateWorkflowHeader.jsx` (commented out in `PatientHeader.jsx`) | `CONVOAI` |
| Grid voice typing | `components/VoiceTypingButton.jsx` (`hooks/useVoiceTyping.js`) in `TableBuilder/RenderColumn.jsx` | none |
| Visit summary | `AugastamVoiceWidget/VisitSummaryPanel.jsx`, `PastVisitSummaryPanel.jsx`; `PatientHeader.jsx`, `modals/SidePreviousModal.jsx` | `SUMAI` |
| Document extraction | `components/DocumentExtraction/DocumentExtractionModal.jsx` from `PatientHeader.jsx` | `OCRAI` |

### Transport

| Flow | Transport |
|---|---|
| Augastam transcription | shared Socket.IO connection (`services/augastamAiService.js` -> `connectSocket` in `App.jsx`), events `augastam:transcribe:*` (start, audio, stop, segment, closed, error) (`useAugastamMicStream.js`) |
| Section/header voice | namespace `/voice-transcribe` (`services/voiceTranscribeService.js`), events `voice:transcribe:*` (`useVoiceTranscribeStream.js`); one active recording at a time via `voiceSessionCoordinator.js` |
| REST (`utils/api.js`) | `configuration-service/conversation-ai/{conversation-transcript, conversation-notes, conversation-note, generate-visit-summary, generate-clinical-record, clear-session}/{tenant}`, `voice-assistant/generate-clinical-record/{tenant}`, `visit-summary/consolidated-visit-summary/{tenant}`, `document-extraction/{extract-text, extract-file, latest}/{tenant}`. Generate calls are wrapped in `withRetry` (network/502/504) |

Every AI request carries `tenant_id` (path), `registration_id` (= `paramsEMR.pid`), `patient_visit_id` (= `paramsEMR.eid`) and `facility_id` (`JSON.parse(sessionStorage.selected_facility).value`); socket `start` payloads repeat `facility_id` because the handshake value can be stale. Backend counterpart: `be-ai`.

### Writing into the form

AI output is keyed by `webpart_name` (grid -> array of rows, other -> object). The request's webpart list comes from `getWebpartsRequest(webpartConfigurationArray)` (`AugastamVoiceWidget/webpartMapping.js`, cached in CacheStorage `augastam-webparts-request-cache`). Results are written with `PatientContext.setPatientPrefillData` (or `setTemplatePrefillData` in template mode), **append only**: existing rows are kept and only rows passing `rowsNotAlreadyPresent` (`components/sections/copyRules.js`, exact-content fingerprint) are added; a webpart the AI returned nothing for is never cleared.

## Add an AI feature (files in order)

1. `constants/aiServices.js`: reuse a code or add one that exists in the backend AI service master.
2. `utils/api.js`: call via `axiosInstance` with the four ids (`fe-call-api`); wrap long generate calls in `withRetry`.
3. Component behind `useAiService(code)` or `<AiGate>`; never default to enabled.
4. Mount it in the host screen (EMR section header, `PatientHeader.jsx`, etc.).
5. If it fills the form, reuse the merge from `useVoiceFill.js` `populateEmr` and `rowsNotAlreadyPresent`; don't replace `patientPrefillData[webpart]` (about 15 other components write to it).

## Copies to change together

- `useAugastamMicStream.js` vs `useVoiceTranscribeStream.js`: near-identical mic/AudioWorklet code with different event prefixes; fix both.
- Prefill merge is repeated in `AugastamVoiceWidget.jsx`, `VoiceAssistant/useVoiceFill.js` and `DocumentExtraction/DocumentExtractionModal.jsx`.
- `ai_voice_provider` options live in `tenantCreate/TenantSetup.jsx`, `facilityCreate/FacilitySetup.jsx` and `Topbar.js` (value spelled `isAugustamAI`).

## Bug-prone spots

| Symptom | Look at |
|---|---|
| AI button missing | facility has no config/code at `/ai-master-setup`; `selected_facility` empty; page not reloaded after config change |
| Wrong widget | `ai_voice_provider` value; only `/jatayu/i` routes to Jatayu |
| Duplicated or wiped rows | merge code above; fingerprint is exact content (case/trim-insensitive), so near-duplicates are kept |
| Two mics at once | `acquireVoiceSession` not called in a new recorder |
| Voice typing in builder fields never connects | `hooks/useRealTimeTranscription.js` opens hard-coded `ws://65.0.39.162:8765/` (insecure, fails on HTTPS) |
| `getAudioText` | plain `axios` to an external cloud function with `REACT_APP_VOICE_TYPING_API`; don't copy |
| Jatayu | `services/jatayuAuthService.js` hard-codes Cloud Run URLs and is not AI-gated |

## Verify

- `npm start`, select a facility with `CONVOAI`/`SUMAI`/`OCRAI` enabled, open a visit: record with the widget, generate summary and sections, check rows are appended not replaced, run Fill Section twice (no duplicates). Then a facility without the codes: every AI control is hidden.
- Network tab: each AI request has the four ids. No unit tests exist; for merge logic add `components/sections/copyRules.test.js`. Then `fe-pre-pr-check`.
