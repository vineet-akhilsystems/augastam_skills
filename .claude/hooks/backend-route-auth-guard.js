#!/usr/bin/env node
// PostToolUse (Edit|Write): after a *.module.ts or *controller.ts under src/ changes, re-run
// scripts/check-route-auth.js for that folder and tell Claude about routes that have no auth
// middleware bound and are NOT in the accepted baseline (route-auth-baseline.txt).
//
// Refresh the baseline after reviewing the current list on purpose:
//   node .claude/hooks/backend-route-auth-guard.js --write-baseline   (from the workspace folder)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Workspace copy: the backend repo is ../../akhil_systems_backend from this file.
const projectDir = path.resolve(__dirname, '..', '..', 'akhil_systems_backend');
const checker = path.join(__dirname, '..', 'tools', 'check-route-auth.js');   // workspace tool: works on every backend branch
const baselineFile = path.join(__dirname, 'backend-route-auth-baseline.txt');

// "VERB   /path   file:line" -> "VERB /path" (line numbers move, so they are not part of the key).
const routeKey = (line) => {
  const [verb, route] = line.trim().split(/\s+/);
  return `${verb} ${route}`;
};
const unboundRoutes = (args) =>
  execFileSync(process.execPath, [checker, ...args], { cwd: projectDir, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((l) => /^(GET|POST|PUT|PATCH|DELETE)\s/.test(l));

if (process.argv.includes('--write-baseline')) {
  const keys = [...new Set(unboundRoutes([]).map(routeKey))].sort();
  fs.writeFileSync(baselineFile, keys.join('\n') + '\n');
  console.log(`Wrote ${keys.length} accepted routes to ${baselineFile}`);
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const filePath = input?.tool_input?.file_path || input?.tool_response?.filePath || '';
  const rel = path.relative(projectDir, path.resolve(projectDir, filePath)).split(path.sep).join('/');
  if (!rel.startsWith('src/') || !/(\.module|controller)\.ts$/.test(rel)) process.exit(0);

  const baseline = new Set(fs.existsSync(baselineFile)
    ? fs.readFileSync(baselineFile, 'utf8').split(/\r?\n/).filter(Boolean) : []);
  const fresh = unboundRoutes([path.posix.dirname(rel)]).filter((l) => !baseline.has(routeKey(l)));
  if (!fresh.length) process.exit(0);

  const list = fresh.slice(0, 25).map((l) => '  ' + l.trim().replace(/\s{2,}/g, '  ')).join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `Route auth check: these routes in ${path.posix.dirname(rel)} have no auth middleware bound in the module's ` +
        `configure() and are not in the accepted baseline:\n${list}\n` +
        'Add each to the module\'s JwtMiddleware/TenantMiddleware route list (exact path + RequestMethod), ' +
        'unless the route is meant to be public — then say so to the user.',
    },
  }));
});
