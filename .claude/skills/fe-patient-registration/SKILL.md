---
name: fe-patient-registration
description: Use when changing or debugging the frontend patient registration screen - "registration form", UHID/registration number, duplicate patient check, phone/mobile code/length, PIN code autofill, age-DOB behaviour, payer/sponsor fields, VIP/name masking, registration add-ons (worklist, insurance, notes, documents), or bulk registration import.
---

> Frontend skill (`custom-form-builder`). Paths below are relative to `custom-form-builder/src` unless they start with `custom-form-builder/`; run commands inside `custom-form-builder`.

# Patient registration

## How it works

- Routes `/registration` and `/registration/:workflowId/:uhrId` -> `pages/registration/RegistrationPreview.jsx` (~3.6k lines). Neither route is wrapped in `PrivateRoute`.
- `loadWorkflow` effect: `fetchWorkflowVersions(REGISTRATION_WORKFLOW_ID)` (`constants/workflow.js`), takes the last version if `published`, else the one before it; uses **stage 0, process 0 tasks** (plus tab webparts) and loads each webpart's fields with `fetchLatestWebpartFields`.
- Each webpart renders through `components/registration/RegistrationWebpartPreview.jsx` (~4.6k lines, **not** `components/WebpartPreview.jsx`) with field controls from `components/registration/builder/` (a diverging copy). `pages/registration/RegistrationInsuranceDetails.jsx` reuses it.
- State: `formValues` keyed by webpart id; the current/permanent address webparts are tracked in `addressWebpartIds`.

### How a patient gets onto the screen (hook new "on patient selected" behaviour into both)

| Entry | Code path |
|---|---|
| Header global search (`pages/registration/RegistrationSearchbar.jsx`), duplicate modal "view" | `navigate('/registration/<workflowId>/<uhr_id>')` -> `loadExistingRegistration` effect (`fetchPatientRegistrationDetails`, then `setRegistrationId(uhrId)`) |
| Pre-registration number box | `handlePreRegEnter` -> `getPreRegDataByID` -> `applyPatientDetailsToForm`; no UHID yet, identify by `patient_phone` + first/middle/last name |

- The load effect re-runs when `webpartFieldsMap`, `tasks` or `addressWebpartIds` change: guard one-shot side effects (popups, API calls) with a ref keyed on the patient, cleared in `handleNewClick` (see `checkUpcomingAppointments` / `upcomingCheckedKeyRef`).
- `facilityId` near the top of the component is `facility[0]` (first facility), not the selected one: use `getFacilityIdForAPI()` for facility-scoped calls (`fe-call-api`).

### Endpoints (`utils/api.js` unless noted)

| Action | Call |
|---|---|
| Create | `createPatientRegistration` -> `POST patient-service/patient-registration/autogenerate` `{db_obj_name: "patient_registration", properties, workflow_id, facility_id, autoGenerate, masking_fields, temp_registration_number, pre_registration_id, ...}`; returns the new registration id |
| Update | `updatePatientRegistration` -> `PUT patient-service/patient-registration/update-details` (asks for remarks first) |
| Load | `fetchPatientRegistrationDetails` -> `GET patient-service/patient-registration/details/{tenant}?dbObj=PATIENT_REGISTRATION&registration_id=&workflow_id=` |
| Duplicates | `POST patient-service/patient-registration/get-Duplicate-Rule-Configuration`, `POST .../search-duplicate-patients` (rules set in `/PatientDuplicateCheckMaster`) |
| PIN | `api/pincodeLookup.js`: `GET configuration-service/reference-lookup/pincode-lookup/{tenant}?pin=` or `?state&district&area` |

Payload = `buildCombinedProperties()`: all non-address webparts' values merged **flat by `columnName`**, plus `current_address` / `permanent_address` objects, `consent_*`, additional-detail flags (`vip`, `name_masking`, ...), `is_whatsapp_number`, `mark_current_address_as_permanent`, `insurance_details: {plans}`. `handleSave` then adds `mobile_code`, `full_name`, `_autogenerateMatch`, duplicate-override fields. Field `columnName` is the contract with the backend (`be-front-desk`); renaming one in the webpart breaks save/search.

### Field behaviours (where they live)

