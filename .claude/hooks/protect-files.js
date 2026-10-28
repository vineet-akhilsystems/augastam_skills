#!/usr/bin/env node
// PreToolUse (Edit|Write) for the Augastam EMR workspace: refuse writes to secrets and build output
// in either repo, and ask before touching the backend auth middlewares.

const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
// Rules apply to every repo folder in the workspace (<repo>/dist, <repo>/build, ...), so new repos are covered too.
const rules = [
  { test: (p) => /(^|\/)\.env(\.[^/]*)?$/.test(p), why: '.env files hold live credentials; edit them by hand.' },
  { test: (p) => /(^|\/)secrets\//.test(p) || /\.(key|crt|pem)$/.test(p), why: 'Keys and certificates are not edited through Claude.' },
  { test: (p) => /^[^/]+\/(dist|build)\//.test(p), why: 'build output; change the source and rebuild.' },
  { test: (p) => /(^|\/)node_modules\//.test(p), why: 'node_modules is installed code; change package.json or the source package instead.' },
];

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const filePath = input?.tool_input?.file_path || '';
  if (!filePath) process.exit(0);
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  const out = (permissionDecision, permissionDecisionReason) => {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
    process.exit(0);
  };
  // The backend auth middlewares were edited 100+ times in 3 months to toggle BYPASS_AUTH/HMAC for local testing.
  if (/^akhil_systems_backend\/src\/middlewares\/(jwt|windowserver)\.middleware\.ts$/.test(rel)) {
    out('ask', `${rel} guards most routes. For local testing set BYPASS_AUTH=true in .env instead of editing it; only change it for a real auth fix.`);
  }
  const hit = rules.find((r) => r.test(rel));
  if (hit) out('deny', `${rel}: ${hit.why}`);
  process.exit(0);
});
