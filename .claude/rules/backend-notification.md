---
paths:
  - "akhil_systems_backend/src/notification/**"
---

> Backend area guide (`akhil_systems_backend/src/notification`). Paths are relative to `akhil_systems_backend/`.

# src/notification

- `notification.service.ts` holds rule evaluation, recipient resolution, queueing, persistence, shared-group acknowledgement and rule-action task creation. Transports: `notificationsqs.service.ts` (SQS and DB mode), `notificationkafka.service.ts`, chosen by `QUEUE_TYPE`.
- Persisted UI notifications use a stable id with an atomic upsert so partial retries don't duplicate; keep that when changing the consumer.
- Emit to `user_<id>` / `role_<id>` rooms through `NotificationGateway`; there is no Socket.IO cluster adapter.
- Rule actions: ACKNOWLEDGED / TASK_CREATED / RESOLVED (`src/rule-master/rule-action-events.ts`), access checked against `allowed_roles`, audited in `ALERT_AUDIT`.
- Run `node --test test/notification-queue-delivery.cjs` after changing queue code. 5 of its 59 tests already fail on `development` (IP vitals events, read/bulk-read copies, legacy task copies); check you didn't add to that.
- New events from domain code: `processCollectionRuleEvent(dbObject, record, tenantCheck, userId, 'create'|'update', EVENT_NAME)` after the save (see the `be-rules-alerts-notifications` skill).
- Skills: `be-rules-alerts-notifications`.