| Behaviour | Code |
|---|---|
| Payer type change clears Payer/Sponsor | `payerFields.js` + `applyChange` branch in `RegistrationWebpartPreview` |
| Phone rule by country, validated on blur | `phoneRules.js` (`getPhoneRule`, `phoneRuleForField`, `validatePhone`) in `handleInputBlur`; **re-validated in `handleSave`** and normalised with `normalizePhone` |
| Country -> mobile code | `mobileCode.js` (`buildCountryCodeMap`, `getMobileCodeForCountry`, default `+91`) |
| PIN autofill / mismatch | `builder/PinCodeField.jsx` + pure `pincodeAutofill.js` (`planAutofill`, `addressMismatchesPin`, `reverseLookupAttempts`) |
| Age -> DOB | effect around `calculateDOBfromAge` (`isCalculatingDOB` guard); age field is a formula field made editable in `builder/InputField.jsx` (`isAgeField`) |
| Duplicate check | live: debounced effect (`config.typingPause` seconds, key in `lastDuplicateKeyRef`) for new registrations only, skipped for VIP/masked; again in `checkDuplicatesBeforeSave` on create; result in `DuplicatePatientModal` |
| VIP name masking | `handleSave`: `first_name = "******" + last 4 of id` |

## Add a field behaviour (files in order)

1. Pure helper + `*.test.js` in `components/registration/` (style of `phoneRules.js`, `pincodeAutofill.js`).
2. Wire into `handleChange` / `applyChange` / `handleInputBlur` in `RegistrationWebpartPreview.jsx`.
3. Control UI in `components/registration/builder/<Control>.jsx` if needed.
4. Save-time check or transform in `handleSave` / `buildCombinedProperties` (`RegistrationPreview.jsx`) - blur-only checks are bypassed by paste/autofill.
5. Bulk import: `pages/registration/bulk/bulkRegistrationModel.js` (`validateRows`, `buildProperties`; has its own `dobFromAge`, `mobileDigits`) + its test.

## Add an add-on panel

Add `{id, label, icon}` to `ADDONS_BUTTONS` (`pages/registration/RegistrationAddonsSidebar.jsx`) -> add an `activeAddonItem.id === "<id>"` branch in the add-on renderer in `RegistrationPreview.jsx` (see `worklist`, `bulkRegistration`, `insuranceDetails`, `notes`, `patientDocuments`) -> label key in `locales/*/global.json` (labels go through `getSystemName`).

## Copies to change together

- Field controls: `components/registration/builder/` vs `components/builder/` vs `webparts/components/`. `components/builder/InputField.jsx` has ~180 differing lines from the registration copy, including fixes never ported; diff before "fixing" behaviour.
- Age/DOB and phone rules also exist in `bulkRegistrationModel.js`.
- Pre-registration (`/pre-registration`, `pages/pre-registration/`, `PRE_REGISTRATION_WORKFLOW_ID`) is a separate screen; a pre-registered patient is pulled in through `api/prereg` and sent as `pre_registration_id`. `createPatientRegistration` also has an `isPreRegistration` mode (`pre-registration/autogenerate`).

## Bug-prone spots

- **Save blocked by duplicate-check settings:** `checkDuplicatesBeforeSave` in `RegistrationPreview.jsx` refuses to save while the duplicate rule settings (`get-Duplicate-Rule-Configuration`) are still loading ("Duplicate-check settings are still loading..."). Registration must never be blocked by advisory duplicate settings; the hard uniqueness check is on the backend (`be-front-desk`).
| Symptom | Look at |
|---|---|
| Duplicate popup missing/repeated | `automaticCheck`/`newRegistration` config, `lastDuplicateKeyRef`, `duplicateOverrideRef` (suppresses checks after "Register as New") |
| DOB/age tab order or overwrite loop | `isCalculatingDOB` timing, formula fields re-sending values |
| Wrong mobile length for country | `getPhoneRule(dialCode)`, `hasCountryField`, address webpart country field |
| PIN fills wrong area / "not found" on network error | `fetchPincodeLocalities` returns `null` on failure vs `[]` not found |
| Masked name saved over real name | `firstNameIsMaskedMarker`, `loadedFullNameRef` |
| Form uses old fields | registration workflow's latest version not published |

## Verify

- `npm start` -> `/registration`: create with an existing patient's name/phone (duplicate popup), wrong-length phone, a PIN with several areas, type age then DOB, change payer type, VIP + masking, then reopen via `/registration/<workflowId>/<id>` and update. Try a bulk import file from the add-on.
- Tests: `npx react-scripts test --watchAll=false src/pages/registration src/components/registration`. Then `fe-pre-pr-check`.
