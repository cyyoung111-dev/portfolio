#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const WEB_ROOT = path.join(ROOT, 'src/web');
const EVENT_FILE = path.join(WEB_ROOT, 'app/event_delegation.js');

function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(p));
    else if (entry.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

function collectHandlerIds(src, blockName) {
  const blockMatch = src.match(new RegExp(`const\\s+${blockName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const ids = [];

  // key: value
  for (const m of block.matchAll(/(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/g)) {
    const raw = m[1] || m[2] || m[3] || '';
    if (raw) ids.push(raw);
  }
  return ids;
}

function collectDefinedIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bid\s*=\s*(['"])([^'"]+)\1/g)) {
    ids.add(m[2]);
  }
  return ids;
}

function main() {
  if (!fs.existsSync(EVENT_FILE)) {
    console.error('❌ event_delegation.js를 찾을 수 없습니다.');
    process.exit(1);
  }

  const eventSrc = fs.readFileSync(EVENT_FILE, 'utf8');
  const clickIds = collectHandlerIds(eventSrc, 'clickHandlers');
  const enterEscapeIds = collectHandlerIds(eventSrc, 'enterEscapeHandlers');

  const requiredIds = new Set([...clickIds, ...enterEscapeIds, 'importFileInput', 'smCsvFileInput', 'secCsvFileInput']);

  const files = [path.join(WEB_ROOT, 'index.html'), ...walkJsFiles(WEB_ROOT)];
  const definedIds = new Set();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const id of collectDefinedIds(src)) definedIds.add(id);
  }

  const missing = [...requiredIds].filter(id => !definedIds.has(id)).sort();

  if (missing.length > 0) {
    console.error('❌ DOM contract check failed: event delegation에서 사용하는 id가 누락되었습니다.');
    for (const id of missing) console.error(` - ${id}`);
    process.exit(1);
  }

  console.log(`✅ DOM contract check passed (${requiredIds.size} handler ids verified)`);
}

main();
