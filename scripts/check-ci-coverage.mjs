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
    if (typeof command !== 'string' || !command.trim())
      throw new Error('npm 검사 스크립트 정의 누락: ' + name);

    // Fail closed: the reachable suite only allows unconditional, fail-fast
    // chains of "npm run <name>" or "node scripts/check-*.mjs [--flag]".
    // Pipes, "||", ";" and shell redirection can skip or mask a check.
    visiting.add(name);
    for (const segment of command.split(/\s+&&\s+/)) {
      const part = segment.trim();
      const npm = part.match(/^npm\s+run\s+([\w:.-]+)$/);
      if (npm) { visit(npm[1]); continue; }
      const node = part.match(/^node\s+(scripts\/check-[\w.-]+\.mjs)(?:\s+--[\w.-]+(?:=[\w.-]+)?)*$/);
      if (node) { executed.add(node[1]); continue; }
      throw new Error('허용되지 않는 검사 명령(실행 우회/실패 은폐 위험) [' + name + ']: ' + part);
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

assert.throws(
  () => collectExecutedChecks({'check:ci': 'npm run check:missing',
    'check:missing': 'true || node scripts/check-never.mjs'}),
  /허용되지 않는 검사 명령/,
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'node scripts/check-never.mjs || true'}),
  /허용되지 않는 검사 명령/,
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'node scripts/check-never.mjs; true'}),
  /허용되지 않는 검사 명령/,
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'node scripts/check-never.mjs | cat'}),
  /허용되지 않는 검사 명령/,
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'node scripts/check-never.mjs && true'}),
  /허용되지 않는 검사 명령/,
);
assert.throws(
  () => collectExecutedChecks({'check:ci': 'node scripts/check-never.mjs > /dev/null'}),
  /허용되지 않는 검사 명령/,
);

// This validator intentionally accepts only the explicit, safe subset of
// workflow YAML used here. Unknown/changed trigger or run syntax fails closed.
// It uses indentation boundaries, not cross-section substring matches.
function yamlBlock(lines, key, indent) {
  const expected = ' '.repeat(indent) + key + ':';
  const matches = lines.flatMap((line, index) =>
    line.trimEnd() === expected || line.startsWith(expected + ' #') ? [index] : []);
  assert.equal(matches.length, 1, '워크플로 항목은 정확히 하나여야 합니다: ' + expected);
  const start = matches[0];
  let stop = start + 1;
  while (stop < lines.length) {
    const line = lines[stop];
    const stripped = line.trim();
    if (stripped && !stripped.startsWith('#')) {
      const leading = line.match(/^ */)[0].length;
      if (leading <= indent) break;
    }
    stop += 1;
  }
  return lines.slice(start + 1, stop);
}

function validateQualityWorkflow(source) {
  const lines = source.split(/\r?\n/);
  // Reject shell/default overrides at workflow, job or step scope.
  // Even "run: npm run check:ci" can become a no-op with "shell: echo {0}".
  const unsafeConfig = lines.filter(line => {
    const active = line.trim();
    return active && !active.startsWith('#')
      && /^(?:-\s*)?(?:shell|defaults)\s*:/.test(active);
  });
  assert.equal(unsafeConfig.length, 0,
    '전체 CI를 우회할 수 있는 사용자 정의 shell/defaults 설정 금지: ' + unsafeConfig.join(', '));

  const events = yamlBlock(lines, 'on', 0);
  const pullRequest = yamlBlock(events, 'pull_request', 2);
  assert.ok(pullRequest.every(line => !line.trim() || line.trim().startsWith('#')),
    '필수 체크를 모든 PR에 생성하려면 pull_request 경로·브랜치·종류 필터를 둘 수 없습니다.');

  const jobs = yamlBlock(lines, 'jobs', 0);
  const qualityJob = yamlBlock(jobs, 'all-check-scripts', 2);
  // Fail closed for *all* job/step guards, including valid YAML inline step
  // properties such as `- if: false` or `- continue-on-error: true`.
  // Guarded prerequisite steps can silently suppress the real full-suite run.
  const forbidden = qualityJob.filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#')
      && /^(?:-\s*)?(?:if|continue-on-error)\s*:/.test(trimmed);
  });
  assert.equal(forbidden.length, 0,
    '필수 전체 검사 job 또는 단계에 조건부 실행·오류 무시가 설정됐습니다: ' + forbidden.join(', '));
  const steps = yamlBlock(qualityJob, 'steps', 4);
  const stepStarts = steps.flatMap((line, i) => /^ {6}- /.test(line) ? [i] : []);
  assert.ok(stepStarts.length > 0, '전체 검사 단계가 없습니다.');

  const fullSuiteSteps = stepStarts.map((start, index) => {
    const end = stepStarts[index + 1] ?? steps.length;
    return steps.slice(start, end);
  }).filter(step => step.some(line =>
    /^ {8}run:\s*(?:"npm run check:ci"|'npm run check:ci'|npm run check:ci)\s*(?:#.*)?$/.test(line)));

  assert.equal(fullSuiteSteps.length, 1, '전체 CI 명령이 정확히 한 단계에서 실행돼야 합니다.');
  assert.ok(!fullSuiteSteps[0].some(line => /^ {8}(if|continue-on-error):/.test(line)),
    '전체 CI 실행 단계가 조건부 또는 오류 무시로 구성됐습니다.');
}

const validWorkflow = [
  'on:',
  '  pull_request:',
  '  push:',
  '    paths:',
  "      - 'scripts/check-*.mjs'",
  'jobs:',
  '  all-check-scripts:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Full CI',
  '        run: npm run check:ci',
].join('\n');
assert.doesNotThrow(() => validateQualityWorkflow(validWorkflow));
assert.throws(() => validateQualityWorkflow(validWorkflow.replace('  pull_request:\n', '')),
  /pull_request/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '  pull_request:\n', "  pull_request:\n    paths:\n      - 'scripts/check-*.mjs'\n")),
  /모든 PR/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  'run: npm run check:ci', 'run: npm run check:ci-coverage')),
  /전체 CI 명령/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '  all-check-scripts:\n', '  all-check-scripts:\n    if: false\n')),
  /조건부/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '        run: npm run check:ci', '        if: false\n        run: npm run check:ci')),
  /조건부/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '        run: npm run check:ci', '        continue-on-error: true\n        run: npm run check:ci')),
  /오류 무시/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '      - name: Full CI', '      - if: false\n        name: Full CI')),
  /조건부/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '      - name: Full CI', '      - continue-on-error: true\n        name: Full CI')),
  /오류 무시/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '      - name: Full CI', '      - name: Full CI\n        if: \${{ false }}')),
  /조건부/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '    steps:\n', '    steps:\n      - name: Setup\n        if: false\n        run: echo skip\n')),
  /조건부/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '        run: npm run check:ci', '        shell: echo {0}\n        run: npm run check:ci')),
  /shell\/defaults/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  'jobs:\n', 'defaults:\n  run:\n    shell: echo {0}\njobs:\n')),
  /shell\/defaults/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '    steps:\n', '    defaults:\n      run:\n        shell: echo {0}\n    steps:\n')),
  /shell\/defaults/);
assert.throws(() => validateQualityWorkflow(validWorkflow.replace(
  '      - name: Full CI', '      - shell: echo {0}\n        name: Full CI')),
  /shell\/defaults/);
validateQualityWorkflow(fs.readFileSync('.github/workflows/quality-check.yml', 'utf8'));

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
  console.log('✅ CI 검사 연결 확인: ' + actual.length + '개 check-*.mjs 모두 check:ci에서 실행됨');
}
