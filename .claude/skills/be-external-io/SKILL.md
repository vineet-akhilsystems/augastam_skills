---
name: be-external-io
description: Use when the backend talks to another system or stores files - Kafka producer, HIS status/lab report/PACS, EkaCare, DeepInfinity, FHIR/master API, ABHA, SMS/OTP, Twilio/WhatsApp, SNS, email, GIPHY, partner data-exchange credentials, or file upload/download/signed URL/delete across S3, GCP, Azure, MinIO/BharathCloud, custom S3, FTP; also "image not loading", "signed URL expired", "upload fails for one tenant".
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# External I/O: partners and file storage

## Outbound integrations

| Integration | Code | Config | Notes |
|---|---|---|---|
| Kafka producer (EMR, appointment, IPD EMR, partition, doctor visit) | `src/functions/kafka-MiddlewareService.ts` | tenant flags `isEMR_Producer`, `isAppointment_Producer` | Posts to a Kafka REST middleware **hard-coded to `https://kafka-test-consumer.augastam.com` for every environment**; logs `PRODUCER_DATA_LOGS` (`produceEmrData` logs to the control DB, no `tenant_schema`) |
| Notification Kafka consumer | `src/notification/notificationkafka.service.ts` | `KAFKA_BROKERS`, `KAFKA_USERNAME/PASSWORD`, `KAFKA_SSL`, `KAFKA_SASL_MECHANISM`, `KAFKA_NOTIFICATION_TOPIC`, `QUEUE_TYPE=KAFKA` | see `be-rules-alerts-notifications` |
| HIS EMR status | `EmrDataService.syncEncounterEmrStatus` (`emr-data.service.ts`) | tenant `report_base_url`, `report_url_username/password` | `${base}/api/VCP/UpdateEncounterEmrStatus`; retries `HIS_STATUS_RETRY_DELAYS_MS` [2000, 5000]; audited `HIS_ENCOUNTER_EMR_STATUS`; called without `await` so it never blocks the save |
| HIS lab reports / PACS | `EmrDataService.downloadLabReport`, `fetchPacsUrl` (also `emr.controller.ts`) | same | token via `getTenantToken` |
| HIS token | private `getTenantToken` copies in `emr-data.service.ts`, `patient-visit.service.ts`, `ip-emr.service.ts`, `appointment.controller.ts`, `service.controller.ts`; shared `src/functions/HisAuthService.ts` | | the emr-data copy caches per tenant and dedupes refreshes; **`HisAuthService` has its cache/dedupe commented out** (fetches every call) |
| Internal server-to-server | `AllVisitSummaryService` -> `inpatient-service/ip-emr/*-internal` | `INPATIENT_SERVICE_BASE_URL` | `WindowServerMiddleware` |
| EkaCare document AI | `src/master-api/eka-care.service.ts` | client id/secret | token cache, upload, `initTransaction`, poll |
| DeepInfinity | `src/master-api/deep-infinity.service.ts` | `deepinfinityapim.azure-api.net` | |
| FHIR mapper / master uploads / O-Health | `master-api.controller.ts` (`fhir-mapper`, `upload-file-to-master-api/:master_type`, `get-Ohealth-data`) | | `WindowServerMiddleware` + Tenant |
| ABHA lookup | `patient-registration.controller.ts` `GET abha-details/:tenant_id` | | |
| Twilio (WhatsApp / SMS) | `patient-registration.controller.ts` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | |
| AWS SNS | `src/functions/awsService.ts` (`AWSService`) | `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` | topic/subscribe/publish routes are unauthenticated |
| Email | `src/functions/NodemailerService.ts` (`MAIL_ID`, `MAIL_PASSWORD`, patched DNS resolver 8.8.8.8/1.1.1.1), `EmailTemplateService.render` | | on failure returns `{ response: 404 }` instead of throwing; check it |
| GIPHY | `chat.controller.ts` `gif/search` | `GIPHY_API_KEY` | server-side proxy, fixed rating |

### Mobile OTP SMS (debt)

`src/mobile-patient/authorization.controller.ts` `generate-otp`: the bulk-SMS send is **commented out**, the SMS username/password are **hard-coded literals** in the file, the OTP is stored in `OTP_COLLECTION` in the control DB and **returned in the response** (`data: [{ otpNo, mobileNo }]`). Never copy this code or its credentials; a fix needs env-based credentials (rotated), the send restored, and the OTP removed from the response.

### Inbound partner API (data-exchange)

`tenant-service/data-exchange`: `post-data/:tenant_id` and `modules/access` use `TenantAuthMiddleware` + `TenantCredentialsGuard` with scopes (`appointments:read|write`, `patients:read|write`, `billing:read|write`, `reports:read`, `admin`; `MODULE_SCOPE_MAPPING`). Credentials from `CredentialGenerator`. The credential management routes (`credentials` create/list/get/update, `disable-credentials/:id`, `credentials/:id/regenerate`, `test-client`) have **no auth middleware**; bind Jwt + Tenant (admin) before exposing them.

## File storage

### Provider selection

