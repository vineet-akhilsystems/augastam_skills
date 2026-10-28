---
name: sync-repos
description: Use when the user wants the latest code in one or all workspace repos (backend, frontend, ...) - "sync", "pull", "fetch latest", "update my repos", "get latest development", "what's the status of my repos", or at the start of a work session.
argument-hint: "[repo folder(s)] (default: all repos)"
---

# Sync the workspace repos

Repos: every row of the **Repos** table in the workspace `CLAUDE.md` (GitHub `AkhilSystemsPvtLtd/*`; PRs target `development`; new branches start from the Production branch column via `start-feature-branch`). A repo folder listed there but not cloned yet: say so and offer `git clone https://github.com/AkhilSystemsPvtLtd/<repo>.git` (ask first).

**Never hide or discard the user's work to make a sync succeed.** No stash, reset, checkout of files or clean without asking. Uncommitted work is reported, not moved.

## 1. Fetch and report (always safe)

Run for each repo in `$ARGUMENTS` (default all), using `git -C <repo>` so the shell never has to `cd`:

```bash
git -C <repo> fetch --prune origin
git -C <repo> branch --show-current
git -C <repo> status --short | head -20
git -C <repo> rev-list --left-right --count origin/development...HEAD      # "<behind> <ahead>" vs development
git -C <repo> rev-list --left-right --count @{u}...HEAD 2>/dev/null       # vs own upstream; error = never pushed
```

Show one table:

```
repo      branch                      dirty  vs development   vs upstream
backend   feature/ASPL-173001-x        2      12 behind, 3 ahead   in sync
frontend  development                 0      4 behind             4 behind
```

## 2. Update

| Situation | Action |
|---|---|
| On `development`, clean | `git -C <repo> pull --ff-only origin development` |
| On `development`, dirty | Ask: commit, stash (named), or skip this repo |
| On a feature branch | Fast-forward local `development` without switching: `git -C <repo> fetch origin development:development`. Do NOT merge into the feature branch unless asked; offer the `merge-development` skill |
| Feature branch behind its own upstream (teammate pushed) | Clean: `git -C <repo> pull --no-rebase origin <branch>`. Dirty: ask first |
| `--ff-only` fails (local development diverged) | Stop and show `git log --oneline origin/development..development`; someone committed on development locally. Ask what to do |

## 3. After pulling

If the update changed dependency files, say so and offer the install. Don't run it silently, because both installs are slow. Record the old commit **before** updating, since `fetch origin development:development` doesn't move `HEAD`:

```bash
before=$(git -C <repo> rev-parse development)            # before step 2
git -C <repo> diff --name-only "$before" development -- package.json package-lock.json yarn.lock   # after step 2
```

If the checked-out branch didn't change (only local `development` moved), the install isn't needed until the user switches to or merges `development`.

Install command per repo is in the Repos table (backend `npm ci`; frontend `npm install`, which needs `NODE_AUTH_TOKEN` for the `@akhilsystemspvtltd` GitHub Packages scope).

## Report

End with the table again (after state) plus anything skipped and why.
