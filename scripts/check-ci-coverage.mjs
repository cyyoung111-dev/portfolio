import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

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
    // npm automatically runs pre/post hooks around "npm run"; an otherwise
    // covered check can be replaced or masked before it is reached.
    assert.ok(!Object.hasOwn(scripts, 'pre' + name) && !Object.hasOwn(scripts, 'post' + name),
      '검사 npm lifecycle 훅을 허용하지 않습니다: ' + name);
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

assert.throws(
  () => collectExecutedChecks({
    'check:ci': 'node scripts/check-original.mjs',
    'precheck:ci': 'node scripts/check-prelude.mjs',
  }),
  /lifecycle/,
);
assert.throws(
  () => collectExecutedChecks({
    'check:ci': 'npm run check:gas',
    'check:gas': 'node scripts/check-gas.mjs',
    'postcheck:gas': 'node scripts/check-sabotage.mjs',
  }),
  /lifecycle/,
);

// Parse the actual GitHub Actions YAML (including quoted keys, mappings,
// arrays, aliases, and inline keys). Only a small fail-closed job contract is
// allowed: every PR gets a non-conditional job that directly runs full CI.
function mapping(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value),
    'YAML 매핑이 필요합니다: ' + label);
  return value;
}
function keysExactly(value, allowed, label) {
  assert.deepEqual(Object.keys(value).sort(), allowed.slice().sort(),
    '안전하지 않거나 누락된 YAML 속성: ' + label);
}
function validateQualityWorkflow(source) {
  const doc = YAML.parseDocument(source, { uniqueKeys:true, version:'1.2' });
  assert.equal(doc.errors.length, 0,
    'YAML 구문 오류/중복 키: ' + doc.errors.map(e => e.message).join('; '));
  const root = mapping(doc.toJS({ maxAliasCount:0 }), 'workflow');
  keysExactly(root, ['name','on','permissions','jobs'], 'workflow');
  assert.equal(root.name, 'quality-check');

  const events = mapping(root.on, 'on');
  keysExactly(events, ['pull_request','push','workflow_dispatch'], 'on');
  assert.ok(events.pull_request === null
    || (typeof events.pull_request === 'object'
      && !Array.isArray(events.pull_request)
      && Object.keys(events.pull_request).length === 0),
    '필수 상태는 모든 PR에 생성되어야 합니다(경로·브랜치·종류 필터 금지).');

  const permission = mapping(root.permissions, 'permissions');
  keysExactly(permission, ['contents'], 'permissions');
  assert.equal(permission.contents, 'read');

  const jobs = mapping(root.jobs, 'jobs');
  keysExactly(jobs, ['all-check-scripts'], 'jobs');
  const job = mapping(jobs['all-check-scripts'], 'all-check-scripts');
  // Fail closed for needs, job.if, job.defaults, continue-on-error, strategy,
  // custom job shells, and any new execution modifier.
  keysExactly(job, ['runs-on','steps'], 'all-check-scripts');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.ok(Array.isArray(job.steps) && job.steps.length > 0,
    '전체 검사 단계가 없습니다.');

  const steps = job.steps.map((value,index) => {
    const step = mapping(value, 'steps[' + index + ']');
    const keys = Object.keys(step);
    assert.ok(keys.includes('name') && typeof step.name === 'string',
      '단계에 name이 필요합니다: ' + index);
    assert.ok(keys.every(key => ['name','uses','with','run'].includes(key)),
      '조건부 실행, 오류 무시, 사용자 지정 shell/defaults 또는 알 수 없는 단계 속성 금지: ' + index);
    assert.ok((typeof step.uses === 'string') !== (typeof step.run === 'string'),
      '단계는 uses 또는 run 중 하나여야 합니다: ' + index);
    if (step.run !== undefined)
      assert.ok(step.with === undefined, 'run 단계의 with 속성은 허용하지 않습니다: ' + index);
    return step;
  });
  const fullSuite = steps.filter(step => step.run === 'npm run check:ci');
  assert.equal(fullSuite.length, 1, '전체 CI 명령이 정확히 한 단계에서 실행돼야 합니다.');
  assert.equal(steps[steps.length - 1], fullSuite[0],
    '전체 검사 단계 뒤에 실행되는 작업은 허용하지 않습니다.');
  keysExactly(fullSuite[0], ['name','run'], 'full CI step');

  // Pin all pre-check steps as well. Otherwise a PR can add an earlier run
  // step that rewrites package.json check:ci to a no-op and still pass.
  const allowedSteps = [
    {name:'Checkout', uses:'actions/checkout@v7'},
    {name:'Setup Node', uses:'actions/setup-node@v7', with:{'node-version':'24'}},
    {name:'Install dependencies', run:[
      'if [ -f package-lock.json ]; then',
      '  npm ci --ignore-scripts',
      'else',
      '  npm install --no-package-lock --no-audit --no-fund --ignore-scripts',
      'fi',
      '',
    ].join('\n')},
    {name:'Verify every check script and run full CI', run:'npm run check:ci'},
  ];
  assert.deepEqual(steps, allowedSteps,
    '전체 CI 전 단계의 구성·순서·실행 명령과 입력은 승인된 값만 허용합니다.');
}

