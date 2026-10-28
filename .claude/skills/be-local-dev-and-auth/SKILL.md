---
name: be-local-dev-and-auth
description: Use when running the backend locally (start:dev fails, crashes at boot, which env vars a feature needs, BYPASS_AUTH, debugging), when a new change or endpoint "is not working" / not showing in the local UI, or when a call is rejected - 400 "JWT token not available", 401 "Authorization Failed!", "Tenant not found", "Token expired", 403 migration/chat/data-exchange errors, CORS errors, sockets disconnecting, or handlers seeing no req.body.user/tenantCheck.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Local dev and auth debugging

Commands, ports and the Jwt/Tenant flow are in the backend guide. `.env` is never read by Claude: ask for a variable by name and purpose; a teammate supplies DEV values.

## Boot

1. Node 20 (the deploy workflow runs `nvm use 20.20.2`), `npm ci`.
2. `.env` in the repo root, then `npm run start:dev`, Swagger at `/api`.
3. Point `.env` at a DEV database. Crons (task recurrence/escalation every minute, notification retry, nightly jobs) run in your process against that DB.

`MONGO_DB_NAME` comes from `CONFIG_PARA[NETWORK]` in `config/config.ts`: TEST -> `AKHIL_SYSTEMS_DEV`, DEV -> `AKHIL_SYSTEMS_TEST` (swapped as written), DEMO/UAT/PROD -> `AKHIL_SYSTEMS_<NETWORK>`.

## "My change isn't showing" (check in this order, before touching code)

1. **The request itself.** Ask for the browser Network entry of the call (URL, request body, response). No request = the frontend didn't reload (Ctrl+F5) or the code path isn't hit; a non-localhost URL = the frontend `.env` points to a remote server without the change.
2. **Which process serves it.** PowerShell: `Get-NetTCPConnection -State Listen | ? LocalPort -in 3000,3001,5001,5002,5003,5004` then the PID's `CommandLine` (`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`). `node dist/src/main` serves compiled code: it needs a rebuild **and** restart, and its start time must be later than your last source change. `nest start --watch` (`start:dev`) recompiles itself.
3. **Route present?** `POST`/`GET` it with no auth: 400 "JWT token not available" = route exists and is bound; 404 = not in the running build.
4. **Data, not code.** A 200 with an empty result usually means the record doesn't match the filter: compare the request (ids, facility, time) with the record as the UI shows it (status, date, facility) before changing logic.

Don't run `npm run build` to "refresh" a developer's server without asking: it overwrites the `dist/` they are running.

## Env vars

| When | Variables |
|---|---|
| Crash at import/boot | `NETWORK` (`CONFIG_PARA[NETWORK]` -> `reading 'PORT'`), `ENCRYPTION_KEY` (`Buffer.from(undefined)` in `secure.middleware.ts` and `prereg-secure.middleware.ts`), `AUTHENTICATION_KEY` (only `secure.middleware.ts`; commented out in prereg), `MONGO_URL` (`MongooseModule.forRoot` in app.module) |
| Any authenticated call | `TOKEN_ENCRYPTION_KEY` (base64, 32 bytes, same as the environment that issued the token), `SESSION_SECRET` |
| Other auth schemes | `ONLINE_APPOINTMENT_KEY`, `SUPER_TENANT_KEY`, `JWT_KEY`, `MOBILE_JWT_SECRET`, `MOBILE_JWT_REFRESH_SECRET`, `API_SECRET`, `SSO_SECRET`, `PAYLOAD_ENCRYPTION_ENABLED`, `RATE_LIMIT_ENABLED` (+ `RATE_LIMIT_*`) |
| Storage | `AWS_REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`; `GCP_PROJECT_ID/KEY_FILE`; `AZURE_STORAGE_ACCOUNT_NAME/KEY`; `MINIO_*`; `CUSTOM_S3_*`; `FTP_*` |
| Notifications | `QUEUE_TYPE` (`SQS` default, `KAFKA`, `DB`), `SQS_QUEUE_URL`, `KAFKA_*`, `MAIL_ID`, `MAIL_PASSWORD`, `TWILIO_*` |
| AI | `AUGASTAM_AI_*`, `AUGASTAM_CHECKPOINT_INTERVAL_MS`, `AUGASTAM_VISIT_SUMMARY_*`, `AUGASTAM_CLINICAL_SUMMARY_*`, `AUGASTAM_OCR_*`, `AI_FRIENDLY_MEDICATIONS_ENABLED` |
| Chat | `CHAT_MASTER_KEY` (+ `_PREVIOUS`), `CHAT_PUBLIC_API_URL`, `GIPHY_API_KEY` |
| Reports | `POSTGRES_HOST/PORT/USER/PASSWORD/DB` (lazy pool), `REPORT_SYNC_ENABLED` (on only when `'true'`; needs a replica set) |
| Internal calls | `BACKEND_URL`, `INPATIENT_SERVICE_BASE_URL`, `ONLINE_APPOINTMENT_DOMAIN` |
| Cross-env promotion | `<ENV>_NETWORK`, `<ENV>_MONGO_URL`, `<ENV>_MONGO_DB_NAME` for TEST/DEMO/DEV/UAT/PRE_PROD/PROD |
| Misc | `TASK_WALL_CLOCK_OFFSET_MINUTES` (default IST), `NEWRELIC_APP_NAME`, `NEWRELIC_LICENSE_KEY` (`newrelic` is imported first in `main.ts`) |
| Not needed | `REDIS_*`: `RedisService.onModuleInit` (`src/redis/redisService.ts`) never calls `initialize()` |

