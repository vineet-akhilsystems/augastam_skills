---
name: fe-prescription-printout
description: Use when changing or debugging the EMR prescription printout in the frontend - "printout", "prescription print", "print format/configuration", "report format", dosage or instruction text on print, signature, page numbers, margins, pagination, Hindi/Arabic on print, watermark, single-page prescription, or the generated PDF/preview.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Prescription printout

## How it works

| Step | Where |
|---|---|
| Open | `prescription/PrescriptionModal.jsx` (~2.8k lines), opened from `EMR Flow/PatientHeader.jsx` and `components/visitlist/TableBody.jsx` |
| Formats list | `getProviderReport` (`utils/api.js`): `PUT configuration-service/report-builder/get-provider-report/{tenant}?provider=` with `{facility, specialization}`; keeps only `report_type === "EMR"`. **Cached in CacheStorage `report-formats` keyed by doctor id** |
| Patient data | `preparePrintData`: `GET patient-service/emr/prescription-data/{tenant}?registration_id&patient_visit_id&isNurse&language_value` -> `allPatientData` (keyed by webpart name / column) |
| Templates | `fetchTemplateData`: `GET patient-service/emr-template/template-prescription-data/{tenant}` |
| Webparts with data | `getPrintWebarts`: `GET patient-service/emr/get-prescription-webpart-name/{tenant}?patient_visit_id=` |
| Render | `generateFormattedContent` (useCallback) turns format HTML into final HTML |
| PDF | `generatePrintHTML` (`utils/api.js`): `POST patient-service/emr/generate-pdf-from-html/{tenant}` `{headerHTML, contentHTML, footerHTML, sharedStyles, watermarkURL, layoutConfig, headerHtmlReplacementContent}` -> base64; single-page formats skip it and use `generatePdfUrl` (`prescription/CreatePdfUrl.js`, html2canvas + jsPDF in the browser) |
| Preview / save | `components/common/PDFPreview.jsx`; "save" uploads via `uploadToS3` + `updateVisitPreSignedUrl` (`utils/aws.js`) |

Format object (mapped in the `getProviderReport` effect, ~line 1683): `data` (= `report_data`), `headerData`, `footerData`, `headerFirstPageData`, `isSinglePagePrescription`, `customMargin`, `generic`, `brand`, `watermark_image_key`, `page_properties`, `compactSpacing`, `isPrescriptionCapital`, `page_number_config`. Brand/generic lookup: Redux `tenantSetup.brandGenericMapping`.

### Format tokens (parsed in `generateFormattedContent`)

| Token | Meaning |
|---|---|
| `[Webpart Name]` | branch by webpart flags: `isCrossTab`, `isOpticalMotility`, `isTemplate`, `isGrid` -> `handleMultiEntryWebpart`, `isExamination`, `isBiometry`, else `handleSingleEntryWebpart` |
| `[NT-Name]` | no-title variant (`handleNT*`) |
| `[CS-Name]` | comma-separated (`handleCS*`) |
| `[NB-Name]` | no border |
| `[Name@SRNO]` / `[Name@MI]` | serial numbers (grid only) / medical illustration images |
| `[Name@top,left...]` | fixed position, collected into `webpartHtmlArray` for single-page layouts |
| `{column}`, `{employee.x}`, `{currentdate}`, `{Optometrist}` | placeholders from patient/appointment/employee data |
| `#signature#`, `#signature@top,left#` | doctor signature, only when visit `saveStatus === "S"` |
| `---HeaderEnd---` | splits header from body |

Renderers: `prescription/allPrintTypes.js` (`handleSingleEntryWebpart`, `handleSingleEntryKeyValue`, `handleMultiEntryWebpart`, NT/CS variants, cross-tab, examination, biometry, ocular motility). Table/string builders and dosage text: `prescription/utils.js` (`buildTable`, `buildTableWithAutoSplit`, `buildString`, `resolvePrintedInstruction` -> `fillEmptyInstruction` -> `filterWhenByDose`, `formatVariableDoses`, `SLOT_PHRASES` en/hi/ar, `printStyles`). Fields with `attributes.printout.shouldNotPrint` are skipped (set in `components/builder/PrintoutFormattingOptions.jsx`). Webparts with `isMandatoryInPrintout` (set in `pages/datagroup/NewWebpart.jsx`) can't be unticked in the modal (`mandatoryWebpartsSet`).

