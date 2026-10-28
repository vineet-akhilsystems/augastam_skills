---
name: be-rules-alerts-notifications
description: Use when a notification, alert or Rule Master rule is added, changed or misbehaving - "notification not received", duplicate alerts, rule conditions/actions (acknowledge, task created, resolve), templates, SMS/WhatsApp/email vendors, QUEUE_TYPE SQS/Kafka/DB, failed or retried notifications, socket "notification:new", patient alerts, or firing a notification from a new save.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Rules, alerts and notifications

## Code map

| Piece | Code |
|---|---|
| Rule config (`RULE_MASTER`) | `src/rule-master/rule-master.controller.ts` (`configuration-service/rule-master`), `rule-action-events.ts` (`actionAuditEvent`, `actionPrerequisiteProblem`) |
| Routes | `src/notification/notification.controller.ts` (`authorization-service/notification`) |
| Core logic (~3.3k lines) | `notification.service.ts` (`NotificationService`; imported elsewhere as `RuleNotificationService`) |
| Transports | `notificationsqs.service.ts` (SQS + DB polling), `notificationkafka.service.ts` (kafkajs `eachBatch` -> `handleBatch`) |
| Socket push | `notification.gateway.ts` (default namespace) |
| Manual alerts | `manual-alert.ts` (`normalizeManualAlert`), `raiseManualAlert` |
| Older template sender (different class, same name) | `src/functions/NotificationService.ts` |
| Queue harness | `test/notification-queue-delivery.cjs` |

## Rule model

- `RULE_MASTER`: `Trigger_DB_Obj` (collection, compared lower-case), `Trigger_Event` (`create`/`update`), `Initialtemplate`, `Severity`, `rules[]`, `actions[]`, `isActive`.
- `rules[]`: `{ db_object, field: "DB_OBJECT.fieldName", operator, value[], joiner? }`; `ANY`/`ALL` in `value` = "field present".
- `actions[]`: `action_code`, `audit_event` (ACKNOWLEDGED/TASK_CREATED/RESOLVED; aliases 1/2/3 via `actionAuditEvent`), `allowed_roles[]`, `task_details { step_id, step_name, default_role }`, `isActive`. Save-time checks: `actionPrerequisiteProblem` (RESOLVED needs ACK or TASK_CREATED; TASK_CREATED needs a step).
- Templates: `NOTIFICATION_TEMPLATE_CONFIG`. `getTemplatesfromReqBody` finds rules whose `Trigger_DB_Obj` matches the event's `db_obj_name`, loads each linked template, attaches `rules` + `rule_meta`.

## Event flow

1. Entry: domain code calls `processCollectionRuleEvent` / `processIpVisitRuleEvent`, or HTTP `notification-event/:tenant_id`, `op-notification-event`, `event`, `raise-alert`, `send-alert-notification`.
2. `processNotificationEvent` -> `alertEvaluation` / `evaluateAlertRules` (previous value via `getPreviousAlertValue`).
3. Context and recipients: `resolvePatientContext`; roles (`ROLE_PERMISSION`), explicit users, or automatic receivers (consulting doctor/provider) via `resolveReceiverTargets`.
4. `publishEventToSQS`: renders UI text (`resolved_ui_content`), then by `QUEUE_TYPE` (`config/config.ts` `SQS_TYPE`, default `SQS`):
   - `SQS`: FIFO group = uuidv5(tenant + visit/patient id), so one patient's messages stay ordered.
   - `KAFKA`: `NotificationKafkaService.sendMessage`.
   - `DB`: inserts into `EVENT_QUEUE` in the **control DB** (no `tenant_schema`); `pollQueue` reads 10 every 5 s, deletes after success, keeps failures forever (no dead letter, no claim, so two instances can process the same row).
5. Consumer `processSQSMessage` persists one `NOTIFICATIONS_TRANSACTION_QUEUE` row per recipient (stable id, atomic upsert) and calls `NotificationGateway.emitNotification`.
6. Vendor channels (SMS/WhatsApp/email): `sendNotification` posts to `NOTIFICATION_VENDOR_SERVICE_CONFIG` endpoint/payload (`constructPayload`, `@placeholder` text).

## Failures and retries (current behaviour)

