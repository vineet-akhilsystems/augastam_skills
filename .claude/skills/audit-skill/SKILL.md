---
name: audit-skill
description: Use when a workspace skill in .claude/skills is new, was just edited, is suspected stale or wrong, or before trusting an old skill - "audit the X skill", "check this skill", "is this skill still correct", "skill gave wrong file/line", or after a big merge/refactor of files a skill names.
argument-hint: "<skill-name> [more skill names]"
---

# Audit a workspace skill against the code

A skill here is a map of the code: file paths, functions, line hints, routes, payload keys and "bug-prone" claims. The audit proves each one against the **current** code and then checks that a fresh agent can actually use the skill. Edit only the skill files; never change repo code during an audit.

Audit against the branch developers start from (Production branch column in `CLAUDE.md`), without switching branches (the working tree may hold someone's work): `git -C <repo> fetch origin`, then `git -C <repo> cat-file -e origin/<prod>:<path>` (exists), `git -C <repo> grep -n "<name>" origin/<prod> -- <path>` (find + line), `git -C <repo> show origin/<prod>:<path> | sed -n 'A,Bp'` (read a range). A file that exists only on the current feature branch is not proof.

## 1. Format and discovery

| Check | Pass when |
|---|---|
| `name` | equals the folder name; letters, digits, hyphens |
| `description` | starts with "Use when", third person, lists triggers/symptoms only (no workflow summary), whole frontmatter under 1024 chars |
| Repo banner | first line under the frontmatter says which repo the paths are relative to (copy from a sibling `be-*`/`fe-*` skill) |
| Registered | in the `CLAUDE.md` Skills table; area skills also in `build-feature` step 5 |
| Cross-references | every skill/agent named in the text exists in `.claude/skills` or `.claude/agents` |

## 2. References (mechanical)

List every backticked token and check the ones that name code:

```bash
S=.claude/skills/<skill>/SKILL.md; R=<repo folder>; P=<prod branch>; PRE=<"" for backend, "src/" for frontend>
grep -o '`[^`]*`' "$S" | tr -d '`' | sort -u \
 | grep -E '^[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|json|md|cjs)$' | while read p; do
  git -C "$R" cat-file -e "origin/$P:$PRE$p" 2>/dev/null || git -C "$R" cat-file -e "origin/$P:$p" 2>/dev/null || echo "MISSING PATH $p"; done
```

Then by hand (grep, read only the range):
- **Functions / handlers / state names** named with a file: `grep -n "<name>" <file>`; missing = wrong.
- **Line hints** (`~1234`, `1015-1062`): actual line within about 50 lines, else update it.
- **Routes**: decorator exists in the controller (`grep -n "@Put('<path>'" ...`) and, for backend, the path is in both `JwtMiddleware` and `TenantMiddleware` `forRoutes` of the module (`node ../.claude/tools/check-route-auth.js` from the backend folder).
- **Payload / stored keys**: grep the writer and at least one reader; a key with no reader is reported as such, not as a bug.
- **Shell commands**: run the read-only ones (`--help`, `--noEmit`, a single spec) or confirm the script exists in `package.json`.

## 3. Claims

For each "only", "never", "always", "must", each bug-prone spot and each "X happens because Y": open the code and mark **correct / wrong / unverifiable**. Wrong claims are the most expensive finding: an agent will build on them.

## 4. Application test (fresh agent)

Spawn one read-only agent (`subagent_type: "Explore"`, `model: "sonnet"`) per skill or per backend+frontend pair. Brief: the skill file path(s), the repo folders, and **two realistic tasks taken from the description's triggers** (one "add/build X", one "X is broken"), asking for exact files/functions/payload keys and for anything in the skill that is wrong or missing versus the code. Do not hint at the answers or the skill's traps.

Grade: did it land in the right files, and did it hit the skill's key traps by itself? Every gap it reports is verified in the code before it goes into the skill.

## 5. Report and fix

```
| # | Finding | Kind (wrong / stale line / missing / format) | Evidence (file:line) | Fix |
```

Apply the fixes to the skill (small, in place; keep the house style of sibling skills), re-run step 2 on the changed lines, and end the skill with one line:

`Last audited: <YYYY-MM-DD> against <repo>@<branch> <short sha> [, <repo2>@<branch> <sha>]`

Report: findings table, what was fixed, what was left (and why), and the application-test verdict.
