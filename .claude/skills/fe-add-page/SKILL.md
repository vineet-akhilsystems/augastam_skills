---
name: fe-add-page
description: Use when adding a new screen, page, setup/master screen or route to the frontend (custom-form-builder), or when a new page is not reachable, missing from the sidebar, or redirects to /home.
argument-hint: "<route path> <page name>"
---

# Add a page to the frontend

A page needs four things: the component, a route, a tab title, and a **menu entry assigned to roles** (data, not code). Missing the last one is why "the page redirects to /home".

Reference implementations: `/facility-tagging` (`src/pages/facility-tagging/`) for page + route; `src/pages/package-master/` for a CRUD master with `api-hooks`.

## 1. Component

New pages go in `src/pages/<kebab-case-name>/` (the style of package-master, service-master, facility-tagging):

```
src/pages/<name>/
  index.jsx          default export = the page
  api/index.js       API calls (fe-call-api skill)
  components/        page-only components
  css/               page styles
```

Reuse before writing: `src/workflow-ui` (WorkflowRenderer, `useWebpartSchema`, `page.module.css`) for webpart-driven pages; field controls in `src/webparts/components` (three diverging copies exist, also in `components/builder` and `components/registration/builder`; extend the one the neighbouring screens import). Text goes through `useTranslation()` with keys in `src/locales/en/global.json` under `system` (also add to `hi` and `ar` if you can).

Files use **tabs, width 4, CRLF** (`.prettierrc`, `.editorconfig`).

## 2. Route: `src/ComponentRoute.js`

One flat `<Routes>` list, static imports, no lazy loading. Add the import with the other page imports and the route **above** `<Route path="*" element={<NotFound />} />`:

```jsx
import BloodBank from "./pages/blood-bank";
...
<Route
	exact={true}
	path="/blood-bank"
	element={<PrivateRoute><BloodBank /></PrivateRoute>}
/>
```

Wrap in `<PrivateRoute>` unless the user says the page is public. Non-admins pass `PrivateRoute` only if a menu `redirect_value` matches the path (exact or prefix).

## 3. Tab title: `src/App.jsx` (optional)

Only ~50 of ~170 routes have one; add it for a top-level screen users bookmark or switch between.

Add a `case` to the `document.title` switch:

```jsx
case "/blood-bank":
	document.title = "Blood Bank | Augastam";
	break;
```

## 4. Menu entry (tell the user; it is configuration)

The sidebar is built from the backend (`configuration-service/menu/display-module/<tenant>` + role permissions). After deploying, someone must:
1. add a menu item in the Menu screen (`/menu`, `/menulist`) with `redirect_value` = the route path exactly (`/blood-bank`);
2. grant it to the roles that need it.

Permissions are cached in the browser (CacheStorage `role-permission-cache`, sessionStorage via redux-persist); after changing roles, log out and back in or clear site data.

## 5. Check

- `npm start` in `custom-form-builder`, open the route as an admin (admins skip the permission check), then as a non-admin after the menu entry exists.
- Run the frontend build from `ship-feature` before a PR.

## Common mistakes

| Mistake | Symptom |
|---|---|
| No menu entry / `redirect_value` differs from path | non-admins bounced to `/home` after ~5s |
| Route added after `path="*"` | page shows NotFound |
| Folder name with spaces or a new typo | painful imports; use kebab-case |
| Reformatting `ComponentRoute.js`/`App.jsx` | merge conflicts for everyone |
