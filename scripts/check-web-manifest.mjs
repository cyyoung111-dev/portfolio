import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src/web');
const indexPath = path.join(webRoot, 'index.html');
const manifestPath = path.join(webRoot, 'script-manifest.json');

if (!fs.existsSync(indexPath)) {
  console.error('❌ src/web/index.html not found');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('❌ src/web/script-manifest.json not found');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const includeRe = /<script\s+defer\s+src="([^"]+)"\s*><\/script>/g;
const indexLocal = [];
let m;
while ((m = includeRe.exec(html)) !== null) {
  if (!/^https?:\/\//.test(m[1])) indexLocal.push(m[1].split('?')[0]);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expected = Array.isArray(manifest.localDeferredScripts) ? manifest.localDeferredScripts : null;
if (!expected) {
  console.error('❌ Invalid manifest: localDeferredScripts array is required');
  process.exit(1);
}

if (expected.length !== indexLocal.length) {
  console.error(`❌ Manifest/index include count mismatch: manifest=${expected.length}, index=${indexLocal.length}`);
  process.exit(1);
}

let mismatch = false;
for (let i = 0; i < expected.length; i += 1) {
  if (expected[i] !== indexLocal[i]) {
    mismatch = true;
    console.error(`❌ Include order mismatch at #${i + 1}: expected="${expected[i]}" actual="${indexLocal[i]}"`);
  }
}

if (mismatch) process.exit(1);

console.log(`✅ Script manifest check passed (${expected.length} entries)`);
