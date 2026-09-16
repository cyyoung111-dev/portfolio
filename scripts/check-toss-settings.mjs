import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gasSource = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const webView = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const webSync = fs.readFileSync('src/web/features/settings/settings_sync.js', 'utf8');
const events = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');

assert.match(gasSource, /function handleSaveTossConfig\(/);
assert.match(gasSource, /function handleClearTossConfig\(/);
assert.match(gasSource, /TOSS_LAST_DIAGNOSTIC_(?:AT|OK|CODE)/);
assert.match(gasSource, /function configureTossClientIdPrompt\(/);
assert.match(gasSource, /function configureTossClientSecretPrompt\(/);
assert.match(gasSource, /function runTossMarketDataDiagnosis\(/);
assert.match(gasSource, /function clearTossOpenApiConfigPrompt\(/);
assert.match(gasSource, /Toss WTS Open API/);
assert.match(webView, /tossClientIdInput/);
assert.match(webView, /tossClientSecretInput/);
assert.match(webView, /tossDiagnosticResult/);
assert.match(webSync, /requestGsheetFormJson\('saveTossConfig'/);
assert.match(webSync, /requestGsheetActionJson\('diagnoseTossMarketData'/);
assert.match(webSync, /requestGsheetFormJson\('clearTossConfig'/);
assert.match(events, /btn-save-toss-config/);
assert.match(events, /btn-diagnose-toss/);
assert.match(events, /btn-clear-toss-config/);

const properties = new Map([['OTHER_API_KEY', 'preserve-me']]);
const cache = new Map();
const context = vm.createContext({
  console, Date, JSON, String, Number, Object, Array, Math, isFinite,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties.get(key) || '',
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: key => properties.delete(key)
  }) },
  CacheService: { getScriptCache: () => ({
    get: key => cache.get(key) || null,
    put: (key, value) => cache.set(key, value),
    remove: key => cache.delete(key)
  }) },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: content => ({ getContent: () => content, setMimeType: () => ({ getContent: () => content }) }) },
});
new vm.Script(gasSource, { filename: 'src/gas/apps_script.gs' }).runInContext(context);

let saved = JSON.parse(context.handleSaveTossConfig(JSON.stringify({ clientId: 'client-123456', secret: 'value%2Fkeep' })).getContent());
assert.equal(saved.status, 'ok');
assert.equal(properties.get('TOSS_CLIENT_ID'), 'client-123456');
assert.equal(properties.get('TOSS_CLIENT_SECRET'), 'value%2Fkeep');
assert.equal(saved.toss.clientIdMasked, 'cl••••56');
assert.equal(saved.toss.secretConfigured, true);
assert.doesNotMatch(JSON.stringify(saved), /value%2Fkeep/);

saved = JSON.parse(context.handleSaveTossConfig(JSON.stringify({ clientId: '', secret: '' })).getContent());
assert.equal(saved.status, 'ok');
assert.equal(properties.get('TOSS_CLIENT_ID'), 'client-123456');
assert.equal(properties.get('TOSS_CLIENT_SECRET'), 'value%2Fkeep');

JSON.parse(context.handleClearTossConfig().getContent());
assert.equal(properties.has('TOSS_CLIENT_ID'), false);
assert.equal(properties.has('TOSS_CLIENT_SECRET'), false);
assert.equal(properties.get('OTHER_API_KEY'), 'preserve-me');
assert.equal(cache.has('toss_oauth_token_v1'), false);

const diagnoseBody = gasSource.match(/function handleDiagnoseTossMarketData\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(diagnoseBody, /setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet/);
assert.match(gasSource, /status === 403 \? 'IP_NOT_ALLOWED_OR_FORBIDDEN'/);
assert.doesNotMatch(webSync, /localStorage\.(?:setItem|getItem)\([^)]*Toss|lsSave\([^)]*Toss/i);
assert.doesNotMatch(gasSource, /Logger\.log\([^\n]*(?:TOSS_CLIENT_SECRET|Authorization|access_token)/i);
console.log('✅ Toss 설정 UI/PropertiesService/빈 입력 보존/제한 삭제/진단 비민감 응답 회귀 검사 통과');
