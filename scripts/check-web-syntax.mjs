import { execFileSync } from 'node:child_process';
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

let failed = false;
for (const file of files) {
  try {
    execFileSync('node', ['--check', file], { stdio: 'ignore' });
  } catch {
    failed = true;
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
    console.error(`❌ Syntax check failed: ${rel}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`✅ Syntax check passed (${files.length} files)`);
