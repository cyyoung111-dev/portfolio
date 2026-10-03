import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildUpdatedFiles,
  deploymentIdFromWebAppUrl,
  extractExpectedGasVersion,
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
assert.match(workflow, /GOOGLE_OAUTH_REFRESH_TOKEN/);
assert.match(workflow, /GAS_SCRIPT_ID/);
assert.match(workflow, /GAS_WEB_APP_URL/);
assert.match(workflow, /GAS_AUTO_DEPLOY_ENABLED/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'push' && vars\.GAS_AUTO_DEPLOY_ENABLED == 'true'\)/);
assert.match(workflow, /deploy:\s*[\s\S]*concurrency:\s*[\s\S]*group:\s*gas-production-deploy/);
assert.doesNotMatch(workflow.split('jobs:')[0], /concurrency:/);
const deploySource = fs.readFileSync('scripts/deploy-gas.mjs', 'utf8');
assert.match(deploySource, /if \(alreadyDeployed\) \{[\s\S]*verifyWebApp\(/);
assert.doesNotMatch(workflow, /service[_ -]?account/i);

console.log('✅ GAS 자동배포 구성 회귀 검사 통과');
