#!/usr/bin/env node
// Static check: lists controller routes that no auth middleware is bound to.
//
// Auth here is bound per route inside each module's configure()
// (consumer.apply(JwtMiddleware).forRoutes({ path, method }, ...)), so a route left out of
// that list is public. This walks every *.module.ts, resolves its controllers' routes and
// checks them against the forRoutes() entries of auth middlewares.
//
//   node ../.claude/tools/check-route-auth.js                     # whole repo
//   node ../.claude/tools/check-route-auth.js src/emr             # only modules under a folder
//   node ../.claude/tools/check-route-auth.js src/emr/emr.module.ts
//   node ../.claude/tools/check-route-auth.js --fail              # exit 1 when anything is unbound
//
// It is a heuristic: some routes are public on purpose (login, OTP, public booking), and
// dynamically built paths can be missed. Treat the output as a review list.

const fs = require('fs');
const path = require('path');

// Workspace copy: the backend repo is ../../akhil_systems_backend from this file.
const root = path.resolve(__dirname, '..', '..', 'akhil_systems_backend');
const args = process.argv.slice(2);
const failOnFindings = args.includes('--fail');
const scope = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(root, a));

const AUTH_MIDDLEWARE = /(Jwt\w*Middleware|WindowServerMiddleware|AppointmentMiddleware|SecureMiddleware|PreRegSecureMiddleware|SuperTenantMiddleware|TenantAndUserMiddleware|LambdaFunctionMiddleware|SessionMiddleware|TenantAuthMiddleware|ChatEnabled\w*)/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

const withoutLineComments = (src) => src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Route paths compared segment by segment: ':param' and ':param?' match one segment,
// '*' and '(.*)' match the rest.
function routeRegex(p) {
  const segments = ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '').split('/').slice(1);
  const body = segments.map((s) => {
    if (s === '*' || s.includes('(.*)') || s.startsWith('*')) return '(?:/.*)?';
    if (s.startsWith(':')) return s.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+';
    return '/' + s.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*');
  }).join('');
  return new RegExp('^' + body + '/?$', 'i');
}

const files = walk(path.join(root, 'src')).filter((f) => f.endsWith('.ts'));

// Controllers keyed by "<file without .ts>#<ClassName>": class names repeat across modules.
const controllers = {};
for (const file of files.filter((f) => f.endsWith('controller.ts'))) {
  const src = fs.readFileSync(file, 'utf8');
  const cls = withoutLineComments(src).match(/@Controller\(\s*(?:'([^']*)'|"([^"]*)"|\{[^}]*path:\s*'([^']*)')?[^)]*\)\s*(?:@\w+\([^)]*\)\s*)*export\s+class\s+(\w+)/);
  if (!cls) continue;
  const base = cls[1] ?? cls[2] ?? cls[3] ?? '';
  const routes = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    const m = line.match(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?/);
    if (m) {
      const sub = m[2] ?? m[3] ?? m[4] ?? '';
      routes.push({ verb: m[1].toUpperCase(), path: ('/' + base + '/' + sub).replace(/\/+/g, '/').replace(/\/$/, ''), line: i + 1 });
    }
  });
  controllers[path.resolve(file).replace(/\.ts$/, '') + '#' + cls[4]] = { file, routes };
}

let total = 0;
let unbound = 0;
const modules = files.filter((f) => f.endsWith('.module.ts'))
  .filter((f) => !scope.length || scope.some((s) => path.resolve(f).startsWith(s)));

for (const mod of modules) {
  const src = fs.readFileSync(mod, 'utf8');
  const live = withoutLineComments(src);
  const controllerNames = (live.match(/controllers:\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!controllerNames.length) continue;

  // String constants (const BASE = '/x') so template paths like `${BASE}/:id` resolve.
  const constants = {};
  for (const m of live.matchAll(/const\s+(\w+)\s*=\s*['"`]([^'"`$]+)['"`]/g)) constants[m[1]] = m[2];
  const expand = (text) => text.replace(/\$\{(\w+)\}/g, (_, n) => constants[n] ?? '');
  // Route arrays (const ROUTES = [...]) used as ...ROUTES inside forRoutes().
  const arrayText = (n) => (live.match(new RegExp(`const\\s+${n}[^=]*=\\s*\\[([\\s\\S]*?)\\];`)) || [, ''])[1];

  // Each middleware chain runs from one `.apply(` to the next.
  const starts = [...live.matchAll(/\.apply\(/g)].map((x) => x.index);
  const chains = starts.map((s, i) => {
    const seg = live.slice(s, starts[i + 1] ?? live.length);
    const at = seg.indexOf('.forRoutes(');
    return {
      middleware: (seg.match(/^\.apply\(([^)]*)\)/) || [, ''])[1],
      exclude: at >= 0 ? seg.slice(0, at) : seg,
      targets: at >= 0 ? expand(seg.slice(at).replace(/\.\.\.(\w+)/g, (_, n) => arrayText(n))) : '',
    };
  });

  const isBound = (route) => chains.some((c) => {
    if (!AUTH_MIDDLEWARE.test(c.middleware)) return false;
    const excluded = [...expand(c.exclude).matchAll(/['"`]([^'"`]+)['"`]/g)].some((e) => routeRegex(e[1]).test(route.path));
    if (excluded) return false;
    if (controllerNames.some((n) => new RegExp(`\\b${n}\\b`).test(c.targets))) return true;
    const objects = [...c.targets.matchAll(/path:\s*['"`]([^'"`]+)['"`]\s*,\s*method:\s*RequestMethod\.(\w+)/g)];
    if (objects.some((o) => routeRegex(o[1]).test(route.path) && (o[2] === 'ALL' || o[2] === route.verb))) return true;
    const strings = [...c.targets.replace(/\{[^}]*\}/g, '').matchAll(/['"`]([^'"`]+)['"`]/g)];
    return strings.some((s) => routeRegex(s[1]).test(route.path));
  });

  for (const name of controllerNames) {
    const imp = live.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`)) ||
      live.match(new RegExp(`import\\s+${name}\\s+from\\s*['"]([^'"]+)['"]`));
    if (!imp) continue;
    const file = imp[1].startsWith('src/') ? path.join(root, imp[1]) : path.resolve(path.dirname(mod), imp[1]);
    const controller = controllers[path.resolve(file) + '#' + name];
    if (!controller) continue;
    for (const route of controller.routes) {
      total++;
      if (!isBound(route)) {
        unbound++;
        console.log(`${route.verb.padEnd(6)} ${route.path.padEnd(80)} ${path.relative(root, controller.file)}:${route.line}`);
      }
    }
  }
}

console.log(`\n${unbound} of ${total} routes have no auth middleware bound (static check; some are public on purpose).`);
process.exit(failOnFindings && unbound ? 1 : 0);
