---
name: build-feature
description: Use when a developer asks to build, add, change or fix anything in the Augastam product - a feature, screen, API, field, flag, button, report, bug or ASPL-xxxxx / Azure DevOps ticket - in any workspace repo (backend, frontend, or both) ("build", "implement", "add", "make it so that", "fix", "work on ASPL-...").
argument-hint: "[ASPL-<id>] <what to build>"
---

# Build a feature across the workspace repos

Repos, their skill prefixes and guides are in the **Repos** table in the workspace `CLAUDE.md`. Today: backend (`be-*`) and frontend (`fe-*`); steps below name them, and a new repo plugs in the same way through its own prefix skills.

Input: `$ARGUMENTS`, e.g. `ASPL-173001 blood donor flag on registration`. No ticket id? Ask once (it goes in branch names and commits); if the user has none, use a descriptive slug.

Bugs use the same flow; in step 6 reproduce first (failing spec or exact request/data).

## 0. Start from the latest production code

**REQUIRED first, before reading code:** the `start-feature-branch` skill. It pulls the latest production branch of every repo (Production branch column in `CLAUDE.md`) and creates one branch, named from the request, with the **same name in every repo**. Never push. Exception: continuing work on a branch that already exists for this ticket.

## 1. Find where it lives today

For a change to something that exists, trace it through the repos before planning (read only the relevant ranges; many files are 3k-15k lines):
- screen -> frontend component (`src/ComponentRoute.js` maps path to component) -> its API calls (`axiosInstance.<verb>("<service>/...")`)
- API path -> backend handler (grep `@Controller('<prefix>` per `be-api-change`, or the `his-code-explorer` agent for big areas) -> collections
- data missing or wrong on a screen/print/AI summary -> `clinical-data-tracer` agent

## 2. Decide what changes where (before any branch)

This is a low-code HIS: many "add a field/section/column" requests are **configuration** (webpart fields, workflows, menus, lookups, print formats edited in the builder UI and stored in Mongo), not code. Check first:

- A field on an existing webpart-driven screen (registration, EMR, IP EMR, forms)? It is usually added in the webpart builder, no code. Code is needed only for new behaviour (new `is*` flag, new control type, new save/fetch logic).
- New master/setup screen, new report logic, new workflow step, new integration: code.

State the plan as one line per repo (**backend: yes/no (what)**, **frontend: yes/no (what)**) plus **config only: what to configure**.

- Feature selects records ("upcoming", "active", "pending", "today's", "this patient's")? Write the rule as exact stored values (statuses, date/time formats, which id identifies the record, facility scope) from the area skill, and confirm it with the user against one real record before coding.
- User explicitly asked for code (an API, a component): build it; mention the config alternative in one line.
- User described an outcome only and config covers it: propose the config route and ask before writing code.

## 3. Branches

