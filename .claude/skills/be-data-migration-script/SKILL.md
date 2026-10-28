---
name: be-data-migration-script
description: Use when existing backend data must be backfilled, repaired or migrated across tenant databases - "fix old records", "backfill a new field", "data got corrupted", "run this for all tenants", or a fix that only works for new saves.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Data migration scripts

To hand off writing the script and running its dry run, use the `migration-script-author` agent; it follows this file.

Examples to copy: `scripts/mark-webparts-not-system.ts` (simplest), `scripts/reverse-cron-auto-protected-fields.ts`, `scripts/tag-all-facilities.ts` (full CLI: `--apply`, `--network=`, `--tenant=`, `--masters=`, `--batch-size=`, time estimate), `scripts/report-sync-backfill.ts` (calls a service).

## Template

```ts
// One-off: <what and why>. Dry run by default; pass --apply to write.
//   npx ts-node -r tsconfig-paths/register scripts/<name>.ts [--apply] [--tenant=<tenant_id>]
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MongoDBService } from '../src/functions/MongoDBService';
import { AuditService } from '../src/audit/audit.service';
import { TABLE_NAMES } from '../config/config';

const APPLY = process.argv.includes('--apply');
const ONLY_TENANT = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(MongoDBService);
  const audit = app.get(AuditService);

  const tenants = await db.findByQuery(TABLE_NAMES.TENANT_SETUP, [
    { $match: { isDeleted: { $ne: true }, ...(ONLY_TENANT ? { tenant_id: ONLY_TENANT } : {}) } },
    { $project: { tenant_id: 1, tenant_schema: 1 } },
  ]);

  let matched = 0, changed = 0;
  for (const tenant of tenants) {
    if (!tenant.tenant_schema) continue;
    try {
      const docs = await db.findByQuery(TABLE_NAMES.X, [{ $match: { tenant_id: tenant.tenant_id, /* condition */ } }], tenant.tenant_schema);
      matched += docs.length;
      if (!APPLY) continue;
      for (const doc of docs) {
        await db.updateItemQuery(TABLE_NAMES.X, { _id: doc._id }, { /* $set */ }, tenant.tenant_schema);
        await audit.record({ tenant_id: tenant.tenant_id, reference_id: doc.x_id, module: '...', object: '...', operation: 'migration-<name>', old_value: ..., new_value: ..., performed_by: 'system', tenant_schema: tenant.tenant_schema });
        changed++;
      }
    } catch (e: any) {
      console.error(`tenant ${tenant.tenant_id}: ${e.message}`);   // one tenant must not stop the run
    }
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: matched=${matched} changed=${changed} tenants=${tenants.length}`);
  await app.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

## Rules

- **Dry run is the default.** Print what would change (counts, a few sample ids). Only `--apply` writes. The shell-guard hook asks for confirmation on any command containing `--apply`.
- **Check the target first.** The app context uses `.env` (`NETWORK`, `MONGO_URL`). State which environment and tenant you are about to touch, and get explicit approval before `--apply` against anything other than a local/DEV database.
- **Idempotent.** Re-running must not double-apply: filter on the old shape, or set a marker field.
- **Per tenant schema.** Never write to the control DB except `TENANT_SETUP` changes that are intended.
- **Batch large updates** (`bulkUpdateOrCreate` with `updateOne` ops, ~1000 per batch) and log progress per tenant.
- **Audit** changes to configuration or clinical data with `await audit.record(...)` (performed_by `system`), as `mark-webparts-not-system.ts` does. Not `recordAsync`: it defers the write with `setImmediate`, so it can be lost when the script closes the app and exits.
- Booting `AppModule` starts cron jobs: a long run also executes the every-minute task schedulers against the same DB, so keep scripts short. Report sync starts only when `REPORT_SYNC_ENABLED=true`; `report-sync-backfill.ts` forces it off.
- Add an `npm run` alias in `package.json` only for scripts meant to be reused (`tag:facilities` is the precedent).
- For index-only changes use a mongosh script like `scripts/report-indexes.mongodb.js` (dry run unless `APPLY=true`).