const validWorkflow = [
  'name: quality-check',
  'on:',
  '  pull_request:',
  '  push:',
  '    paths:',
  "      - 'scripts/check-*.mjs'",
  '  workflow_dispatch:',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  all-check-scripts:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@v7',
  '      - name: Setup Node',
  '        uses: actions/setup-node@v7',
  '        with:',
  "          node-version: '24'",
  '      - name: Install dependencies',
  '        run: |',
  '          if [ -f package-lock.json ]; then',
  '            npm ci --ignore-scripts',
  '          else',
  '            npm install --no-package-lock --no-audit --no-fund --ignore-scripts',
  '          fi',
  '      - name: Verify every check script and run full CI',
  '        run: npm run check:ci',
].join('\n');
function invalidMutation(source, textToReplace, replacement, message) {
  assert.ok(source.includes(textToReplace), '테스트 변이의 원본 위치 누락: ' + textToReplace);
  assert.throws(() => validateQualityWorkflow(source.replace(textToReplace,replacement)),
    message || /./);
}
assert.doesNotThrow(() => validateQualityWorkflow(validWorkflow));

// Required check must not disappear on a GAS-only or Web-only PR.
invalidMutation(validWorkflow, '  pull_request:\n', '', /안전하지 않거나 누락된 YAML 속성/);
invalidMutation(validWorkflow, '  pull_request:\n',
  "  pull_request:\n    paths:\n      - 'scripts/check-*.mjs'\n", /모든 PR/);
invalidMutation(validWorkflow, 'run: npm run check:ci',
  'run: npm run check:ci-coverage', /전체 CI 명령/);
// Skip/ignore/mask the job or any of its steps.
invalidMutation(validWorkflow, '  all-check-scripts:\n',
  '  all-check-scripts:\n    if: false\n', /all-check-scripts/);
invalidMutation(validWorkflow, '      - name: Verify every check script and run full CI',
  '      - if: false\n        name: Verify every check script and run full CI', /조건부 실행/);
invalidMutation(validWorkflow, '      - name: Verify every check script and run full CI',
  '      - continue-on-error: true\n        name: Verify every check script and run full CI', /오류 무시/);
invalidMutation(validWorkflow, '      - name: Verify every check script and run full CI',
  '      - name: Verify every check script and run full CI\n        if: false', /조건부 실행/);
invalidMutation(validWorkflow, '      - name: Verify every check script and run full CI',
  '      - name: Verify every check script and run full CI\n        continue-on-error: true', /오류 무시/);
// Custom shells and defaults are risky even when the run command is correct.
invalidMutation(validWorkflow, '        run: npm run check:ci',
  '        shell: echo {0}\n        run: npm run check:ci', /사용자 지정 shell/);
invalidMutation(validWorkflow, '        run: npm run check:ci',
  '        "shell": echo {0}\n        run: npm run check:ci', /사용자 지정 shell/);
invalidMutation(validWorkflow, '        run: npm run check:ci',
  "        'shell': echo {0}\n        run: npm run check:ci", /사용자 지정 shell/);
invalidMutation(validWorkflow, 'jobs:\n',
  'defaults:\n  run:\n    shell: echo {0}\njobs:\n', /workflow/);
invalidMutation(validWorkflow, '    steps:\n',
  '    defaults:\n      run:\n        shell: echo {0}\n    steps:\n', /all-check-scripts/);
// needs can silently skip a required check if its prerequisite is skipped.
invalidMutation(validWorkflow, '    runs-on: ubuntu-latest',
  '    needs: gate\n    runs-on: ubuntu-latest', /all-check-scripts/);
invalidMutation(validWorkflow, 'jobs:\n',
  'jobs:\n  gate:\n    runs-on: ubuntu-latest\n    if: false\n    steps:\n      - run: echo skipped\n', /jobs/);
// Exact execution semantics: reject disguised YAML keys, duplicate keys,
// unsupported aliases and additional post-check steps.
invalidMutation(validWorkflow, '        run: npm run check:ci',
  '        run: npm run check:ci\n        "run": npm run check:ci', /YAML 구문/);
invalidMutation(validWorkflow, '        run: npm run check:ci',
  '        run: npm run check:ci\n      - name: Hide failure\n        run: echo after-check', /뒤에 실행되는 작업/);
// Regressions for pre-check step injection, modification, reordered execution,
// action/input replacement and alternate test entrypoint (PR #474 latest P2).
invalidMutation(validWorkflow, '    steps:\n',
  '    steps:\n      - name: Disable tests\n        run: npm pkg set scripts.check:ci="echo no-op"\n',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '        uses: actions/checkout@v7',
  '        uses: actions/checkout@v6',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, "          node-version: '24'",
  "          node-version: '22'",
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '      - name: Setup Node\n',
  '      - name: Setup Node\n        env:\n          NODE_OPTIONS: "--require ./malicious.js"\n',
  /조건부 실행|알 수 없는 단계 속성|전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '      - name: Checkout\n        uses: actions/checkout@v7',
  '      - name: Checkout\n        uses: actions/checkout@v7\n        with:\n          repository: attacker/repo',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '      - name: Checkout\n        uses: actions/checkout@v7',
  '      - name: Checkout\n        uses: actions/checkout@v7\n        with:\n          persist-credentials: false',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '      - name: Checkout\n        uses: actions/checkout@v7\n',
  '',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow,
  '      - name: Checkout\n        uses: actions/checkout@v7\n      - name: Setup Node',
  '      - name: Setup Node\n        uses: actions/setup-node@v7\n      - name: Checkout\n        uses: actions/checkout@v7\n      - name: Setup Node',
  /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '            npm ci --ignore-scripts',
  '            npm ci', /전체 CI 전 단계의 구성/);
invalidMutation(validWorkflow, '            npm install --no-package-lock --no-audit --no-fund --ignore-scripts',
  '            npm install --no-package-lock --no-audit --no-fund', /전체 CI 전 단계의 구성/);
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