- A failed vendor post writes `NOTIFICATION_FAILURE` `{ status: 'RETRY', retry_count: 0, next_retry_at }`.
- **Nothing retries it.** `NotificationRetryScheduler.retryFailedNotifications()` (`notification-retry.scheduler.ts`) starts with `return;` (since Feb 2026). `retryNotification` -> `handleFailure` -> `scheduleDbRetry` (`NOTIFICATION_RETRY_CONFIG`: 3 retries, 1/2/3 min) -> `markDead` (`status: 'EXPIRED'`) is reachable only from that scheduler, so `next_retry_at` is written but never read.
- Before re-enabling: `retryNotification` posts to `endpoint + "1"` (bug); the job loops `TOPIC_DETAILS` rather than `TENANT_SETUP`; it fires per-tenant work without `await` and has no claim (see the Schedulers section of `rules/backend.md`).
- Consumer failures are handled by the transport, not this table: SQS redelivers, then after 3 receives parks the message in `NOTIFICATION_QUEUE_FAILURES` (control DB) and deletes it; Kafka calls `storeFailedMessage`; DB mode keeps the row.

## Actions on a notification

- `PUT read-notification/:tenant_id/:notification_id`: body `snooze` -> `snoozeNotification`; `read_only`/`read_all` -> `markNotificationsRead`; otherwise `acknowledgeSharedNotification` (all `group_id` siblings, emits `notification:read`).
- ACK/TASK_CREATED/RESOLVED write `ALERT_AUDIT`; task creation via `createTaskForRuleAction` (task engine) + `recordTaskCreationAudit`; access by `canPerformNotificationAction` vs `allowed_roles`. `get-notifications` returns `available_actions` / `can_acknowledge` per row.
- Reopen: `reopenSharedNotificationGroup` (called from `manual-task-assignment.service.ts`).
- Patient alerts: `ALERT_TRANSACTION`; `get-patient-alerts`, `get-latest-patient-alerts`.

## Socket delivery

- `NotificationGateway.handleConnection`: token from `handshake.auth.token` or `Authorization: Bearer`, decrypted by its own `decryptToken` (expiry check commented out); joins `tenant_<id>`, `user_<id>`, `role_<id>`.
- `emitNotification` sends `notification:new` to `server.to([user_, role_])` (a socket in both gets it once); throws when there is no user/role.
- **Single-process only**: no Socket.IO cluster adapter. With several pm2/Node processes, an emit reaches only sockets connected to the process that runs the consumer. Notifications stay in the DB (`get-notifications` shows them); the live toast may not arrive. Fixing this means adding an adapter (Redis adapter would need `RedisService` connected first).

## Firing a notification from new domain code

1. Prefer configuration: Rule Master rule with `Trigger_DB_Obj` = the collection the feature writes, `Trigger_Event` create/update, linked template.
2. Module: add `NotificationModule` to `imports`; inject `NotificationService` (alias it `RuleNotificationService` if the file already uses `src/functions/NotificationService`).
3. After the save succeeds:

   ```ts
   await this.ruleNotificationService.processCollectionRuleEvent(
     TABLE_NAMES.BED_TRANSFER_REQUEST,   // collection rules are configured on
     record,                              // saved doc; must carry tenant_id + patient/visit ids
     tenantCheck, userId, 'create',       // 'create' | 'update' (matched against Trigger_Event)
     'BED_TRANSFER_REQUESTED',            // event name
   );
   ```

   IP visit changes: `processIpVisitRuleEvent(visit, tenantCheck, userId, op, eventName)`; derive the event with `getIpVisitStatusTransition(prev, next)` (`atd.controller.ts`, `ip-emr.service.ts`). Both return early unless `tenantCheck.isNotificationApplicable` and swallow errors. Examples: `atd.controller.ts` (bed transfer), `emr-template.controller.ts` (digital forms).
4. Send only the fields the template needs (`resolveNotificationCollections` snapshots referenced fields).
5. Run `node --test test/notification-queue-delivery.cjs` and Jest for rule logic.

## Gotchas

- No auth middleware on `create-topic`, `subscribe-topic`, `publish-message` (SNS) and `get-vendors`; `event/:tenant_id` and `op-notification-event/:tenant_id` have Tenant but no Jwt (internal self-calls).
- Locally use `QUEUE_TYPE=DB`; with the default `SQS` and no `SQS_QUEUE_URL` polling is disabled and nothing is delivered.
