---
name: merge-development
description: Use when bringing the latest development (or another branch) into a work branch in any workspace repo (backend, frontend, ...), when a PR shows "This branch has conflicts", when resolving merge conflicts, or when a merge went wrong and needs to be aborted.
argument-hint: "[repo folder(s), default: every repo on a work branch] [source branch, default development]"
---

# Merge development into a feature branch

All workspace repos use **merge-based history**: `git merge origin/development` into the feature branch, never rebase a pushed branch, never force-push (a hook denies it).

## 1. Preconditions (per repo)

```bash
git -C <repo> fetch origin
git -C <repo> branch --show-current
git -C <repo> status --short               # must be clean
```

| Current branch | Action |
|---|---|
| A work branch (`feature/`, `bug/`, `task/`, `chore/`, `fix/`, personal `<name>-development`, ...) | merge into it |
| `development` | nothing to merge; use `sync-repos` instead |
| An environment branch (`test-environment`, `demo-environment`, `uat-environment`, `production-build`, client builds) | stop; promotions go by PR (`ship-feature` step 5) |
| User named a different branch | ask before switching (`git -C <repo> switch <branch>`), after the tree is clean |

Dirty tree: ask the user to commit or let you stash with a name (`git stash push -u -m "pre-merge <branch>"`). Never stash silently. If you stash, pop it after the merge and say so.

## 2. Merge

```bash
git -C <repo> -c merge.conflictstyle=zdiff3 merge --no-ff origin/development
git -C <repo> diff --name-only --diff-filter=U          # conflicted files
```

Clean merge: go to step 4.

## 3. Resolve conflicts, file by file

For each conflicted file, first see what each side meant:

```bash
git -C <repo> log --oneline --left-right HEAD...MERGE_HEAD -- <file>
git -C <repo> diff MERGE_HEAD~1 MERGE_HEAD -- <file>    # only when one upstream commit touched it; else read the log
```

Rules:
- Keep **both** intents. Most conflicts here are two people adding routes, fields, imports or `case`s in the same spot; the answer is usually "both lines".
- Never resolve whole files with `-X ours/theirs` or `checkout --ours/--theirs` unless the file is generated (lockfile: take `development`'s version, then re-run the install so the lockfile matches `package.json`).
- Don't reformat while resolving. Big files (backend controllers 4k-15k lines, frontend `ComponentRoute.js`, `App.jsx`, `utils/api.js`) must keep untouched lines byte-identical.
- Frontend files are CRLF with tabs; keep that.
- Conflict you can't judge (two different business rules on the same field)? Show both hunks and ask.

Hot spots:

| Repo | File | Typical conflict | Resolution |
|---|---|---|---|
| frontend | `src/ComponentRoute.js` | imports + `<Route>`s added at the same place | keep both |
| frontend | `src/App.jsx` | title `switch` cases | keep both |
| frontend | `src/utils/api.js` | new exported API functions | keep both |
| frontend | `src/locales/*/global.json` | keys added under `system` | keep both, check JSON commas |
| backend | `*.module.ts` `forRoutes(...)` lists | routes added to the auth binding | keep both; a dropped entry makes a route public |
| backend | `config/table-names.config.ts` | interface + object entries | keep both in both places |
| backend | `src/emr/emr.controller.ts` + EMR services | same fix in parallel copies | resolve each copy the same way |

## 4. Verify before committing the merge

```bash
git -C <repo> grep -nE '^(<<<<<<<|=======|>>>>>>>)( |$)' -- ':!*.md'   # must print nothing
git -C <repo> diff --check --cached
```

Then run the build step of the repo's check skill (`be-pre-pr-check` step 2, `fe-pre-pr-check` step 2). A merge that doesn't compile is not done.

```bash
git -C <repo> commit --no-edit
```

## Abort / undo

- Mid-merge, want out: `git -C <repo> merge --abort` (safe, restores pre-merge state).
- Merge committed but not pushed and wrong: tell the user `git reset --hard ORIG_HEAD` would undo it and ask before running it.
- Already pushed: don't rewrite; fix forward with a new commit.

Push only when the user asks (`ship-feature`).
