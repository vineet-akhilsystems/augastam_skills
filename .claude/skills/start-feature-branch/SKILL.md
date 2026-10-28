---
name: start-feature-branch
description: Use when starting any new piece of work in the Augastam repos - a new feature, new page/screen, new API, new module, a fix or an ASPL ticket - before the first code change, or when the user says "start", "new branch", "create branch", "pull production", "start fresh from production".
argument-hint: "[ASPL-<id>] <what is being built>"
---

# Start work: latest production code, one branch name in every repo

Every new piece of work starts from the **latest production code**, on a new branch with the **same name in every repo** of the workspace `CLAUDE.md` Repos table (today backend and frontend), even if only one repo will change. Production branch per repo is the **Production branch** column of that table. Never push; never discard or move the user's uncommitted work.

## 1. Name the branch from the request

Understand the request first (what is being built or fixed), then name it:

| Request | Branch |
|---|---|
| new feature / page / API / module | `feature/ASPL-<id>-<slug>` |
| bug / fix | `bug/aspl-<id>-<slug>` |
| chore / config / task | `task/ASPL-<id>-<slug>` |

`<slug>`: 2-5 lowercase words from the request joined by `-` (`sample-dispatch-page`). No ticket id in the request: drop the `ASPL-<id>-` part (`feature/sample-dispatch-page`); don't block on it. State the name in one line before running anything.

## 2. Per repo: check, update production, branch

For each repo folder in the Repos table (`git -C <repo>`, no `cd`):

```bash
git -C <repo> status --short                    # must be empty, see below
git -C <repo> branch --show-current             # remember it, and HEAD: old=$(git -C <repo> rev-parse HEAD)
git -C <repo> fetch --prune origin
git -C <repo> fetch origin <prod>:<prod>        # fast-forward local <prod> without switching
                                                # (if <prod> is checked out: git -C <repo> pull --ff-only origin <prod>)
git -C <repo> switch -c <branch> --no-track <prod>
```

| Situation | Do |
|---|---|
| Dirty working tree | Stop for that repo and ask: commit on the current branch, named stash (`git stash push -u -m "<current-branch> wip"`), or skip this repo. `git switch` would otherwise carry the changes onto the new branch. |
| `fetch origin <prod>:<prod>` rejected (non-fast-forward) | Local `<prod>` has commits that are not on GitHub. Stop; show `git -C <repo> log --oneline origin/<prod>..<prod>` and ask. Never reset it. |
| `<branch>` already exists (`git -C <repo> rev-parse --verify --quiet <branch>` or `git -C <repo> ls-remote --heads origin <branch>`) | Ask: switch to the existing branch, or use another name. |
| Repo folder missing | Say so; offer `git clone https://github.com/AkhilSystemsPvtLtd/<repo>.git` (ask first). |

`--no-track` keeps the new branch from tracking `<prod>`, so a later plain `git push` can't target the production branch (the shell-guard hook also asks before any push to an environment branch).

## 3. After branching

- Dependencies: `git -C <repo> diff --name-only $old HEAD -- package.json package-lock.json yarn.lock`; if anything changed, offer the install from the Repos table (backend `npm ci`, frontend `npm install` with `NODE_AUTH_TOKEN`). Don't run it silently.
- Production vs development: `git -C <repo> rev-list --left-right --count origin/development...<prod>` -> "`<dev-only>` `<prod-only>`". PRs still target `development` (`ship-feature`); production-only commits (hotfixes) will show up in that PR diff, so mention the count when it is not 0.

## Report

```
repo      from                      branch                         base commit   prod-only vs development
backend   demo-environment (2 min)  feature/ASPL-1234-sample-x     a1b2c3d       0
frontend  production-build (2 d)    feature/ASPL-1234-sample-x     d4e5f6a       3
```

Plus anything skipped and why, and whether an install is needed. Then continue with `build-feature` (step 4 onwards).
