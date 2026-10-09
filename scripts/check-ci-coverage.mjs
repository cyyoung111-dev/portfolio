import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Every scripts/check-*.mjs file must be executed by the CI suite that runs
// whenever a check script changes. A workflow trigger alone is not coverage.
function collectExecutedChecks(scripts, entry = 'check:ci') {
  const done = new Set(), visiting = new Set(), executed = new Set();
  function visit(name) {
    if (done.has(name)) return;
    if (visiting.has(name)) throw new Error('npm 검사 스크립트 순환 참조: ' + name);
    const command = scripts[name];
    if (typeof command !== 'string') throw new Error('npm 검사 스크립트 정의 누락: ' + name);
    visiting.add(name);
    for (const match of command.matchAll(/\bnode\s+(?:--[\w=-]+\s+)*(scripts\/check-[\w.-]+\.mjs)(?=\s|$|[&;|])/g)) {
      executed.add(match[1]);
    }
    for (const match of command.matchAll(/\bnpm\s+run\s+([\w:.-]+)/g)) {
      visit(match[1]);
    }
    visiting.delete(name);
    done.add(name);
  }
  visit(entry);
  return executed;
}

// Regression: indirect execution is recognized; unrelated npm tasks are not.
assert.deepEqual(
  [...collectExecutedChecks({
    'check:ci': 'npm run check:gas && node scripts/check-web.mjs',
    'check:gas': 'node scripts/check-gas.mjs',
    'check:unused': 'node scripts/check-unused.mjs',
  })].sort(),
  ['scripts/check-gas.mjs', 'scripts/check-web.mjs'],
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'npm run check:loop', 'check:loop': 'npm run check:ci'}),
  /순환 참조/,
);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const actual = fs.readdirSync('scripts', { withFileTypes: true })
  .filter(item => item.isFile() && /^check-[\w.-]+\.mjs$/.test(item.name))
  .map(item => path.posix.join('scripts', item.name)).sort();
const executed = collectExecutedChecks(pkg.scripts);
const missing = actual.filter(name => !executed.has(name));
if (missing.length) {
  console.error('❌ check:ci가 실행하지 않는 검사 파일:\n' + missing.map(name => ' - ' + name).join('\n'));
  process.exitCode = 1;
} else {
  const workflow = fs.readFileSync('.github/workflows/quality-check.yml', 'utf8');
  assert.match(workflow, /pull_request:[\s\S]*?scripts\/check-\*\.mjs/);
  assert.match(workflow, /npm run check:ci/);
  console.log('✅ CI 검사 연결 확인: ' + actual.length + '개 check-*.mjs 모두 check:ci에서 실행됨');
}
