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

// OAuth와 실제 market endpoint 단계를 실행 수준에서 분리하고 비민감 응답만 확인합니다.
properties.set('TOSS_CLIENT_ID', 'client-123456');
properties.set('TOSS_CLIENT_SECRET', 'super-secret-value');
context.Utilities = { formatDate: () => '2026-10-02' };
const response = (status, value) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(value), getAllHeaders: () => ({}) });
let fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => { fetchedUrls.push(url); return response(403, { error: 'access_denied', raw: 'must-not-leak' }); } };
cache.clear();
let diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual([diagnostic.oauth.stage, diagnostic.oauth.ok, diagnostic.oauth.status, diagnostic.oauth.code, diagnostic.oauth.providerCode], ['oauth', false, 403, 'OAUTH_FAILED', 'access_denied']);
assert.equal(fetchedUrls.length, 1, 'OAuth 실패 시 market endpoint를 호출하지 않음');
assert(diagnostic.endpoints.every(item => item.code === 'SKIPPED_OAUTH_FAILED'), 'OAuth 실패 endpoint는 skipped 표시');
assert.equal(JSON.stringify(diagnostic).includes('IP_NOT_ALLOWED_OR_FORBIDDEN'), false, 'OAuth 403은 IP 오류로 오분류하지 않음');
assert.doesNotMatch(JSON.stringify(diagnostic), /super-secret-value|must-not-leak|access_token|Bearer token-value/);

fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.endsWith('/oauth2/token')) return response(200, { token_type: 'Bearer', access_token: 'token-value', expires_in: 3600 });
  return response(403, { error: { code: 'forbidden', requestId: 'safe-request-id' }, raw: 'must-not-leak' });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(diagnostic.oauth.ok, true);
assert(diagnostic.endpoints.every(item => item.code === 'IP_NOT_ALLOWED_OR_FORBIDDEN'), '실제 endpoint 403만 IP 제한으로 분류');
assert.equal(diagnostic.priceSmoke.code, 'IP_NOT_ALLOWED_OR_FORBIDDEN');
assert.equal(diagnostic.ok, false);
assert.equal(fetchedUrls.filter(url => url.endsWith('/oauth2/token')).length, 1, '진단 1회당 token 1회 확보');

fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.endsWith('/oauth2/token')) return response(200, { token_type: 'Bearer', access_token: 'token-value', expires_in: 3600 });
  if (url.includes('/api/v1/prices?symbols=005930')) return response(200, { result: [{ symbol: '005930', lastPrice: 70000, timestamp: '2026-10-02T06:00:00Z' }] });
  return response(200, { result: [{ value: 1 }] });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(diagnostic.ok, true);
assert.deepEqual([diagnostic.priceSmoke.resultCount, diagnostic.priceSmoke.symbol, diagnostic.priceSmoke.validLastPrice, diagnostic.priceSmoke.timestampPresent], [1, '005930', true, true]);
assert.match(webSync, /priceSmoke 005930/);
assert.match(webSync, /const ipBlocked = oauth\.ok/);
assert.match(webSync, /OAuth 토큰 발급 단계 실패/);
