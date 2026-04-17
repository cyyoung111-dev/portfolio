import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src/web');

function collectJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectJs(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collectJs(webRoot).sort();
if (files.length === 0) {
  console.error('❌ No JS files found under src/web');
  process.exit(1);
}

// Heuristic: detect top-level function declarations in classic script files.
const fnDecl = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const hits = new Map();

for (const file of files) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(fnDecl);
    if (!m) return;
    const name = m[1];
    if (!hits.has(name)) hits.set(name, []);
    hits.get(name).push(`${rel}:${i + 1}`);
  });
}

let dupCount = 0;
for (const [name, refs] of [...hits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const uniqueFiles = new Set(refs.map((r) => r.split(':').slice(0, -1).join(':')));
  if (uniqueFiles.size > 1) {
    dupCount += 1;
    console.error(`❌ Duplicate top-level function "${name}" across files:`);
    refs.forEach((r) => console.error(`   - ${r}`));
  }
}

if (dupCount > 0) {
  console.error(`❌ Found ${dupCount} duplicate top-level function name(s)`);
  process.exit(1);
}

console.log(`✅ Global function name check passed (${hits.size} declarations scanned)`);
