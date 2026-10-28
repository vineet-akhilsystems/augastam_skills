---
name: fe-call-api
description: Use when frontend (custom-form-builder) code needs to call a backend endpoint - adding a save/fetch/update/delete call, wiring a screen to a new API, or debugging a request that 401s, hits the wrong environment, or is missing tenant_id/user_id/facility.
---

# Call a backend API from the frontend

## What is automatic (don't repeat it)

`src/utils/api.js` exports `axiosInstance` (default export). Its request interceptor already adds:
- `Authorization` (decrypted token from `sessionStorage`, no `Bearer`)
- query params `user_id` and `facility` (JSON of all facilities); the backend `JwtMiddleware` requires both
- headers `x-facility-id`, `x-session-id`, `x-request-timestamp`, `x-authentication-mac` (HMAC with `REACT_APP_API_SECRET`)
- base URL `BASE_URL` from `src/envConfig/config.js` = `REACT_APP_<REACT_APP_NETWORK>_BASE_URL` (TEST/DEMO/UAT/PROD); `billing-service` calls may go to `REACT_APP_LOCAL_BILLING_URL`

**Always use `axiosInstance`.** Plain `axios` skips auth and HMAC and gets 401s.

## What you must add

`tenant_id` is NOT automatic. Put it in the path or body/params exactly where the backend route expects it, using `getTenantIdForAPI()` from `src/utils/utilities.js` (also `getUserIdForAPI`, `getFacilityIdForAPI`).

**Facility:** the facility the user picked in the header is `getFacilityIdForAPI()` (reads `selected_facility`, falls back to the first). `JSON.parse(sessionStorage.getItem("facility"))[0]` is just the first facility the user has, and many screens use it (e.g. `facilityId` in `pages/registration/RegistrationPreview.jsx`); never send it to a facility-scoped query. Symptom: empty results only when the user has switched facility.

## Where to put the call

| Code being changed | Put the API code |
|---|---|
| New page under `src/pages/<kebab-name>/` (current style) | `src/pages/<name>/api/index.js` or `api-hooks/index.js` |
| New module under `src/features/<x>/` | `src/features/<x>/api/` |
| Existing legacy screen that already imports from `src/utils/api.js` | add an exported function next to similar ones in `src/utils/api.js` (3k lines: append, don't reformat) |

## Pattern (`src/pages/package-master/api-hooks/index.js` style; `facility-tagging/api` passes `tenant_id` as a query param instead, because its backend route expects it there)

```js
import axiosInstance from "../../../utils/api";
import { getTenantIdForAPI } from "../../../utils/utilities";

const ROUTES = {
	// house style: no leading slash (axios joins it to BASE_URL)
	SAVE_BLOOD_DONOR: "patient-service/patient-registration/blood-donor/replace_tenant_id",
};

export const saveBloodDonorFlag = async (registrationId, isBloodDonor) => {
	const url = ROUTES.SAVE_BLOOD_DONOR.replace("replace_tenant_id", getTenantIdForAPI());
	const res = await axiosInstance.post(url, { registration_id: registrationId, is_blood_donor: isBloodDonor });
	// Backend answers HTTP 200 with the real status in the body.
	if (res?.data?.statusCode && res.data.statusCode >= 400) throw new Error(res.data.message);
	return res?.data?.data;
};
```

For data a component loads on mount, follow the hook shape in `package-master/api-hooks` (`loading`/`data`/`error` state, `useCallback` fetcher, `enabled` option, `refetch`).

## Response handling

- The backend mostly returns `{ statusCode, message, data }` with HTTP 200; failures can arrive as 200 with `statusCode >= 400`. Check the body, not just the HTTP status.
- Some older endpoints use `code` or `status` instead of `statusCode`; read the backend handler to see which.
- Show the user a message with `react-toastify` (`toast.success` / `toast.error`), as nearby code does.
- 401 handling is global (session-expired redirect); don't add per-call 401 logic.

## Confirm the contract in the backend

Find the route before wiring it: use the `be-api-change` skill, or grep the path segment under `akhil_systems_backend/src`. Check method, where `tenant_id` goes, body field names, response shape, and that the route is bound to `JwtMiddleware` (otherwise it is public).

## Common mistakes

| Mistake | Result |
|---|---|
| `import axios from "axios"` | 401 / HMAC rejected |
| Forgetting `tenant_id` | backend reads the default control DB or 400s |
| `facility[0]` from sessionStorage as the facility | queries the wrong facility; empty results after switching facility |
| Treating HTTP 200 as success | silent failures shown as "saved" |
| Hard-coding a base URL | breaks every other environment |
