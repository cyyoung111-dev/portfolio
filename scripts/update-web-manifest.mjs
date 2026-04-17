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

const html = fs.readFileSync(indexPath, 'utf8');
const includeRe = /<script\s+defer\s+src="([^"]+)"\s*><\/script>/g;
const localDeferredScripts = [];
let m;
while ((m = includeRe.exec(html)) !== null) {
  if (!/^https?:\/\//.test(m[1])) {
    localDeferredScripts.push(m[1].split('?')[0]);
  }
}

const out = { localDeferredScripts };
fs.writeFileSync(manifestPath, `${JSON.stringify(out, null, 2)}\n`);

console.log(`✅ Updated src/web/script-manifest.json (${localDeferredScripts.length} entries)`);
