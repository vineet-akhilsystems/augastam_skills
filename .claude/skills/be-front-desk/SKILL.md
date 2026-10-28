---
name: be-front-desk
description: Use when building or fixing front-desk backend flows - patient registration/autogenerate, UHID or registration number format and sequence, duplicate patient checks, phone/VIP masking, pre-registration, doctor slots, booking, rescheduling, drag-drop, recurring slots, follow-up (free/paid), online or mobile booking, registration/consultation fee, wrong price, tariffs, payers, discounts, plans or packages.
---

> Backend skill (`akhil_systems_backend`). Paths below are relative to `akhil_systems_backend/`; run its commands inside that folder (`cd akhil_systems_backend && ...`, or `git -C akhil_systems_backend ...`).

# Front desk: registration, appointments, billing masters

## Code map

| Area | Code | Base |
|---|---|---|
| Registration | `src/patient-registration/patient-registration.controller.ts` (7k lines, inline); `patient-registrationV2.controller.ts` (`/v3`); `patient-notes.util.ts` | `patient-service/patient-registration` |
| Public pre-registration | `src/pre-registration/pre-registration.controller.ts` (`PreRegSecureMiddleware`) | `patient-service/pre-registration` |
| Staff scheduling/booking | `src/appointment/appointment.controller.ts` (8.6k lines) | `patient-service/appointment` |
| Public online booking | `src/online-appointment/online-appointment.controller.ts` (`SecureMiddleware`/`AppointmentMiddleware`, `EncryptionInterceptor`) | `patient-service/online-appointment` |
| Patient mobile app | `src/mobile-patient/appoinment.controller.ts` | `patient-service/mobile-app` |
| Doctor availability | `src/employee/employee.controller.ts` (`get-data-of-employee`, `get-employee-for-day`) | `tenant-service/employee` |
| Masters | `src/tariff`, `src/payer`, `src/discount`, `src/plan`, `src/service` | `tenant-service/<name>` |
| Packages | `src/package-configuration` (`PACKAGE_CONFIGURATION`, class-validator DTOs) | `configuration-service/package` |
| Billing worklist | `src/billing/billingList.controller.ts` (`billingList`, `get-patient-services-WorkList`, `update-service`); older `billing.controller.ts` | `billing-service/billing`, `patient-service/billing` |

## Creating a patient (`POST autogenerate`)

Records go to `<db_obj_name uppercased>_DB` (`PATIENT_REGISTRATION_DB` for `patient_registration`). `autogenerate123` is a dead leftover; `v2/autogenerate` is a separate copy.

1. No `autoGenerate` config -> `registration_id = temp_registration_number || uuid` (this branch also writes `facility_id: requestBody.tenant_id`).
2. With config -> number from `fetchSequenceDataTransaction`, stored as both `registration_id` and `properties[autoGenerateItem.fieldName]`.
3. `validatePatientRegistrationUniqueness` (only when `db_obj_name === 'patient_registration'`): 400 unless first/last name, DOB, gender, mobile present; rejects an exact match on lower-cased first+last(+middle) name, DOB, gender and digits of `properties.patient_phone`. Runs **after** the counter was incremented, so rejected attempts leave gaps.
4. Insert; legacy trail row written straight to `TRAIL_TABLE`.
5. Temp uploads: `moveFilesInS3(registration/temp/<uuid> -> registration/<number>)` (AWS only, ignores tenant `cloudProvider`) + inline `replaceUUIDInImagePaths`.
6. Fee: `calculateRegistrationFee` -> `PATIENT_PENDING_REQUEST` (`isRegistrationFee: true`, `category: "REGISTRATION"`, claim/invoice `pending`).
7. Task engine step `0001` (`reference_id: registration_id`, `buildPatientReferenceMeta`), fire-and-forget. Only `autogenerate` fires it - not `v2/autogenerate`, pre-registration or online booking.

`registrationCreatedOn(registration_date)`: a valid past `YYYY-MM-DD` (bulk import) becomes `created_on`, else now.

### Numbering

| | Atomic | Where |
|---|---|---|
| `SEQUENCE` + `$inc` upsert (`newfindOneAndUpdate`), 20 retries on E11000 | yes | `fetchSequenceDataTransaction` - 3 copies: patient-registration, pre-registration, online-appointment |
| `MongoDBService.generateAutogenerateNumber` (`AUTOGENERATE_SCHEMA`) | no | admission/booking/doctor-transfer numbers (ATD) |

