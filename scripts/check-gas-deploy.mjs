import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildUpdatedFiles,
  deploymentIdFromWebAppUrl,
  extractExpectedGasVersion,
  assertGasReleaseReady,
  assertGasProjectFileSet,
  assertGasCreatedVersionReady,
  gasSourceBlobSha,
  parseClaspCredentials,
  sanitizeFiles,
  selectServerFile,
} from './deploy-gas.mjs';

assert.equal(deploymentIdFromWebAppUrl('https://script.google.com/macros/s/AKfycb-example/exec'), 'AKfycb-example');
assert.throws(() => deploymentIdFromWebAppUrl('https://example.com/not-gas'), /deployment ID/);

const source = `// Google Apps Script  v9.160
function handle(){ return { gasVersion: '9.160' }; }
const x = { gasVersion: '9.160' };`;
assert.equal(extractExpectedGasVersion(source), '9.160');
assert.throws(() => extractExpectedGasVersion(`// Google Apps Script  v9.160\nconst x={gasVersion:'9.159'};`), /버전 불일치/);

assert.equal(gasSourceBlobSha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
  'hashing must match Git blob format, not a plain-file digest');
assert.throws(() => assertGasReleaseReady(source),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'unreviewed old versions and rollbacks must fail closed');

const partialRelease = source.replaceAll('9.160', '9.193');
assert.throws(() => assertGasReleaseReady(partialRelease),
  /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'partial 9.193 must never be deployed');
const fakeFullRelease = partialRelease + `
function _getKrxAuthKeySlots_(){}
const found = { fundAttempt: {} };
let snapshotValidatedNoOp=0; snapshotValidatedNoOp++;
var authDeniedMarkets=[];
var missingItems = items.filter(() => true);
// 종가원천일
`;
assert.throws(() => assertGasReleaseReady(fakeFullRelease),
  /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'dummy implementation and comments cannot bypass the gate');

const bumpedVersion = partialRelease.replaceAll('9.193', '9.203');
assert.throws(() => assertGasReleaseReady(bumpedVersion),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'unreviewed future version must fail closed');
assert.throws(() => assertGasReleaseReady(bumpedVersion.replaceAll('9.203','10.0')),
  /GAS_RELEASE_UNREVIEWED_VERSION/, 'major version bumps must also fail closed');

const currentGasSource = fs.readFileSync('src/gas/apps_script.gs','utf8');
const approvedFullSourceBlob='7e673bbb7349931935c3db6510cb9ddee1adbb6e';
const actualSourceBlob=gasSourceBlobSha(currentGasSource);
const hasStackedKrxRecovery = currentGasSource.includes('function _getKrxAuthKeySlots_(');
if (hasStackedKrxRecovery) {
  assert.equal(actualSourceBlob, approvedFullSourceBlob,
    'a fully stacked PR #481 implementation must match the reviewed full-source blob');
  assert.equal(assertGasReleaseReady(currentGasSource),'9.203',
    'the exact pinned full GAS release source must pass validation');
  assert.throws(() => assertGasReleaseReady(currentGasSource + '\\n// unexpected edit'),
    /GAS_RELEASE_SOURCE_NOT_APPROVED/, 'even a benign post-review edit must be separately approved');
} else {
  assert.throws(() => assertGasReleaseReady(currentGasSource),
    /GAS_RELEASE_SOURCE_NOT_APPROVED|GAS_RELEASE_UNREVIEWED_VERSION/,
    'partial stacked source should not pass the production readiness gate');
}

const deployScript = fs.readFileSync('scripts/deploy-gas.mjs', 'utf8');
assert.match(deployScript, /dryRun\s*\?\s*extractExpectedGasVersion\(source\)\s*:\s*assertGasReleaseReady\(source\)/,
  'production preflight must run before GAS credentials and API writes');
assert.ok(
  deployScript.indexOf('const expectedVersion = dryRun ?') <
  deployScript.indexOf('const accessToken = await getAccessToken()'),
  'reviewed source must be validated before obtaining OAuth credentials');


