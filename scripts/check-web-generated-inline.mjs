import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'src', 'web');
const INLINE_ATTR_RE = /\bon(?:click|change|input|compositionstart|compositionend|focus|blur|keydown|keyup)\s*=/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const rows = walk(webRoot)
  .map(file => {
    const text = fs.readFileSync(file, 'utf8');
    const matches = text.match(INLINE_ATTR_RE) || [];
    return { file: path.relative(root, file), count: matches.length };
  })
  .filter(row => row.count > 0)
  .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

const total = rows.reduce((sum, row) => sum + row.count, 0);
console.log(`Generated inline handler report: ${total} handler attribute refs across ${rows.length} files`);
for (const row of rows) {
  console.log(`- ${row.count.toString().padStart(2, ' ')} ${row.file}`);
}