Quiet profile: `QUEUE_TYPE=DB`, leave `REPORT_SYNC_ENABLED` unset. Debug: VS Code "Systems Backend (Debug)" runs `npm run start:debug`.

## BYPASS_AUTH

`BYPASS_AUTH=true` makes `JwtMiddleware` (and `JwtTokenOnlyMiddleware`, which extends it) set `req.body.user` to a mock admin: `user_id` = `?user_id` or `test-user`, tenant from params/body/query, `facilities: []`. Local only; the shell-guard hook asks before commands that set it. `WindowServerMiddleware` and every other scheme have no bypass: use a real token from `POST authorization-service/authorization/login` and send `?user_id=` and `?facility=` like the frontend.

## Auth middleware (`src/middlewares/` unless noted)

| Middleware | Expects |
|---|---|
| `JwtMiddleware` | `Authorization: <iv>:<cipher>` (URL-safe base64); `?user_id=` = token user; tenant (params/body/query, incl. `source_tenant_id`) = token tenant, or any `token.tenant[]` entry for admins (who then skip the facility check); else `?facility=[{"value":...}]` non-empty and covering every token facility |
| `WindowServerMiddleware` | token like Jwt, no facility check (`-internal`, master-api) |
| `TenantMiddleware` (`tenantCheck.middleware.ts`) | tenant id from `params.tenant_id`, `body.tenant_id`, `params.id`, `body.id`, `query.tenant_id`, `query.id`; no `isDeleted` check |
| `AppointmentMiddleware` (`online.appointment.middleware.ts`) | `x-api-token` = AES(jwt) with `ONLINE_APPOINTMENT_KEY` |
| `SecureMiddleware` / `PreRegSecureMiddleware` | `{ encryptedPayload }` + `x-encryption-iv`; Secure also `x-authentication-mac` |
| `PayloadDecryptMiddleware` | only when `PAYLOAD_ENCRYPTION_ENABLED=true` |
| `SuperTenantMiddleware` | `x-auth-token` signed with `SUPER_TENANT_KEY` |
| `TenantAndUserMiddleware` (`super-tenant-super-admin.middleware.ts`) | user `isAdmin` + tenant `isSuperTenant` |
| `LambdaFunctionMiddleware` | `x-signature` = HMAC-SHA256(`x-timestamp`, `TOKEN_ENCRYPTION_KEY`), `x-service-name`; timestamp within 50 min (comment says 5) |
| mobile (`mobileJwt.middleware.ts`) | `Authorization: Bearer <jwt>` (`MOBILE_JWT_SECRET`) |
| `TenantAuthMiddleware` + `TenantCredentialsGuard` | `src/data-exchange/middlewares/`, `src/guards/tenant-credentials.guard.ts`: partner credentials + scopes |
| `ChatEnabledMiddleware` (`src/chat/`) | tenant `isChatServiceEnabled` + user/role chat permission |
| `RateLimitMiddleware` | 429 only when enabled and Redis works (it doesn't, so never) |

Find what guards a route: `node ../.claude/tools/check-route-auth.js src/<folder>` or the module's `configure()`.

## Symptom -> cause

| Symptom | Cause |
|---|---|
| boot: `reading 'PORT'` | `NETWORK` missing/misspelled |
| 404 "Cannot POST ..." for a route that exists in source | server runs an old `dist/` (see "My change isn't showing") |
| boot: `TypeError` in `Buffer.from` | `ENCRYPTION_KEY` / `AUTHENTICATION_KEY` unset |
| boot: `MongoServerSelectionError` | `MONGO_URL` unreachable (VPN, IP allow-list) |
| 400 "JWT token not available!" | no `Authorization` (or `x-api-token`/`x-auth-token` for public schemes) |
| 401 "Authorization Failed!" on every call | `?user_id` missing/different; token from another environment or wrong `TOKEN_ENCRYPTION_KEY` (decrypt errors are caught as 401) |
| 401 for non-admins only | `?facility` missing, not JSON, empty, or not covering all token facilities |
| 401 on one route only | literal-vs-generic double run (`be-api-change`) |
| HTTP 401 with body `statusCode: 403` "Token expired" | 8 h token; `POST authorization-service/authorization/refreshToken` |
| 401 "Tenant not found." | no `TENANT_SETUP` match: id taken from the wrong slot (e.g. `params.id` is a record id) |
| 400 "Tenant Id is not available" | `TenantMiddleware` found no id |
| handler `tenantCheck` undefined, data in control DB | route missing from `forRoutes` |
| multipart loses `user`/`tenantCheck` | bind `AuthContextMiddleware`, use `authContextOf` (`src/document-extraction/auth-context.middleware.ts`) |
| browser CORS error, no server log | origin not in `allowedOrigins` or header not in `allowedHeaders` (`src/main.ts`; denied silently) |
| socket connects then drops | gateways decrypt the handshake token themselves (`chat`, `conversation-ai`, `notification`, `voice-transcribe`); chat also needs it enabled |
| 403 "Migration from X to Y is not ..." / "Unsupported environment" | `DataMigrationGuard` (`be-builder-config`) |
| 403 "No tenant authentication found" / "Insufficient permissions for ..." | data-exchange guard / middleware scopes |
| 403 "Chat service is not enabled..." | `ChatEnabledMiddleware` |
| 403 "Invalid signature" / "Request timestamp is invalid or expired" | `LambdaFunctionMiddleware` |

## Do not

- Comment code in `jwt.middleware.ts` / `windowserver.middleware.ts` (a hook asks first). If the bypass block is commented out on your branch, restore it from `development`.
- Fix a 401 by removing a route from the middleware list.
- Log decrypted tokens or `req.body.user`.
