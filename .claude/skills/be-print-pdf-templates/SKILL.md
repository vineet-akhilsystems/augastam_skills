---
name: be-print-pdf-templates
description: Use when a backend printout or PDF is wrong, blank or missing data, when a print format/report format option ("flag at printout configuration") is added, when a new template token or section style is needed, or when the prescription PDF, WhatsApp prescription or generate-pdf-from-html fails (REPORT_BUILDER, PdfService, [Webpart] / {field} tokens, Puppeteer).
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Printing and PDF templates

## Pieces

| Piece | Where |
|---|---|
| Format documents (`REPORT_BUILDER`, HTML per tenant) | `src/report-builder/report-builder.controller.ts`, base `configuration-service/report-builder` |
| Engine | `src/functions/PdfService.ts` (~6.9k lines): `generateFormattedContent(...)` -> `[header, content, footer]`; `generatePDFFromHTML({ headerHTML, contentHTML, footerHTML, sharedStyles, watermarkURL, layoutConfig, adaptivePageBreak, ... })`; `generatePdf(html)` (simple) |
| Prescription PDF | `EmrDataService.generatePDF` (`GET patient-service/emr/generate-prescription/:tenant_id`); v1 copy in `src/emr/emr.controller.ts` (~14311). Also used by `sendWhatsappNotification` and by a `save_status: 'Z'` save (`be-emr-data-model`) |
| Raw HTML -> PDF | `SubEmrService.generatePdfFromHtml` (`POST patient-service/emr/generate-pdf-from-html/:tenant_id`) |

Find callers: `grep -rn "pdfService\." src` (only `emr-data.service.ts`, `emr.controller.ts`, `sub-emr.service.ts` today; other modules inject `PdfService` without calling it). Frontend side: `fe-prescription-printout`.

## Format selection (`generatePDF`)

With `report_name`: unescaped, case-insensitive regex on `report_name`. Else: formats for the visit provider plus `provider` null/`All`, filtered by facility and the provider's first specialization (`specialization.label`), excluding word-processor formats; de-duplicated by `report_id`, `default: true` first. `get-provider-report` (frontend) filters by `provider.value`, `facility.value` (formats without `facility` match all), excludes `isWordprocessorFormat`; word-processor formats come from `get-WordProcessor-report`.

## Adding a format option

1. `PUT new-report` (`createNewReport`) builds the document **field by field**: add `myOption: reportData?.myOption ?? false`. Saved today: `provider`, `default`, `isWordprocessorFormat`, `specialization`, `report_data`, `report_name`, `report_type`, `customMargin`, `generic`, `brand_name`, `shouldDisplayPrefill`, `compactSpacing`, `isAnnotationEnabled`, `isPrescriptionCapital`. `facility` is **not** saved on create (only via update).
2. `PUT update-report/:tenant_id/:report_id` copies every body key except `tenant_id`, `report_id`, `isDeleted`; it forces `compactSpacing` to `false` when the key is absent - do the same for a boolean that must not survive a partial update.
3. Decide who reads it. `PdfService` reads only `selectedReportFormat.generic`; `isPrescriptionCapital`, `isAnnotationEnabled`, `compactSpacing`, `shouldDisplayPrefill` have no backend reader (frontend only). Grep before adding backend rendering.

## Template syntax (`generateFormattedContent`)

`[...]` placeholders are resolved by the inner `prescriptionWebpart` resolver; webpart type decides the renderer:

| Token / webpart | Renderer |
|---|---|
| `[Name]` grid / single entry | `handleMultiEntryWebpart` / `handleSingleEntryWebpart` |
| `isCrossTab`, `isOpticalMotility`, `isExamination`, `isBiometry` | `handleCrossTabWebpart`, `handleOcularMotility`, `handleExaminationWebpart`, `handleBiometryWebpart` |
| `isTemplate` | inserts `allPatientData["<Name>**template"]` |
| `[NT-Name]` | note style (`handleNTMultiEntryWebpart` / `handleNTSingleEntryWebpart`) |
| `[CS-Name]` | comma-separated (`handleCS*`: values joined " - ", rows ", ") |
| `[NB-Name]` | no-border table |
| `[Name@SRNO]` | grid with serial numbers |
| `[Name@MI]` | illustration images (`image_url` list) |
| `---HeaderEnd---` | splits header from body |
| `{prop}` | patient data, then appointment data, then `{x.key}` from `userData` (role != Doctor) or `doctorData` |
| `{age}`, `{Optometrist}` | age from `DOB`; first `assignment_history_logs` entry with role Optometrist |
| `{user.key}` | the user requesting the PDF (`requestingUserData`), never the visit doctor |
| `#signature#` | doctor signature image (`signatureData`) |
| `-HOSPITAL_IMAGE_UPLOAD-`, `-HOSPITAL_LOGO_UPLOAD-`, `-HOSPITAL_ADDRESS_UPLOAD-` | **hard-coded stock image URLs** in `PdfService`, not tenant assets; `String.replace` so only the first occurrence |

Unknown `[...]` returns `''`. After substitution only `\n` -> `<br />` (body). Date-type fields go through `formatDate` (`DD/MM/YYYY`, plus time when the value has `T`). The returned footer is just `<footer class='footer'>`.

Field print control (webpart `fields[].attributes`): `printout.shouldNotPrint`, `separateRow`, `hideName`, `merge`; headers/names via `getWebpartHeader` / `getCustomName`; `scopingFilter` hides out-of-scope fields.

## Adding a section style

1. Add a prefix/suffix branch in `prescriptionWebpart` next to `NT-`/`CS-`/`NB-`/`@SRNO`, or a webpart-flag branch next to `isCrossTab`.
2. Implement `handleXxxWebpart({ webpartData, allPatientData, getWebpartHeader, ... })` returning HTML; reuse `buildTable` (`isNoBorder`, `isSerialized`, `generic`), `buildString`, `formatDate`.
3. Respect `shouldNotPrint`, `separateRow`, `hideName`.
4. Port to the v1 caller if the change is in caller code (`emr.controller.ts`).
5. No PDF tests: generate a real tenant format locally and open the file.

## Gotchas

- **Header and body are separate replacers.** Content before `---HeaderEnd---` and after it go through different code in `generateFormattedContent`, with different token sets (`{age}`, `{Optometrist}` ...). A token that prints in the body may be blank in the header: add new tokens to both, and to the frontend copy (`fe-prescription-printout`).
- **Data depends on who prints.** `getPrescriptionData` (`src/emr/emr-data/emr-data.service.ts`) takes one branch when the user is the visit's provider (or a nurse) and another for other assigned users; fields like `visit_date` / `assignment_history_logs` can be missing in the second. Test a print as both; the v1 copy in `emr.controller.ts` has the same split.

- The placeholder-stripping regex near the top of `generateFormattedContent` (~598) never matches (see `.claude/rules/backend-functions.md`); every `[Webpart]` is rendered. Fixing it changes printouts.
- Images: `generateImageUrl` (signed URLs) or base64 `fieldImages`; large images inflate PDFs.
- One shared Puppeteer browser; temp dirs cleaned on start and every 10 minutes (`cleanPuppeteerTempDirs`). Missing Chromium dependencies break only PDF routes.