const claspV3 = {
  tokens: {
    default: {
      type: 'authorized_user',
      client_id: 'clasp-client-id',
      client_secret: 'clasp-client-secret',
      refresh_token: 'clasp-refresh-token',
      access_token: 'expired-access-token',
    },
  },
};
assert.deepEqual(parseClaspCredentials(JSON.stringify(claspV3)), {
  clientId: 'clasp-client-id',
  clientSecret: 'clasp-client-secret',
  refreshToken: 'clasp-refresh-token',
});
assert.deepEqual(parseClaspCredentials(JSON.stringify({
  token: { refresh_token: 'legacy-refresh-token' },
  oauth2ClientSettings: { clientId: 'legacy-id', clientSecret: 'legacy-secret' },
})), {
  clientId: 'legacy-id',
  clientSecret: 'legacy-secret',
  refreshToken: 'legacy-refresh-token',
});
assert.throws(() => parseClaspCredentials(''), /CLASPRC_JSON/);
assert.throws(() => parseClaspCredentials('{bad-json'), /올바른 JSON/);
assert.throws(() => parseClaspCredentials(JSON.stringify({ tokens: {
  one: { client_id: '1', client_secret: 's1', refresh_token: 'r1' },
  two: { client_id: '2', client_secret: 's2', refresh_token: 'r2' },
} })), /여러 clasp 사용자 토큰/);

const files = [
  { name: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Seoul"}', updateTime: 'ignored' },
  { name: 'helpers', type: 'SERVER_JS', source: 'function helper(){}', lastModifyUser: { email: 'ignored' } },
  { name: 'apps_script', type: 'SERVER_JS', source: 'old source', functionSet: { values: [] } },
  { name: 'page', type: 'HTML', source: '<b>keep</b>' },
];

assert.equal(selectServerFile(files).name, 'apps_script');
assert.equal(selectServerFile(files, 'helpers').name, 'helpers');
assert.throws(() => selectServerFile([
  { name: 'one', type: 'SERVER_JS', source: '' },
  { name: 'two', type: 'SERVER_JS', source: '' },
]), /하나로 결정할 수 없습니다/);

const clean = sanitizeFiles(files);
assert.deepEqual(Object.keys(clean[0]), ['name', 'type', 'source']);

const updated = buildUpdatedFiles(files, 'apps_script', 'new source');
assert.equal(updated.find(file => file.name === 'apps_script').source, 'new source');
assert.equal(updated.find(file => file.name === 'helpers').source, 'function helper(){}');
assert.equal(updated.find(file => file.name === 'page').source, '<b>keep</b>');
assert.equal(updated.find(file => file.name === 'appsscript').source, '{"timeZone":"Asia/Seoul"}');
assert.throws(() => buildUpdatedFiles(files.filter(file => file.name !== 'appsscript'), 'apps_script', 'new source'), /manifest/);

const approvedProjectFiles = files.filter(f => f.name === 'appsscript' || f.name === 'apps_script');
assert.equal(assertGasProjectFileSet(approvedProjectFiles,'apps_script',approvedProjectFiles),true,
  'pinned sole GAS server and stable deployed manifest must pass');
assert.throws(() => assertGasProjectFileSet(files,'apps_script',approvedProjectFiles),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'extra SERVER_JS/HTML must be rejected even when approved server matches');
assert.throws(() => assertGasProjectFileSet([...approvedProjectFiles, {
  name:'evil',type:'SERVER_JS',source:'function doGet() { return false; }'
}], 'apps_script',approvedProjectFiles), /GAS_PROJECT_UNREVIEWED_FILES/,
  'unexpected extra top-level code must never deploy');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles,'apps_script',
  [...approvedProjectFiles,{name:'extra',type:'SERVER_JS',source:'function legacy(){}'}]),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'deployed versions with extra executable code also fail closed');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles.map(f =>
  f.name==='appsscript'?{...f,source:'{"timeZone":"America/New_York"}'}:f),
  'apps_script',approvedProjectFiles), /GAS_PROJECT_MANIFEST_DRIFT/,
  'manifest drift must be blocked before first write');
assert.throws(() => assertGasProjectFileSet(approvedProjectFiles.map(f =>
  f.name==='appsscript'?{...f,source:'not-json'}:f),
  'apps_script',approvedProjectFiles), /GAS_PROJECT_MANIFEST_DRIFT|GAS_PROJECT_MANIFEST_INVALID/);
const validateOrder = fs.readFileSync('scripts/deploy-gas.mjs','utf8');
assert.ok(validateOrder.indexOf('assertGasProjectFileSet(currentContent.files') <
          validateOrder.indexOf('if (alreadyDeployed) {'),
  'all-file validation must precede already-deployed fast path');
