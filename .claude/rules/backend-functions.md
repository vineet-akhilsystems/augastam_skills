---
paths:
  - "akhil_systems_backend/src/functions/**"
---

> Backend area guide (`akhil_systems_backend/src/functions`). Paths are relative to `akhil_systems_backend/`.

# src/functions (shared services)

- `MongoDBService.ts`: the data layer; always pass `tenant_schema`. `findByQuery` takes an aggregation pipeline. `generateAutogenerateNumber` is not atomic. Skill: `be-tenant-data-access`.
- `sqltomongoquery.ts`: report SQL -> Mongo pipeline, with blocked collections and sensitive-field guards; change it test-first in `sqltomongoquery.spec.ts`.
- `PdfService.ts`: print template engine + Puppeteer. Line ~598 holds a corrupted regex (`$begin:math:display$`) that never matches; changing it alters printouts. Skill: `be-print-pdf-templates`.
- Storage providers (`s3Service`, `GcpStorageService`, `AzureBlobStorageService`, `bharathB3Service`, `CustomS3StorageService`, `ftpService`) share the `FileUploadProvider` shape; pick by tenant `cloudProvider.code`. Skill: `be-external-io`.
- `AllVisitSummaryService.ts` duplicates `utility.service.ts` / `IPVisitData.service.ts` extraction logic.
- `kafka-MiddlewareService.ts` posts to a hard-coded test Kafka REST host for every environment.
- Small pure helpers (`facilityCountry.ts`, `utils.ts`) have specs; keep new helpers pure and tested.