- Sequence filter: `tenant_id`, `db_obj_name`, `facility_id` (`'all'` when `autoGenerateItem.facilityId` is `all`, else the request facility), plus `dbPropertiesKey/Value` when set. A find-then-create pre-step before it is not atomic and always uses the request facility.
- Format (`generateRegistrationNumber`): `prefix` + counter (zero-padded to `digitLimit` if `leadingZero`) + `suffix`, + `DDMMYYYY` when reset is `dy`. Over `10^digitLimit - 1` -> "Registration max limit reached".
- The live path never resets the counter (year/financial-year reset only in `autogenerate123`).

## Duplicates, search, masking

- Configurable rules (advisory, while typing): `save-patient-duplicate-check`, `get-Duplicate-Patient-saved-rules`, `get-Duplicate-Rule-Configuration`, `get-Duplicate-Patient-Rule-fields`, `search-duplicate-patients` (`PATIENT_DUPLICATE_CHECK_MASTER` / `_RULES`). The hard block is step 3 above.
- Search: `search-patient/:field_name?`, `POST magic-search/:tenant_id`. Escape user text; `generateFuzzyRegex` in `appointment.controller.ts` escapes before building.
- Masking (in the registration controller): `getRoleMaskingPermission` (admin, or `ROLE_PERMISSION.data[].isMaskingDataVisible` for the current `role_id`); `applyPatientMasking` masks phone-like columns (`getPhoneLikeColumnNames`: workflow field name contains mobile/phone) with `MaskingService.maskPhoneNumber` when tenant `phone_masking_enabled` (`phone_masking_visible_digits`, default 4) and drops `full_name` for `vip`. Applied only in `GET details/:tenant_id` and `POST get-all-patient-details/:tenant_id`.
- `PUT update-details` restores originals when masked values come back (`/^x+\d+$/i` phones, names starting `******` for VIP). Keep this when adding editable fields.
- Notes: `patient_notes.{messages,preferences,alerts,blocks}` on the registration (`patient-notes.util.ts`).

## Pre-registration

Body `{ encryptedPayload }`, headers `x-api-token`, `x-encryption-iv`, key `ENCRYPTION_KEY` (`src/middlewares/prereg-secure.middleware.ts`). Writes `<db_obj_name>_DB` (`PATIENT_REGISTRATION_PRE_DB`) and pending requests with its own copies of the sequence and fee helpers; proxies read-only builder data (webpart, lookup, workflow, search builder); `get-pre-registration-url`.

## Appointments

Data: `EMPLOYEE_SETUP` (schedule, `follow_up[0]`), `PROVIDER_APPOINTMENT_DETAILS` (slot sets per provider/date/facility, built on demand by `createSlots`), `APPOINTMENT_BOOKING_SLOTS` (bookings), `RECURRENCE_RULES`.

### Booking document (`APPOINTMENT_BOOKING_SLOTS`)

One document per **slot**, not per patient; overbooking pushes more patients into the same document.

| Field | Shape |
|---|---|
| `appointment_date` / `appointment_time` | strings, `"YYYY-MM-DD"` / `"hh:mm A"` (`"08:40 PM"`). Compare dates as strings; parse times yourself (see below) |
| `facility_id`, `facility_name`, `provider_id`, `provider_name`, `specialization`, `tenant_id` | slot level |
| `existing_patient[]` | registered patients: `patient_id` = UHID |
| `new_patient[]` | unregistered / pre-registered: `patient_id: "0"`, identified **only by `mobile` + `patient_name`** |
| per patient | `appointment_id`, `patient_status`, `mobile`, `patient_name`, `visit_type`, `registration_status` |

- **Status lives on each patient** (`patient_status`), not the slot: `Confirmed`, `Unconfirmed`, `Checked In`, `No Show`. `Cancelled` splices the patient out of the slot (and deletes the slot when it was the last one), so a cancelled booking is not a status you can query.
- "Upcoming", "active" or "pending" is a business rule: list these exact values and confirm with the user before filtering (e.g. `Checked In` later today is still upcoming for the front desk).
- Query a patient's bookings: `$concatArrays` both arrays (each may be missing: `$ifNull`), `$unwind`, then match. Reference: `src/appointment/upcoming-appointments.util.ts` (`POST upcoming-appointments/:tenant_id`, the registration-screen popup).
- **Mobile formats vary** (`"+91 98765 43210"`, `"98765-43210"`, numbers). Match on the last 10 digits with non-digits allowed between them (`$regexMatch` on `$convert` to string), never a raw `$regex` suffix.
- **Times:** in strict mode moment's `hh` rejects `"9:00 AM"` and `h` rejects `"09:00 AM"`; use `toTime24` from the util above rather than strict multi-format parsing.
- "Now" is the user's clock: take it from the client (`current_date_time`), the server may run in another timezone.

