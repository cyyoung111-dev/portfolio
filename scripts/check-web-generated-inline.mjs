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
    const matches = [...text.matchAll(INLINE_ATTR_RE)];
    return {
      file: path.relative(root, file),
      refs: matches.map(match => text.slice(0, match.index).split('\n').length),
    };
  })
  .filter(row => row.refs.length > 0)
  .sort((a, b) => b.refs.length - a.refs.length || a.file.localeCompare(b.file));

const total = rows.reduce((sum, row) => sum + row.refs.length, 0);
if (total > 0) {
  console.error(`❌ Generated inline handler check failed: ${total} handler attribute refs across ${rows.length} files`);
  for (const row of rows) {
    console.error(`- ${row.refs.length.toString().padStart(2, ' ')} ${row.file}:${row.refs.join(',')}`);
  }
  process.exit(1);
}

console.log('✅ Generated inline handler check passed (0 handler attribute refs)');
