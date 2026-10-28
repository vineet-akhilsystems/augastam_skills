# Claude Code setup for the Augastam EMR workspace

Start Claude from `C:\Users\HP\Desktop\akhil_system\Augastam EMR`. Everything (skills, agents, repo guides, hooks, tools) lives here, outside the repos, so it works on every branch. This folder is not a git repo; copy `.claude/` and `CLAUDE.md` to share the setup.

The repo list, prefixes, check skills and environment chains are in the **Repos** table of the root `CLAUDE.md`; the workflow skills read it, so adding a repo is a table row plus that repo's guide and skills (steps in `CLAUDE.md` > "Adding a repo").

## Layout

```
CLAUDE.md                     repo table, conventions, skill index (always loaded)
.claude/
  skills/
    sync-repos  start-feature-branch  build-feature  merge-development  ship-feature  audit-skill   workflow, all repos (6)
    be-*                                                         backend, 17
    fe-*                                                         frontend, 12
  agents/        his-code-explorer, clinical-data-tracer, tenant-safety-reviewer, spec-writer, migration-script-author
  rules/         backend.md + backend-<area>.md, frontend.md     repo guides, load when that repo's files are touched
  tools/         check-route-auth.js                             backend route-auth checker (run from akhil_systems_backend)
  hooks/         shell-guard, protect-files, backend-route-auth-guard (+ baseline)
  settings.json  permissions + hook wiring
```

## Everyday use

| You want to | Say or type |
|---|---|
| get latest code in all repos | `/sync-repos` |
| start new work: pull latest production, same new branch in every repo | `/start-feature-branch ASPL-173001 blood donor flag` (`/build-feature` runs it first) |
| check a skill is still correct against the code | `/audit-skill fe-search-builder` |
| build or fix anything | describe it, or `/build-feature ASPL-173001 blood donor flag on registration`; it picks the area skills on both sides |
| bring `development` into your branch | `/merge-development` |
| check, commit, push, PR, promote | `/ship-feature` (or `/ship-feature pr`); nothing is pushed unless you ask |

## Hooks

| Hook | Effect |
|---|---|
| `hooks/shell-guard.js` (Bash/PowerShell) | deny force push and `.env` access; ask before any push (named warning for `development`/env/client branches), `reset --hard`, `clean -f`, `checkout/restore .`, `stash drop/clear`, `branch -D`, rebase, `--apply`, `APPLY=true`, `BYPASS_AUTH=true` |
| `hooks/protect-files.js` (Edit/Write) | deny `.env*`, keys/certs, `<repo>/dist`, `<repo>/build`, `node_modules`; ask before editing backend `jwt`/`windowserver` middleware |
| `hooks/backend-route-auth-guard.js` (after Edit/Write) | after a backend `*.module.ts` / `*controller.ts` edit, lists routes with no auth middleware not in `backend-route-auth-baseline.txt`. Refresh after a reviewed decision: `node .claude/hooks/backend-route-auth-guard.js --write-baseline` |

Hooks need Node on PATH. Review or disable them with `/hooks`. Personal overrides go in `.claude/settings.local.json`.

## Keeping skills accurate

Skills describe current code, including known defects. When a change makes a skill or guide wrong, update it in the same piece of work. Older onboarding material in `akhil_systems_backend/docs/claude-code-skills-guide.*` describes the previous skill set and is out of date.