Already created in step 0. If step 2 ends as configuration only, say the branches are unused (don't delete them unasked).

## 4. Write the API contract first (when more than one repo changes)

Agree on it in the conversation before coding either side:

```
POST patient-service/patient-registration/blood-donor/:tenant_id   (controller prefix + literal segment, see backend CLAUDE.md "route-binding trap")
Auth: JwtMiddleware + TenantMiddleware (frontend adds Authorization, user_id, facility, HMAC headers automatically)
Body: { registration_id, is_blood_donor: boolean }
Response: { statusCode: 200, message, data: {...} }     (backend returns status in the body, HTTP 200)
```

URL prefix picks the backend area: `authorization-service`, `tenant-service`, `configuration-service`, `patient-service`, `inpatient-service`, `billing-service`. `tenant_id` always travels in the path or body; the frontend never adds it automatically.

## 5. Load the area skills (both sides of the same feature)

| Area | Backend | Frontend |
|---|---|---|
| Any new/changed route, module, collection, audit | `be-api-change` (+ `be-tenant-data-access` for DB code) | `fe-call-api`, `fe-add-page` for a new screen |
| Webparts, fields, flags, workflows, lookups, menus, config promotion | `be-builder-config` | `fe-webpart-field-type`; grids: `fe-grid-webpart` |
| Search builder: search config, result columns, column filters, worklist columns | `be-search-builder` | `fe-search-builder` |
| OP EMR visit: save/sign/copy previous visit, side panels | `be-emr-data-model` | `fe-emr-visit-screen` |
| Inpatient: admission, beds, discharge, MAR, pharmacy | `be-inpatient` | (screens under `src/nursesActivity`, `src/EMR`; trace from the route) |
| Registration, appointments, billing/tariff/payer | `be-front-desk` | `fe-patient-registration` |
| Printouts / PDF | `be-print-pdf-templates` | `fe-prescription-printout` |
| Reports, dashboards, report sync | `be-reports` | `fe-report-builder` |
| AI: scribe, voice, summaries, OCR | `be-ai` | `fe-voice-ai-widgets` |
| Tenant/facility-wise setting | `be-tenant-data-access` (TENANT_SETUP; `update-tenant` copies fields one by one) | `fe-tenant-flag` |
| Tasks, notifications, partner/file integrations | `be-task-engine`, `be-rules-alerts-notifications`, `be-external-io` | (trace from the screen) |
| Local run / 401s | `be-local-dev-and-auth` | `fe-call-api` (auth headers) |

Backend guide: `.claude/rules/backend.md` (+ `backend-<area>.md`); frontend guide: `.claude/rules/frontend.md`. Read the relevant one if it isn't in context yet.

## 6. Build: backend first, then frontend against the contract

1. **Parallel copies first.** Grep each method/component you will change repo-wide and state which copies you change. Backend: `src/emr/emr.controller.ts` (v1) with `emr-data.service.ts` / `patient-visit.service.ts` / `sub-emr.service.ts`; the `extractDischargeData` family (`utility.service.ts`, `utility.controller.ts`, `IPVisitData.service.ts`, `AllVisitSummaryService.ts`); `appointment` vs `online-appointment` helpers. Frontend: the three field-control copies (`webparts/components`, `components/builder`, `components/registration/builder`), `WebpartPreview` vs `workflow-ui/previewer`.
2. **Bug:** reproduce first: a failing spec (`be-write-spec` / `spec-writer` agent, or a `*.test.js` for frontend utils) when the logic is testable in isolation; otherwise state the exact request/data/screen steps that show it.
3. **Smallest change that works.** No reformatting or renaming in big files. Local auth bypass is `BYPASS_AUTH=true` in the backend `.env`, never edits to `jwt.middleware.ts`. Existing data needs fixing too? A dry-run script (`be-data-migration-script` / `migration-script-author` agent), never hand-patched data.
4. **Test with the data as it is stored, not as you'd write it:** formatted or numeric phones, unpadded or seconds-bearing times, missing arrays, `"0"`/legacy ids, a second facility, a record just before and after "now". Most bugs here are in the matching, not the happy path.
5. **Scope values from the session:** facility = `getFacilityIdForAPI()` (the header selection), not `facility[0]` (`fe-call-api`).
6. Frontend-only change: skip the backend part; backend-only: skip the frontend part.

Agents for big areas: `his-code-explorer` (map backend code), `clinical-data-tracer` (field config -> every reader).

## 7. Run both locally (when the user wants an end-to-end check)

- Backend: `npm run start:dev` in `akhil_systems_backend` (port from its `NETWORK`: TEST 5002, DEMO 5001, DEV 5003, UAT 5004). `BYPASS_AUTH=true` in its `.env` only if real login isn't available.
- Frontend: `npm start` in `custom-form-builder` (port 3000; `localhost:3000`-`3003` are in the backend CORS list). The frontend picks its API URL from `REACT_APP_<NETWORK>_BASE_URL`; to hit the local backend the user points that variable at `http://localhost:<port>` in the frontend `.env` themselves (Claude can't read or edit `.env`).

Run long-lived servers in the background and stop them when done. Compile-check the backend with `npx tsc --noEmit` (`be-pre-pr-check` step 2); `npm run build` overwrites the `dist/` a developer's local server may run from, so only when asked.

User says it doesn't work locally: follow `be-local-dev-and-auth` "My change isn't showing" (Network entry, which process serves it, route present, data vs filter) before changing code.

## 8. Finish

Run each changed repo's check skill (`be-pre-pr-check`, `fe-pre-pr-check`) and report pass/fail/not run. Then `ship-feature` for commits, push and PRs, only when the user asks.
