# CLAUDE.md (Augastam EMR workspace)

Start Claude in this folder. It holds the git repos of the Augastam HIS/EMR (Akhil Systems). All skills, agents and hooks live in this folder's `.claude/`, not inside the repos. This folder is not a git repo: run git per repo with `git -C <repo> ...`; every commit, branch and PR belongs to one repo.

## Repos

The workflow skills (`sync-repos`, `build-feature`, `merge-development`, `ship-feature`) work on every row of this table.

| Repo folder | Prefix | Stack | Guide | Install | Check skill | Production branch (new work starts here) | Environment chain (by PR) | Deploy |
|---|---|---|---|---|---|---|---|---|
| `akhil_systems_backend` | `be-` | NestJS 10 + TS, MongoDB per tenant, Postgres reports | `.claude/rules/backend.md` (+ `backend-<area>.md` for `src/emr`, `src/ip-emr`, `src/report`, ...) | `npm ci` | `be-pre-pr-check` | `demo-environment` (no production branch on GitHub; `main` is 3 years old) | development -> test-environment -> demo-environment | merge to `test-environment` auto-deploys TEST (SSH + pm2) |
| `custom-form-builder` | `fe-` | React (CRA) UI + low-code builder | `.claude/rules/frontend.md` | `npm install` (needs `NODE_AUTH_TOKEN`) | `fe-pre-pr-check` | `production-build` | development -> test-environment -> demo-environment -> uat-environment -> production-build; client builds `<client>-uat-environment` / `<client>-production-build` | GitHub workflows disabled; redeployed by hand |

All repos: GitHub org `AkhilSystemsPvtLtd`, merge-based history (no rebase, no force push). New work branches from the repo's **production branch** (`start-feature-branch`); PRs target `development`.

### Adding a repo

1. Clone it into this folder.
2. Add a row above (pick a new prefix, e.g. `mob-`).
3. Add its guide as `.claude/rules/<name>.md` with `paths: ["<folder>/**"]` frontmatter (see `rules/frontend.md`). Keep guides and tools in the workspace, not in the repo: files committed on one branch vanish when a developer switches to another.
4. Add `<prefix>pre-pr-check` (copy `fe-pre-pr-check` and change build/test commands) and any `<prefix>*` how-to skills.
5. Add its column to the area table in `build-feature` step 5 and to the Skills table below, its hot-spot files to `merge-development`, and its API conventions to `build-feature` step 4 if it talks to the backend.

## How work flows

| Developer says | Skill |
|---|---|
| "get latest", "sync", "status of my repos" | `sync-repos` |
| "start", "new branch", any new feature / page / thing | `start-feature-branch`: pulls latest production in every repo, creates one branch name (from the request) in all of them; no push |
| "build / add / change / fix X", "work on ASPL-123" | `build-feature`: starts with `start-feature-branch`, traces it through the repos, decides code vs configuration, agrees the API contract, builds backend (`be-*`) then frontend (`fe-*`) |
| "merge development", "PR has conflicts" | `merge-development` |
| "check", "commit", "push", "raise PR", "move to test" | `ship-feature` (runs each repo's check skill; commits/pushes only when asked) |

## Shared conventions

- Branches: `feature/ASPL-<id>-<slug>`, `bug/aspl-<id>-<slug>`, `task/ASPL-<id>-<slug>`; same name in every repo for one ticket.
- Commits: `[ASPL-<id>]: <what changed>`. Work items: Azure DevOps `AkhilDevOpsNew/SAAS_HIS`.
- Frontend -> backend: `axiosInstance` adds token, `user_id`, `facility`, HMAC; `tenant_id` goes in the path/body explicitly. Backend responds HTTP 200 with `{ statusCode, message, data }`.
- No `gh` CLI installed: PRs are opened from GitHub compare URLs. Never push unless the user asks for that push.
- Never read or edit `.env` files (hooks enforce it); ask the user for variable names instead.

## Skills (`.claude/skills/`)

| Area | Backend `be-` | Frontend `fe-` |
|---|---|---|
| Workflow (all repos) | `sync-repos`, `start-feature-branch`, `build-feature`, `merge-development`, `ship-feature`, `audit-skill` (verify a skill against the code) | |
| API, modules, collections, audit | `be-api-change`, `be-tenant-data-access` | `fe-call-api`, `fe-add-page` |
| Low-code builder config | `be-builder-config` | `fe-webpart-field-type`, `fe-grid-webpart` |
| Search builder (search config, columns, filters, worklist columns) | `be-search-builder` | `fe-search-builder` |
| OP EMR visit | `be-emr-data-model` | `fe-emr-visit-screen` |
| Inpatient (ATD, MAR, pharmacy) | `be-inpatient` | |
| Registration, appointments, billing | `be-front-desk` | `fe-patient-registration` |
| Printouts | `be-print-pdf-templates` | `fe-prescription-printout` |
| Reports | `be-reports` | `fe-report-builder` |
| AI | `be-ai` | `fe-voice-ai-widgets` |
| Tenant/facility settings | `be-tenant-data-access` | `fe-tenant-flag` |
| Tasks, notifications, integrations/files | `be-task-engine`, `be-rules-alerts-notifications`, `be-external-io` | |
| Local dev, auth, tests, data fixes, checks | `be-local-dev-and-auth`, `be-write-spec`, `be-data-migration-script`, `be-pre-pr-check` | `fe-pre-pr-check` |

Repo guides (load automatically when that repo's files are touched): `.claude/rules/backend.md` + `backend-<area>.md`, `.claude/rules/frontend.md`. Backend paths in skills are relative to `akhil_systems_backend/`, frontend paths to `custom-form-builder/src`.

## Agents (`.claude/agents/`, backend)

`his-code-explorer` (map code, read-only), `clinical-data-tracer` (trace a clinical field config -> readers, read-only), `tenant-safety-reviewer` (security/tenant review of a diff, read-only, full checklist inside), `spec-writer` (Jest specs), `migration-script-author` (dry-run data scripts).

## Hooks (`.claude/settings.json`)

Deny force push and `.env` access; ask before any push (stronger warning for environment branches), `reset --hard`, `clean -f`, discarding changes, deleting stashes/branches, rebase, `--apply` data scripts and `BYPASS_AUTH=true`; block edits to `<repo>/dist`, `<repo>/build`, `node_modules`; after backend module/controller edits, report routes with no auth middleware (`.claude/hooks/backend-route-auth-guard.js` using `.claude/tools/check-route-auth.js`, baseline `backend-route-auth-baseline.txt`).