Staff routes: `upcoming-appointments/:tenant_id` (a patient's future bookings at a facility), `generate-slot`, `generate-monthly-slot`, `copy-appointment-slot`, `save-appointment-slot` (book), `change-appointment-status`, `edit-slot` (reschedule), `drag-drop`, `check-conflict-slots`, `recurring-dates`, `save-/edit-recurring-slots`, `get-recurring-rule`, `check-followup`, `get-followup-date`, `delayed-appointment`, `convert-new-patient`.

Booking (`save-appointment-slot`) side effects: `CheckOverBookingForProvider`; Kafka `produceAppointmentData` when `tenantCheck.isAppointment_Producer` (`be-external-io`); step `0003` (`APPOINTMENT_STEP_CODE`). Reschedule/drag-drop/status changes also produce to Kafka.

Follow-up: staff `check-followup` (`getVisitType`) resolves visit type from the "visit type" reference lookup + `SERVICES_SETUP`; the `follow_up[0]` rule logic (`free_followup_visit`, `paid_followup_visits`, `free_followup_visit_days`, `paid_followup_days_limit`) is commented out there but live in online-appointment `check-followup`.

Parallel copies: `createSlots`, `isSecondWeek` / `isAlternativeDay` / `isAlternativeDayOfWeek` in appointment and online-appointment controllers.

## Prices and fees

`POST tenant-service/tariff/get-service-amount/:tenant_id/:tariff_id/:service_id` (`getServiceAmount`), most specific wins:
1. `?isBillingCategory=true`: `TARIFF_BILLING_CATEGORY` exact `billing_category_name`, then `null`/`"All"`.
2. Else `TARIFF_SPECIALIZATION_PROVIDER`: spec+provider -> provider + any spec -> spec + any provider -> any/any (`null`, `"All"`, `""`).
3. Fallback `TARIFF_SERVICES`. No match returns nothing (no `statusCode`). `isSpecProvider` query is parsed but unused.

Fee helpers do **not** call that route; each copy re-implements resolution in `getAmountOfService` (billing-category and spec/provider priority, tariffs filtered by `effective_from_date`, plan first):

| Helper | Copies |
|---|---|
| `calculateRegistrationFee`, `getAmountOfService` | patient-registration, pre-registration, appointment, `emr/patient-visit/patient-visit.service.ts`, `emr/emr.controller.ts` |
| `checkRegistrationFeeApplicable` | same five |
| `getVisitTypeWiseService`, `getServiceDetails` (consultation) | patient-visit.service, emr.controller (+ `getServiceDetails` in appointment) |

Registration fee path: facility `payer_category` (`FACILITY_MASTER`) -> patient `<payer_category>_name` or `payer_name` -> `PAYER_MASTER.payer_tagging_data.tariff_tagging` (by facility) -> service whose `service_identification` is the `RF` value of the "Service Identification" lookup (`SERVICES_SETUP`); skipped when a pending (`claim_status: pending`) registration request exists or `registration_valid_upto` is still valid. `checkRegistrationFeeApplicable` returns `tenantCheck.is_registration_fee_applicable || true` (always true) when facility config is missing.

Other masters: payers (`get-payer-tariff/:tenant_id/:payer_id?`), discounts (`list-discount`, `Discount-scheme`, `Discount-get`, `Discount-Definition`), plans and services (Excel import/export from `FORM_CONFIG_SCHEMA` columns), `FACILITY_TAGGING` restricts services/payers per facility.

## Rules

- Money is stored as numbers and strings; parse before arithmetic and round with tenant `tariff_decimal_point`. Resolve prices server-side.
- A fee or price fix usually needs all five copies; grep the method name.
- Master edits need an audit record (`@Audit`); keep Excel column lists in sync with new fields.
- `CheckOverBookingForProvider`'s `multiple_booking` condition has an operator-precedence bug (the `patient_id` checks never apply); test both tenant settings when touching it.

Related: `fe-patient-registration`, `be-tenant-data-access`, `be-task-engine`.