assert.ok(validateOrder.indexOf('assertGasProjectFileSet(currentContent.files') <
          validateOrder.indexOf("method: 'PUT'"),
  'all-file validation must precede any GAS write');

const versionFiles = approvedProjectFiles.map(f => f.name==='apps_script'
  ? {...f,source:'new approved GAS source'} : f);
assert.equal(assertGasCreatedVersionReady(versionFiles, 'apps_script',
  'new approved GAS source',approvedProjectFiles),true);
assert.throws(() => assertGasCreatedVersionReady(versionFiles,'apps_script',
  'unreviewed different code',approvedProjectFiles),
  /GAS_CREATED_VERSION_SOURCE_DRIFT/, 'concurrent GAS HEAD modification after POST must fail');
assert.throws(() => assertGasCreatedVersionReady([...versionFiles,
  {name:'other',type:'SERVER_JS',source:'function doGet() {}'}],
  'apps_script','new approved GAS source',approvedProjectFiles),
  /GAS_PROJECT_UNREVIEWED_FILES/, 'created version must not inherit unreviewed handlers');
assert.throws(() => assertGasCreatedVersionReady(versionFiles.map(f =>
  f.name==='appsscript'?{...f,source:'{"timeZone":"UTC"}'}:f),
  'apps_script','new approved GAS source',approvedProjectFiles),
  /GAS_PROJECT_MANIFEST_DRIFT/, 'created version manifest cannot change');
const versionValidationPos=validateOrder.indexOf('assertGasCreatedVersionReady(createdVersionContent.files');
const publishPos=validateOrder.indexOf('versionNumber: newVersionNumber,');
assert.ok(versionValidationPos > 0 && publishPos > versionValidationPos,
  'created immutable version must be verified before production deployment update');



const workflow = fs.readFileSync('.github/workflows/gas-deploy.yml', 'utf8');
assert.match(workflow, /push:\s*[\s\S]*branches:\s*\[\s*main\s*\][\s\S]*src\/gas\/apps_script\.gs/);
assert.match(workflow, /pull_request:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /npm run check:gas/);
assert.match(workflow, /CLASPRC_JSON/);
assert.doesNotMatch(workflow, /GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_OAUTH_REFRESH_TOKEN/);
assert.match(workflow, /GAS_SCRIPT_ID/);
assert.match(workflow, /GAS_WEB_APP_URL/);
assert.match(workflow, /GAS_AUTO_DEPLOY_ENABLED/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'push' && vars\.GAS_AUTO_DEPLOY_ENABLED == 'true'\)/);
assert.match(workflow, /deploy:\s*[\s\S]*concurrency:/);
assert.match(workflow, /gas-deploy-dry-run/);
assert.match(workflow, /gas-production-deploy/);
assert.doesNotMatch(workflow.split('jobs:')[0], /concurrency:/);
const deploySource = fs.readFileSync('scripts/deploy-gas.mjs', 'utf8');
assert.match(deploySource, /if \(alreadyDeployed\) \{[\s\S]*verifyWebApp\(/);
assert.match(deploySource, /parseClaspCredentials/);
assert.doesNotMatch(workflow, /service[_ -]?account/i);

const workflowPaths = [
  '.github/workflows/gas-deploy.yml',
  '.github/workflows/web-check.yml',
  '.github/workflows/cache_busting.yml',
  '.github/workflows/market-briefing-headless.yml',
];
for (const path of workflowPaths) {
  const source = fs.readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /actions\/checkout@v4/, `${path}: checkout@v4 잔존`);
  assert.doesNotMatch(source, /actions\/setup-node@v4/, `${path}: setup-node@v4 잔존`);
  assert.doesNotMatch(source, /node-version:\s*['"]20['"]/, `${path}: Node 20 잔존`);
}
assert.match(fs.readFileSync('.github/workflows/gas-deploy.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);
assert.match(fs.readFileSync('.github/workflows/web-check.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);
assert.match(fs.readFileSync('.github/workflows/market-briefing-headless.yml', 'utf8'), /actions\/checkout@v7[\s\S]*actions\/setup-node@v7[\s\S]*node-version:\s*['"]24['"]/);

console.log('✅ GAS clasp 인증·Node 24 자동배포 구성 회귀 검사 통과');
