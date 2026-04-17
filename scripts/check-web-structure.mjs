import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src/web');
const indexPath = path.join(webRoot, 'index.html');

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
};

const warn = (msg) => {
  console.warn(`⚠️  ${msg}`);
};

const ok = (msg) => {
  console.log(`✅ ${msg}`);
};

if (!fs.existsSync(indexPath)) {
  fail('src/web/index.html not found');
  process.exit(process.exitCode ?? 1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const scriptRe = /<script\s+defer\s+src="([^"]+)"\s*><\/script>/g;
const srcs = [];
let m;
while ((m = scriptRe.exec(html)) !== null) {
  srcs.push(m[1]);
}

if (srcs.length === 0) {
  fail('No deferred script tags found in src/web/index.html');
}

const localSrcs = srcs.filter((s) => !/^https?:\/\//.test(s));
const normalizedLocalSrcs = localSrcs.map((s) => s.split('?')[0]);
const missing = normalizedLocalSrcs.filter((s) => !fs.existsSync(path.join(webRoot, s)));

if (missing.length > 0) {
  for (const mPath of missing) fail(`Missing include target: src/web/${mPath}`);
}

if (missing.length === 0) {
  ok(`All local includes exist (${normalizedLocalSrcs.length} files)`);
}

const collect = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
    }
  }
  return out;
};

const allJs = collect(webRoot);
const hashMap = new Map();
for (const f of allJs) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const rel = path.relative(repoRoot, f).replace(/\\/g, '/');
  if (!hashMap.has(hash)) hashMap.set(hash, []);
  hashMap.get(hash).push(rel);
}

const duplicateGroups = [...hashMap.values()].filter((g) => g.length > 1);
if (duplicateGroups.length > 0) {
  for (const group of duplicateGroups) {
    warn(`Duplicate-content JS files:\n  - ${group.join('\n  - ')}`);
  }
  fail(`Found ${duplicateGroups.length} duplicate-content group(s)`);
} else {
  ok('No duplicate-content JS files detected under src/web');
}

// Informational: files not loaded by index.html (strictly local script tags only).
const loadedSet = new Set(normalizedLocalSrcs.map((s) => path.join('src/web', s).replace(/\\/g, '/')));
const unreferenced = allJs
  .map((f) => path.relative(repoRoot, f).replace(/\\/g, '/'))
  .filter((rel) => !loadedSet.has(rel));

if (unreferenced.length > 0) {
  warn(`Unreferenced JS files from index.html includes: ${unreferenced.length}`);
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

ok('Web structure check passed');
