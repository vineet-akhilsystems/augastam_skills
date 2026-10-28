---
paths:
  - "custom-form-builder/**"
---

# Frontend: custom-form-builder

React 18 on create-react-app (`react-scripts` 5), JavaScript/JSX, Redux Toolkit, react-router 6, react-bootstrap, axios, i18next, Socket.IO client. UI for the Augastam HIS: low-code builder (webparts, workflows, forms, report builder, print formats) plus clinical/admin screens. ~1,100 JS/JSX files, no TypeScript.

## Commands (run inside `custom-form-builder`)

```bash
npm install                      # needs NODE_AUTH_TOKEN in env for @akhilsystemspvtltd (GitHub Packages, see .npmrc)
npm start                        # dev server, http://localhost:3000
GENERATE_SOURCEMAP=false BUILD_PATH="$TEMP/cfb-build-check" npx react-scripts build   # `npm run build` uses POSIX env syntax and fails on Windows (npm runs scripts via cmd.exe)
npx react-scripts test --watchAll=false <pattern>   # `npm test` = CRA jest (ignores jest.config.js); 18 test files exist
npm run report-builder:check     # report-builder copies vs ../augastam-ip-module (exit 2 = that repo isn't checked out)
```

## Where things are

- Routing: `src/ComponentRoute.js` (one flat `<Routes>`, ~170 routes), tab titles in the `switch` in `src/App.jsx`, access via `src/PrivateRoute.js` (admins pass; others need a menu `redirect_value` matching the path). Menus/permissions come from the backend. New page: `fe-add-page` skill.
- API: `src/utils/api.js` exports `axiosInstance` (auth token, `user_id`, `facility`, HMAC headers added by interceptor); base URL from `src/envConfig/config.js` by `REACT_APP_NETWORK` (TEST/DEMO/UAT/PROD). `tenant_id` is never automatic: use `getTenantIdForAPI()` from `src/utils/utilities.js`. New call: `fe-call-api` skill.
- State: `src/Redux/store.js`, slices in `src/Redux/Reducers/*Slice.js` and `src/Redux/features/`; redux-persist to **sessionStorage** (whitelist `visitData`, `Permission`, `tenantSetup`). No RTK Query. Much state is in Context (`src/EMR Flow/PaitentContext.jsx`) and sessionStorage (values encrypted with `encryptData/decryptData` from `src/auth/Crypto.js`).
- Folder styles: newest work is `src/pages/<kebab-name>/{index.jsx, api/ or api-hooks/, components/, css/}`; `src/features/<x>/` is the other clean style; top-level `src/<feature>` folders are legacy. Follow the style of the folder you are in.
- Low-code builder: field controls `src/webparts/components`, builder `src/components/formBuilder/FormBuilder.jsx`, workflow `src/workflow` + newer renderer `src/workflow-ui`, EMR `src/EMR`, `src/EMR Flow`. Primer: `.gemini/facility_tagging_master.md`; component notes in `docs/`.
- i18n: `src/locales/{en,hi,ar}/global.json`, keys mostly under `system` (`t("system.key")`); tenant translations also load at runtime.
- Shared UI: `@akhilsystemspvtltd/augastam-shared-ui` (ChatWidget, PatientAlert, notes/documents/worklist panels). `npm run shared-ui:local` expects `../../../Shared-ui` (not present on every machine).

## Area skills

`fe-webpart-field-type` (form builder fields/flags), `fe-grid-webpart` (grid/multi-entry, medication rows), `fe-emr-visit-screen` (/patient, copy previous visit, side modals), `fe-prescription-printout`, `fe-report-builder`, `fe-patient-registration`, `fe-voice-ai-widgets`, `fe-tenant-flag`; plumbing: `fe-call-api`, `fe-add-page`, `fe-pre-pr-check`.

## Things that bite

- Folders with spaces: `src/EMR Flow`, `src/Error Log`, `src/Rule Master`, `src/assets/EMR Icons`, three `src/components/* Reports`. Quote them in shell commands.
- Typos are real paths: `PaitentContext.jsx`, `employeeServicceSetup`, `ImageAnotation`, `consumeableKit`. Don't "fix" them in passing.
- Field controls exist in three diverging copies (`webparts/components`, `components/builder`, `components/registration/builder`); also duplicate `useDebounce`, `CheckBox2`, `Pagination2`, `CommonModal2`, five `api.js` files. Fix the copy the screen actually imports, then grep for the others and say whether they need the same fix.
- Huge files (3k-5.6k lines): `TableBuilder/TablePreview.jsx`, `tenantCreate/TenantSetup.jsx`, `components/WebpartPreview.jsx`, `pages/reportBuilder/ReportBuilder.jsx`, `components/registration/RegistrationWebpartPreview.jsx`, `components/modals/SidePreviousModal.jsx`, `workflow-ui/previewer.jsx`, `pages/registration/RegistrationPreview.jsx`, `utils/api.js`. Edit surgically.
- Format: tabs, width 4, CRLF (`.prettierrc`, `.editorconfig`), but no Prettier script; never reformat whole files.
- Some routes are not wrapped in `PrivateRoute` and some files call plain `axios`; don't copy either pattern into new code.
- Selected facility = `getFacilityIdForAPI()` (`selected_facility`). Many screens read `JSON.parse(sessionStorage.getItem("facility"))?.[0]`, the user's *first* facility; it is wrong for facility-scoped data once the user switches facility.
- Sessions are per browser tab (sessionStorage); permissions are cached in CacheStorage, so role changes need logout/login.
- `src/reportBuilder` and `src/pages/reportBuilder` partly mirror `augastam-ip-module`; after changing synced files run `report-builder:check`.
- Known secrets in tracked files (don't spread them): the Slack webhook in `.github/workflows/build-environment.yml`, the hard-coded key in `src/auth/Crypto.js`.
