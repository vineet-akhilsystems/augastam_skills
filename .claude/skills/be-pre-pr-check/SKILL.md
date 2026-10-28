---
name: be-pre-pr-check
description: Use when backend (akhil_systems_backend) changes need checking before a commit, PR or merge - "check my backend changes", "ready for PR", "is this endpoint protected", or when ship-feature runs checks for the backend.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Backend pre-PR check

Run against the current branch versus `development`. Report every step as pass / fail / not run (with the reason). Don't fix things silently; list findings and ask, unless the fix is trivial and clearly within the task. The review in step 6 is done by the `tenant-safety-reviewer` agent.

## 1. What changed

```bash
git fetch origin development
git diff --stat origin/development...HEAD
git status --short
```

Flag immediately:
- any change to `src/middlewares/jwt.middleware.ts` or `windowserver.middleware.ts` (usually an accidental local auth toggle; ask whether it is intended)
- env files, `dist/`, `package-lock.json` changes not explained by the task
- reformatting-only hunks in large files

## 2. Compile

```bash
npx tsc --noEmit -p tsconfig.json
```

~20s, writes nothing. Known baseline on `development`: 1 error in `src/ai-configuration/ai-configuration.filter.spec.ts` (TS2554); anything else is new. If `node_modules` is missing, say so and offer `npm ci`; don't skip silently. TEST deploys have no build step (pm2 compiles on restart), so a compile error here would otherwise surface only on the server.

`npm run build` rewrites `dist/`, which a developer's local server may be running from (`node dist/src/main`); run it only when the user asks.

## 3. Tests

```bash
npx jest --findRelatedTests <changed .ts files>
```

Specs import `config/config` and need `NETWORK` (from `.env`, or prefix `NETWORK=DEV`). First Jest run ~70s. If notification code changed, also run `node --test test/notification-queue-delivery.cjs` and compare with its baseline of 5 failing tests on `development` (see `be-write-spec`). Old 19-line "should be defined" stubs may fail for DI reasons unrelated to the change; separate those from real failures. If changed logic has no spec, say so (offer the `spec-writer` agent / `be-write-spec`).

## 4. Route auth

```bash
node ../.claude/tools/check-route-auth.js <changed module folders>     # each line: VERB /path file:line
```

Auth is bound per route in each module's `configure()`, so a route missing from the `forRoutes(...)` lists is public. For each route the branch adds or changes that shows up:

1. **Meant to be public?** (login/OTP/reset, online appointment and pre-registration under their own middleware, health) Leave it, but it needs rate limiting or its own token check. Say so in the PR.
2. **Protected another way?** The checker knows the Jwt*, WindowServer, Appointment, Secure, PreRegSecure, SuperTenant, TenantAndUser, Lambda, Session, TenantAuth and ChatEnabled middlewares; not `@UseGuards` or in-handler checks (file-upload controllers call `this[DBService].authenticate(...)`). Read the handler.
3. **Real gap:** add the exact path + method to the module's Jwt and Tenant lists (`be-api-change`), avoiding the literal-vs-generic double-run trap.

The workspace hook already reports new unbound routes after each module/controller edit, filtered by `../.claude/hooks/backend-route-auth-baseline.txt`. Refresh that baseline only after a reviewed decision and with the user's agreement: `node ../.claude/hooks/backend-route-auth-guard.js --write-baseline`.

## 5. Duplicate copies

For each changed method, grep its name; if it also exists in a known parallel copy (EMR v1 controller vs services, the three visit-summary services, appointment vs online-appointment helpers), confirm both were updated or explain why not.

## 6. Safety review

Run the `tenant-safety-reviewer` agent on the diff (for a few-line diff, apply its checklist yourself): auth binding, `tenant_schema` on every DB call, regex escaping, PHI in logs/responses, audit on writes.

## 7. Release checklist (only items the change touches)

- New env vars: documented in `be-local-dev-and-auth` and the user told they must be provisioned on servers.
- New collections: indexes (script or ensure-on-use), `TABLE_NAMES` interface + object, report blocking (`be-api-change`).
- Existing data to fix: a dry-run script (`be-data-migration-script` / `migration-script-author` agent) with run instructions for the PR.
- New routes: Swagger decorators.
- `Dockerfile` copies `.env` into the image; never suggest pushing such an image to a public registry.

## 8. Summary

```
Compile: pass (baseline only) | Tests: 4 passed, 1 unrelated stub failing (list) | Route auth: no new unbound routes
Duplicates: emr.controller.ts updated too | Safety: 1 finding (file:line, ...) | Not run: ...
```