Tenant `TENANT_SETUP.cloudProvider.code` (on `tenantCheck`), bucket `tenantCheck.bucketName`. Every caller has its **own** `getProvider` switch, usually called as `this.getProvider(tenantCheck?.cloudProvider?.code || 'AWS')`:

| Code | Service | File (`src/functions/`) |
|---|---|---|
| `AWS` | `S3Service` | `s3Service.ts` |
| `GCP` | `GcpStorageService` | `GcpStorageService.ts` |
| `AZURE` | `AzureBlobService` | `AzureBlobStorageService.ts` |
| `BHARATHCLOUD`, `MINIO` | `BharathB3Service` (MinIO client) | `bharathB3Service.ts` |
| `CUSTOM_S3` | `CustomS3StorageService` | `CustomS3StorageService.ts` |
| (flag `tenantCheck.isOnPremiseFileStorageEnabled`) | `FtpService` | `ftpService.ts`; branched inside `file-upload-v2.controller.ts`, not in any switch |

**Switch copies disagree (likely bugs); check the copy you edit:**
- `authorization.service.ts` `getProvider` uses `'CUSTOMS3'` (no underscore) and is `async`; `createBucketOnDestinationCloud` calls it without `await`.
- `authorization.controller.ts` `getProvider` has no custom-S3 case and lists `'MINIO'` twice.
- `ip-emr.service.ts` `getProvider` handles only `AWS` and `CUSTOM_S3`.
- `file-upload-v2.controller.ts`, `emr-data.service.ts`, `emr.controller.ts`, `patient-visit.service.ts`, `sub-emr.service.ts`, `patientemr.controller.ts`, `ipemr.controller.ts`, `chat.controller.ts`, `care-plan.controller.ts`, `document-extraction.service.ts` / `.scheduler.ts` use `'CUSTOM_S3'`.
- Most of those copies `default:` to `S3Service`; the authorization pair, `ip-emr.service.ts` and `file-upload-v2.controller.ts` have no default and return `undefined` for an unhandled code.

### Provider API

`FileUploadProvider` (`src/file-upload/interface/FileUploadProviderInterface.ts`) declares only: `uploadFile(file, bucket, folder, key)`, `uploadHtmlContentToS3?`, `uploadImages(files, bucket, folder, facility_id, isReference?, file_id?)` (original + compressed reference copy), `getSignedUrl(key, bucket)`, `listObjects`, `copyObject`, `objectExists`. `GcpStorageService`, `AzureBlobService`, `CustomS3StorageService` declare `implements FileUploadProvider`; `S3Service` and `BharathB3Service` do not.

Class-only methods (not in the interface, signatures differ):
- `downloadFile(bucket, key)` on all five.
- `deleteFile`: **`(key, bucket)`** on S3/GCP/Azure, **`(bucket, key)`** on BharathB3/CustomS3. Check argument order per provider.

Signed URL lifetime: `getSignedUrl` 24h on S3, MinIO, custom S3, Azure; **10 min on GCP**.

### Endpoints

- `tenant-service/v2/file-upload` (`file-upload-v2.controller.ts`): `upload`/`update`/`get-file`/`delete` (ASSETS), `upload-files`, `delete-files` (+ `pre/` variants for pre-registration), `get-image`, `presigned`, `get-growth-chart-files`, `upload-multiple-images`, `get-multiple-images`, `update-images`, `delete-images`, `delete-multiple-images`.
- `tenant-service/file-upload` (v1), `tenant-service/aws-s3` (`src/aws_s3`).
- Feature uploads: chat attachments (encrypted, signed download token), document extraction, bed media, patient attachments.
- `upload` stores **bytes in Mongo** `ASSETS` (`{ filename, data, tenant_id, uploaded_by }`, 16 MB doc limit); cloud routes store in the bucket.
- Several file-upload handlers authenticate **inside the handler** (`this[DBService].authenticate(headers.authorization, user_id, TABLE_NAMES.USER, tenant_id)`), so the route checker reports them unbound; read the handler first.

### File rules

1. Save provider + bucket on the record at upload; use them for later sign/delete (`DocumentExtractionService`: `file_provider`/`file_bucket`, falls back to tenant's current provider).
2. Never persist a signed URL; re-sign on read.
3. Multipart: `AuthContextMiddleware` after Jwt/Tenant, read with `authContextOf`.
4. Size/type limits in `FileInterceptor({ limits })` and in the service.
5. Serve uploads with safe `Content-Type`/`Content-Disposition` (chat download route is the reference).

## Adding an integration

1. Base URL, credentials, timeouts from env or tenant/facility config; never literals (the Kafka and OTP code are the counter-examples).
2. Call after the response or with `.catch` so a partner outage never fails a clinical save; retry only transient errors.
3. Log host and status only, never query strings, tokens or patient data.
4. Cache tokens per tenant with expiry and dedupe concurrent refreshes (emr-data `getTenantToken` pattern, not `HisAuthService` as it stands).
5. Record what was sent (`PRODUCER_DATA_LOGS` with `tenant_schema`, or an audit entry).
6. Bind auth middleware on every new route (`node ../.claude/tools/check-route-auth.js`).
