import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src/web');
const indexPath = path.join(webRoot, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('❌ src/web/index.html not found');
  process.exit(1);
}

function collectJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectJs(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const html = fs.readFileSync(indexPath, 'utf8');
const attrRe = /\son[a-z]+\s*=\s*"([^"]+)"/gi;
const handlerBodies = [];
let m;
while ((m = attrRe.exec(html)) !== null) {
  handlerBodies.push(m[1]);
}

if (handlerBodies.length === 0) {
  console.log('✅ No inline handlers found in src/web/index.html');
  process.exit(0);
}

const called = new Set();
const callRe = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
for (const body of handlerBodies) {
  let c;
  while ((c = callRe.exec(body)) !== null) called.add(c[1]);
}

const declared = new Set();
const fnDeclRe = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const winAssignRe = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/;

for (const file of collectJs(webRoot)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    const fn = line.match(fnDeclRe);
    if (fn) declared.add(fn[1]);
    const wa = line.match(winAssignRe);
    if (wa) declared.add(wa[1]);
  }
}

const builtins = new Set([
  'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'Number', 'String', 'Boolean',
  'Date', 'Math', 'JSON', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout'
]);

const missing = [...called].filter((name) => !builtins.has(name) && !declared.has(name)).sort();
if (missing.length > 0) {
  console.error('❌ Inline handler references missing global function(s):');
  missing.forEach((name) => console.error(`   - ${name}`));
  process.exit(1);
}

console.log(`✅ Inline handler check passed (${handlerBodies.length} handlers, ${called.size} call refs)`);