## Add a print-format flag (files in order)

1. `reportBuilder/TextEditor.jsx` (route `/text-editor/:id?`, list at `/report-list`): `useState`, load from `get-report` (~line 330-375), add to **both** `reportBody` (new-report) and `updateBody` (update-report), add the checkbox (copy `compactSpacing`).
2. `PrescriptionModal.jsx`: map it in the `getProviderReport` `.map(...)`.
3. Use it: pass it into the renderer call(s) in `generateFormattedContent`, or read it from `selectedReportFormat` (multi-entry renderers already receive the whole object; `buildTableWithAutoSplit` reads `selectedReportFormat?.compactSpacing`). **Add it to the `useCallback` dependency array** (today only `selectedReportFormat?.generic` is listed, so brand/compactSpacing changes rely on other deps changing).
4. `allPrintTypes.js` / `utils.js` for the rendering; `onPrint` for PDF-level options (`layoutConfig`, `printStyles`); `SinglePagePrintout.jsx` (`resolvePrintData`, `buildPrintHtml`) if single-page formats need it.
5. If the backend must render it (page layout), coordinate with `be-print-pdf-templates`.

## Copies to change together

- `components/modals/SideTemplateModal.jsx` imports `handleSingleEntryKeyValue`, `populateTemplate`, `printStyles` and calls `generatePrintHTML`.
- `utils/registrationPrint.js` uses `printStyles`; `workflow/Preview/TaskPreview.jsx` uses `populateTemplate`.
- `components/summary/helperComponents/SummaryPrintModal.jsx` (discharge summary) has its own HTML build but the same `generatePrintHTML`.
- `formatVariableDoses` is duplicated in `components/modals/SidePreviousModal.jsx`.
- `generatePdfUrl` exists in both `CreatePdfUrl.js` (used) and `SinglePagePrintout.jsx`.

## Bug-prone spots

- **Header vs body tokens:** `generateFormattedContent` in `PrescriptionModal.jsx` replaces the part before `---HeaderEnd---` and the body in separate blocks with different token sets; a token (e.g. `{age}`) can work in the body but not the header. Add new tokens to both, and to the backend `PdfService` (`be-print-pdf-templates`).
- **Missing patient/visit fields on print** may be backend data, not rendering: `prescription-data` returns a different payload when the printing user isn't the visit's provider (see `be-print-pdf-templates`).
| Symptom | Look at |
|---|---|
| Section after a token vanishes (follow-up, referral) | malformed `{[NT-...]` in saved format; repaired by the `/\{\s*(?=\[)/` replace at the top of `generateFormattedContent`, but other `{` typos still swallow HTML up to the next `}` |
| Format/config change not visible | `report-formats` cache: cleared only by `TextEditor` save in *that* browser; others need logout/clear site data |
| Per-tenant dosage wording, "1 BEFORE DINNER" wrong | `filterWhenByDose` / `fillEmptyInstruction` in `utils.js`; keep en/hi/ar `SLOT_PHRASES` and `WHEN_SEPARATORS` in sync |
| Hindi text | `language_value` sent to `prescription-data`; `detectInstructionLang` picks by script |
| Blank screen | a date helper got a non-string (`formatDate` now guards); also `dd/mm/yyyy` rewrite regex runs over all output |
| Spacing / pagination | `compactSpacing`, `customMargin` (`printStyles`), `page_properties`, `page_number_config` (rendered server side) |
| Signature missing | visit not signed (`saveStatus !== "S"`), or doctor vs team provider (`team_provider_id`) |
| "Save to visit" fails off dev | `updateVisitPreSignedUrl` in `utils/aws.js` calls a hard-coded `https://...devtunnels.ms/` URL; fix to a relative path |

## Verify

- `npm start`, open a signed visit, Print -> pick each format; check preview and direct print, a grid medication webpart, `NT-`/`CS-`/`NB-` tokens, Hindi language, a single-page format.
- After editing a format in `/text-editor/:id`, clear site data (or the `report-formats` cache) before re-testing.
- No unit tests exist here; if you touch dosage helpers, add `prescription/utils.test.js` and run `npx react-scripts test --watchAll=false src/prescription`. Then `fe-pre-pr-check`.
