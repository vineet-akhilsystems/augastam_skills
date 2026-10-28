---
name: fe-pre-pr-check
description: Use when frontend (custom-form-builder) changes need checking before a commit, PR or merge - "check my frontend changes", "does the frontend build", "ready for PR", or when ship-feature runs checks for the frontend.
---

> Frontend skill (`custom-form-builder`). Run commands inside that folder.

# Frontend pre-PR check

Run against the current branch versus `development`. Report every step as pass / fail / not run (with the reason). List findings and ask; don't fix silently.

## 1. What changed

```bash
git fetch origin development
git diff --stat origin/development...HEAD; git status --short
```

## 2. Build

```bash
GENERATE_SOURCEMAP=false BUILD_PATH="$TEMP/cfb-build-check" npx react-scripts build
```

`npm run build` fails on Windows even from Git Bash (npm runs scripts via cmd.exe, and the script uses POSIX env syntax). Building into `$TEMP` keeps the repo's `build/` untouched. Several minutes; warnings are fine, errors fail.

| Build error | Cause | Fix (ask before running) |
|---|---|---|
| `Can't resolve 'ckeditor5-custom-build/build/ckeditor'` | `node_modules/ckeditor5-custom-build` is a symlink to `file:ckeditor5`; it breaks when the repo folder is moved | `npm install` (re-links it) |
| `Can't resolve '@akhilsystemspvtltd/augastam-shared-ui...'` or missing export | shared-ui install older than the `package.json` pin | `npm install` with `NODE_AUTH_TOKEN` set (GitHub Packages) |
| JavaScript heap out of memory | large bundle | prefix `NODE_OPTIONS=--max-old-space-size=8192` |
| `Module not found: Can't resolve '<package>'` for a package listed in `package.json` | install older than `package.json` (others added dependencies) | `npm install` (needs `NODE_AUTH_TOKEN`); list what's missing first with the command below |

```bash
node -e "const p=require('./package.json');const m=Object.keys(p.dependencies).filter(k=>{try{require.resolve(k+'/package.json',{paths:[process.cwd()]});return false}catch{return true}});console.log(m.join(', ')||'all installed')"
```

A build that fails for one of these reasons is an environment problem: report "not run (reason)" and don't claim the change compiles.

## 3. Tests

```bash
npx react-scripts test --watchAll=false --findRelatedTests <changed src files>
```

Only 18 test files exist; "no tests found" is normal. If the change has testable logic (utils, API mappers), offer to add a `*.test.js` next to it.

## 4. Diff review

Flag:
- `console.log` or commented-out code blocks added; plain `axios` instead of `axiosInstance` (`fe-call-api`)
- reformatting-only hunks (tabs/CRLF are the house format), especially in `ComponentRoute.js`, `App.jsx`, `utils/api.js`, `TablePreview.jsx`, `WebpartPreview.jsx`
- new route without `<PrivateRoute>`, or without a menu-entry note for the PR (`fe-add-page`)
- a fix in one copy of a duplicated control (`webparts/components`, `components/builder`, `components/registration/builder`) without checking the others
- user-facing text not going through `t(...)`
- `package.json` / `package-lock.json` changes the task doesn't explain
- changes to files mirrored from `augastam-ip-module` (`src/pages/reportBuilder`): run `npm run report-builder:check`

## 5. Summary

```
Build: pass | Tests: none related | Review: 1 finding (file:line, ...) | Not run: ...
```
