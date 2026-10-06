import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildUpdatedFiles,
  deploymentIdFromWebAppUrl,
  extractExpectedGasVersion,
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
