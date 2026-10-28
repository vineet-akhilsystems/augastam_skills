---
name: ship-feature
description: Use when work in any workspace repo is ready to go out - "check my changes", "ready for PR", "commit this", "push", "raise/open a PR", "deploy to test", "move to test/demo/uat/prod", or before merging a feature branch.
argument-hint: "[check|commit|push|pr|promote] (default: whole flow, stopping for approval)"
---

# Ship a feature: check, commit, push, PR, promote

Repos, their check skills and environment chains are in the **Repos** table in the workspace `CLAUDE.md`. Work on every repo with changes (`git -C <repo> status --short`, `git -C <repo> log origin/development..HEAD`).

Stop between stages for the user's go-ahead: **commit, push, and anything touching an environment branch happen only when the user asks for that stage.**

Which branch ships: the current work branch. If a repo is on `development` or an environment branch with changes to ship, stop and ask which work branch to create or use (`build-feature` step 3); nothing is committed on `development` or env branches directly.

## 1. Check

Run the repo's check skill from the Repos table (`be-pre-pr-check`, `fe-pre-pr-check`, ...) for each changed repo. Then one summary line per repo. A repo without a check skill: at least build it and review the diff.

## 2. Commit

```
[ASPL-<id>]: <what changed, in the ticket's words>
```

One logical change per commit; stage files by name (`git -C <repo> add <files>`), never `git add -A` in a repo with stray local edits. Same ticket in several repos = same subject in each.

## 3. Push

Bring in latest `development` first if the branch is behind (`merge-development`). Then:

```bash
git -C <repo> push -u origin <work-branch>
```

A hook asks before every push; force push is denied.

## 4. Pull request (no `gh` CLI on this machine)

Give the user one compare URL per repo; when one repo's change depends on another's (frontend on a new API), list the provider first:

```
https://github.com/AkhilSystemsPvtLtd/<repo>/compare/development...<url-encoded branch>?expand=1&title=<url-encoded title>
```

- Base: `development`. A feature PR never goes straight into an environment branch (see step 5 for hotfixes).
- Title: `<x.y.z> [ASPL-<id>]: <summary>`. The semver is the release the change ships in; ask the user (suggest the next patch of `node -p "require('./package.json').version"` in that repo). Don't bump `package.json` in a feature PR.
- Body: Azure DevOps items, one per line, e.g. `[Task 173001](https://dev.azure.com/AkhilDevOpsNew/SAAS_HIS/_workitems/edit/173001): <title>`; what changed; how it was tested; config/menu/migration steps; links to the paired PRs in the other repos.
- Reviewers come from each repo's CODEOWNERS.

With `gh` installed (`winget install GitHub.cli`, `gh auth login`), `gh pr create --base development --title ... --body-file ...` replaces the URL.

## 5. Promote to environments (only on request)

Changes move by PR along the repo's chain in the Repos table, after the feature is merged into `development`. Deploy behaviour per repo is in the same table (the backend `test-environment` auto-deploys on merge; frontend environments are redeployed by hand, so ask who does it).

Before proposing a promotion PR, measure what it would carry:

```bash
git -C <repo> fetch origin
git -C <repo> rev-list --count origin/<target>..origin/<source>
git -C <repo> log --oneline origin/<target>..origin/<source> | head -30
```

If it carries much more than the user's feature (the backend `test-environment` has lagged `development` by hundreds of commits), say so and let the user/lead decide. Never push or merge into an environment branch directly; give `compare/<target>...<source>?expand=1`.

**One feature onto an environment that lags `development`** (pattern already used in the frontend: `Task-63252-test-env`, `bug-63845-uat`, `ASPL-170860-...-prod`):

```bash
git -C <repo> switch -c <ticket>-<env-suffix> origin/<env-branch>     # suffix: test-env | uat | prod
git -C <repo> cherry-pick -x <feature commits, oldest first>           # not merge commits
```

Run the repo's check, then (when asked) push and give `compare/<env-branch>...<ticket>-<env-suffix>?expand=1`. Never PR the feature branch itself into an env branch: it is based on `development` and carries everything `development` has.
