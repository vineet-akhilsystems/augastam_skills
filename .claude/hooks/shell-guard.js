#!/usr/bin/env node
// PreToolUse (Bash|PowerShell) for the Augastam EMR workspace (backend + frontend repos).
// The backend's own hooks only load when Claude starts inside akhil_systems_backend, so this
// covers every workspace repo when Claude starts from the workspace folder.
//   - force push                               -> deny
//   - any command touching .env / .env.*       -> deny (permission rules only cover Read/Edit tools)
//   - push to an environment/integration branch -> ask (these branches deploy or are shared)
//   - any other git push                       -> ask
//   - commands that throw away local work      -> ask (reset --hard, clean -f, checkout/restore ., stash drop/clear, branch -D)
//   - rebase                                   -> ask (all workspace repos use merge-based history)
//   - --apply / APPLY=true / BYPASS_AUTH=true  -> ask (backend data scripts and auth bypass)

const ENV_FILE = /(^|[\s'"`/\\=<>|;(])\.env(\.[\w.-]+)?(?=$|[\s'"`|;)>&])/;

// "git <sub>" allowing global options before the subcommand, e.g. git -C "Augastam EMR/x" -c k=v push.
const GIT = String.raw`\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--?[\w-]+(?:=\S+)?)*\s+`;
const git = (sub, rest = '') => new RegExp(GIT + sub + rest);

// Branches that deploy somewhere or that everyone merges into. Client builds look like
// ankura-production-build, bharati-uat-environment, care-uat-environment, eye7-prod.
const PROTECTED = /^(development|main|master|test-environment|demo-environment|uat-environment|production-build|dev-deploy|[\w-]*-production-build|[\w-]*-uat-environment|[\w-]*-prod)$/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const cmd = String(input?.tool_input?.command || '');
  if (!cmd) process.exit(0);

  const decide = (permissionDecision, permissionDecisionReason) => {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
    process.exit(0);
  };

  if (git('push', String.raw`\b[^\n]*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)`).test(cmd)) {
    decide('deny', 'Force-pushing is not allowed from Claude in these repos.');
  }
  if (ENV_FILE.test(cmd)) {
    decide('deny', '.env files hold live credentials and are not read or written through Claude. Ask the user for the specific variable name/purpose instead.');
  }

  const push = cmd.match(git('push', String.raw`\b([^\n;&|]*)`));
  if (push) {
    // Last refspec token decides the target: "origin feat/x", "origin HEAD:development", "origin x:test-environment".
    const args = push[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
    const target = (args[args.length - 1] || '').split(':').pop();
    if (args.length >= 2 && PROTECTED.test(target)) {
      decide('ask', `Pushing directly to '${target}', a shared/environment branch. The team normally reaches it through a PR; pushing test-environment on the backend deploys to the TEST server.`);
    }
    decide('ask', 'Pushing to the shared GitHub repo.');
  }

  if (git('reset', String.raw`\b[^\n]*--hard\b`).test(cmd)) decide('ask', 'git reset --hard discards uncommitted changes.');
  if (git('clean', String.raw`\b[^\n]*\s-\w*f`).test(cmd)) decide('ask', 'git clean -f deletes untracked files.');
  if (git('(checkout|restore)', String.raw`\b[^\n]*\s(--\s+)?\.(\s|$)`).test(cmd)) decide('ask', 'This discards local changes to tracked files.');
  if (git('stash', String.raw`\s+(drop|clear)\b`).test(cmd)) decide('ask', 'This deletes stashed work.');
  if (git('branch', String.raw`\b[^\n]*\s-D\b`).test(cmd)) decide('ask', 'git branch -D deletes a branch even if it is not merged.');
  if (git('rebase', String.raw`\b`).test(cmd)) decide('ask', 'All workspace repos use merge-based history; rebasing a pushed/shared branch rewrites it for everyone.');

  if (/(^|\s)--apply\b/.test(cmd)) decide('ask', 'This runs a data script with --apply, which writes to tenant databases. Confirm the target NETWORK/tenant first.');
  if (/\bAPPLY=true\b/.test(cmd)) decide('ask', 'APPLY=true makes the index script build indexes on the connected database.');
  if (/\bBYPASS_AUTH=true\b/.test(cmd)) decide('ask', 'BYPASS_AUTH=true disables every authentication check. Only for a local server.');
  process.exit(0);
});
