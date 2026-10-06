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
const menuDiagnosisBody = gasSource.match(/function runTossMarketDataDiagnosis\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(menuDiagnosisBody, /egressProbe/);
assert.match(menuDiagnosisBody, /GAS egress 관측/);
assert.match(menuDiagnosisBody, /ipFamily/);
assert.match(menuDiagnosisBody, /OAuth 403 access_denied/);
assert.match(menuDiagnosisBody, /실제 출구 IP와 동일하다고 보장되지 않습니다/);
assert.match(menuDiagnosisBody, /requestId/);
assert.match(menuDiagnosisBody, /priceSmoke 005930/);
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
let tossLockHeld = false;
let tossLockWaits = 0;
let injectTokenOnNextLock = '';
let injectCredentialsOnNextLock = null;
let requireTossConfigMutationLock = false;
const tossLock = {
  hasLock: () => tossLockHeld,
  waitLock: () => {
    tossLockWaits++;
    tossLockHeld = true;
    if (injectTokenOnNextLock) {
      cache.set('toss_oauth_token_v1', JSON.stringify({ accessToken: injectTokenOnNextLock, expiresAt: Date.now() + 3600000 }));
      injectTokenOnNextLock = '';
    }
    if (injectCredentialsOnNextLock) {
      properties.set('TOSS_CLIENT_ID', injectCredentialsOnNextLock.id);
      properties.set('TOSS_CLIENT_SECRET', injectCredentialsOnNextLock.secret);
      injectCredentialsOnNextLock = null;
    }
  },
  releaseLock: () => { tossLockHeld = false; }
};
const context = vm.createContext({
  console, Date, JSON, String, Number, Object, Array, Math, isFinite,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties.get(key) || '',
    setProperty: (key, value) => {
      if (requireTossConfigMutationLock && /^TOSS_/.test(String(key)) && !tossLockHeld) throw new Error('Toss config mutation without lock');
      properties.set(key, String(value));
    },
    deleteProperty: key => {
      if (requireTossConfigMutationLock && /^TOSS_/.test(String(key)) && !tossLockHeld) throw new Error('Toss config mutation without lock');
      properties.delete(key);
    }
  }) },
  CacheService: { getScriptCache: () => ({
    get: key => cache.get(key) || null,
    put: (key, value) => cache.set(key, value),
    remove: key => cache.delete(key)
  }) },
  LockService: { getScriptLock: () => tossLock },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: content => ({ getContent: () => content, setMimeType: () => ({ getContent: () => content }) }) },
});
new vm.Script(gasSource, { filename: 'src/gas/apps_script.gs' }).runInContext(context);

assert.equal(context._diagnosticIpFamily_('34.64.12.34'), 'IPv4');
assert.equal(context._diagnosticIpFamily_('2001:db8:85a3::8a2e:370:7334'), 'IPv6');
assert.equal(context._diagnosticIpFamily_('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), 'IPv6');
assert.equal(context._diagnosticIpFamily_('::ffff:192.0.2.128'), 'IPv6');
assert.equal(context._diagnosticIpFamily_('2001:db8:::1'), '', '잘못된 IPv6 거부');
assert.equal(context._diagnosticIpFamily_('<html>blocked</html>'), '', 'IP가 아닌 응답 거부');

requireTossConfigMutationLock = true;
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
cache.set('toss_oauth_token_v1', 'keep-on-empty');
context.handleSaveTossConfig(JSON.stringify({ clientId: '', secret: '' }));
assert.equal(cache.get('toss_oauth_token_v1'), 'keep-on-empty', '빈 입력으로 기존 설정 유지 시 token cache를 불필요하게 삭제하지 않음');
context.handleSaveTossConfig(JSON.stringify({ clientId: 'client-changed' }));
assert.equal(cache.has('toss_oauth_token_v1'), false, 'Client ID만 실제 변경해도 token cache 삭제');

JSON.parse(context.handleClearTossConfig().getContent());
assert.equal(properties.has('TOSS_CLIENT_ID'), false);
assert.equal(properties.has('TOSS_CLIENT_SECRET'), false);
assert.equal(properties.get('OTHER_API_KEY'), 'preserve-me');
assert.equal(cache.has('toss_oauth_token_v1'), false);
requireTossConfigMutationLock = false;

const saveTossBody = gasSource.match(/function handleSaveTossConfig\([\s\S]*?\n\}/)?.[0] || '';
const clearTossBody = gasSource.match(/function handleClearTossConfig\([\s\S]*?\n\}/)?.[0] || '';
const diagnosticTokenBody = gasSource.match(/function _tossDiagnosticAccessToken_\([\s\S]*?\n\}/)?.[0] || '';
assert.match(saveTossBody, /_tossWithTokenLock_/);
assert.match(clearTossBody, /_tossWithTokenLock_/);
assert.match(diagnosticTokenBody, /_tossWithTokenLock_[\s\S]*var credentials = _tossProperties_\(\)/, '진단 OAuth는 lock 획득 후 자격증명 재조회');

const diagnoseBody = gasSource.match(/function handleDiagnoseTossMarketData\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(diagnoseBody, /setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet/);
assert.match(gasSource, /status === 403 \? 'IP_NOT_ALLOWED_OR_FORBIDDEN'/);
assert.doesNotMatch(webSync, /localStorage\.(?:setItem|getItem)\([^)]*Toss|lsSave\([^)]*Toss/i);
assert.doesNotMatch(gasSource, /Logger\.log\([^\n]*(?:TOSS_CLIENT_SECRET|Authorization|access_token)/i);
assert.match(gasSource, /function _tossCachedAccessToken_\(/);
assert.match(gasSource, /function _refreshTossAccessTokenAfter401_\(/);
assert.match(gasSource, /LockService\.getScriptLock/);
assert.match(gasSource, /status === 401 && !oauthRecoveryUsed/);
console.log('✅ Toss 설정 UI/PropertiesService/빈 입력 보존/제한 삭제/진단 비민감 응답 회귀 검사 통과');

// OAuth와 실제 market endpoint 단계를 실행 수준에서 분리하고 비민감 응답만 확인합니다.
properties.set('TOSS_CLIENT_ID', 'client-123456');
properties.set('TOSS_CLIENT_SECRET', 'super-secret-value');
context.Utilities = { formatDate: () => '2026-10-02' };
const response = (status, value, headers = {}) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(value), getAllHeaders: () => headers });
const textResponse = (status, value, headers = {}) => ({ getResponseCode: () => status, getContentText: () => String(value), getAllHeaders: () => headers });
const egressResponse = () => textResponse(200, '34.64.12.34\n');
let fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => { fetchedUrls.push(url); if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse(); return response(403, { error: 'access_denied', raw: 'must-not-leak' }); } };
cache.clear();
let diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual([diagnostic.oauth.stage, diagnostic.oauth.ok, diagnostic.oauth.status, diagnostic.oauth.code, diagnostic.oauth.providerCode], ['oauth', false, 403, 'OAUTH_FAILED', 'access_denied']);
assert.equal(fetchedUrls.length, 2, 'egress probe 후 OAuth 실패 시 market endpoint를 호출하지 않음');
assert.deepEqual(
  [diagnostic.egressProbe.ok, diagnostic.egressProbe.ip, diagnostic.egressProbe.ipFamily, diagnostic.egressProbe.provider, diagnostic.egressProbe.observedOnly],
  [true, '34.64.12.34', 'IPv4', 'checkip.amazonaws.com', true]
);
assert(diagnostic.endpoints.every(item => item.code === 'SKIPPED_OAUTH_FAILED'), 'OAuth 실패 endpoint는 skipped 표시');
assert.equal(JSON.stringify(diagnostic).includes('IP_NOT_ALLOWED_OR_FORBIDDEN'), false, 'OAuth 403은 IP 오류로 오분류하지 않음');
assert.doesNotMatch(JSON.stringify(diagnostic), /super-secret-value|must-not-leak|access_token|Bearer token-value/);

// IPv6 plain-text 응답은 정상 egress 주소로 식별하고 family를 함께 반환합니다.
fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com')) return textResponse(200, '2001:0db8:85a3:0000:0000:8a2e:0370:7334\n', { 'content-type': 'text/plain' });
  return response(401, { error: { code: 'unidentified-client' } });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual(
  [diagnostic.egressProbe.ok, diagnostic.egressProbe.ip, diagnostic.egressProbe.ipFamily, diagnostic.egressProbe.provider],
  [true, '2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'IPv6', 'checkip.amazonaws.com']
);
assert.equal(diagnostic.egressProbe.attempts[0].ipFamily, 'IPv6');
assert.equal(fetchedUrls.length, 2, 'IPv6 egress 1회 + OAuth 1회');

// 1차 provider가 HTTP 200이지만 IP가 아니면 2차 provider로 fallback합니다.
fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com')) return textResponse(200, '<html>blocked</html>', { 'content-type': 'text/html' });
  if (url.includes('api.ipify.org')) return textResponse(200, '34.64.12.35\n', { 'content-type': 'text/plain' });
  return response(403, { error: 'access_denied' });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual([diagnostic.egressProbe.ok, diagnostic.egressProbe.ip, diagnostic.egressProbe.provider], [true, '34.64.12.35', 'api.ipify.org']);
assert.equal(diagnostic.egressProbe.attempts.length, 2, 'egress provider fallback 시도 기록');
assert.deepEqual(
  [diagnostic.egressProbe.attempts[0].status, diagnostic.egressProbe.attempts[0].code, diagnostic.egressProbe.attempts[0].bodyLength, diagnostic.egressProbe.attempts[0].contentType],
  [200, 'INVALID_IP_RESPONSE', 20, 'text/html']
);
assert.equal(fetchedUrls.length, 3, 'egress 2회 + OAuth 1회');
assert.doesNotMatch(JSON.stringify(diagnostic), /<html>blocked<\/html>/, 'egress 원문 응답 비노출');

// HTTP 오류 본문에 유효한 IPv4가 있어도 성공으로 오분류하지 않고 다음 provider로 진행합니다.
fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com')) return textResponse(403, '34.64.12.36\n', { 'content-type': 'text/plain' });
  if (url.includes('api.ipify.org')) return textResponse(200, '34.64.12.37\n', { 'content-type': 'text/plain' });
  return response(401, { error: { code: 'unidentified-client' } });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual([diagnostic.egressProbe.ok, diagnostic.egressProbe.ip, diagnostic.egressProbe.provider], [true, '34.64.12.37', 'api.ipify.org']);
assert.deepEqual([diagnostic.egressProbe.attempts[0].status, diagnostic.egressProbe.attempts[0].code], [403, 'HTTP_ERROR']);
assert.equal(fetchedUrls.length, 3, 'HTTP 오류 provider는 fallback 후 OAuth까지 진행');

// 모든 provider 실패 시 summary의 provider/status/code는 같은 마지막 시도에서 가져옵니다.
fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com')) return textResponse(200, '<html>blocked</html>', { 'content-type': 'text/html' });
  if (url.includes('api.ipify.org')) return textResponse(503, 'service unavailable', { 'content-type': 'text/plain' });
  return response(401, { error: { code: 'unidentified-client' } });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual(
  [diagnostic.egressProbe.ok, diagnostic.egressProbe.provider, diagnostic.egressProbe.status, diagnostic.egressProbe.code],
  [false, 'api.ipify.org', 503, 'HTTP_ERROR']
);
assert.deepEqual(
  diagnostic.egressProbe.attempts.map(item => [item.provider, item.status, item.code]),
  [['checkip.amazonaws.com', 200, 'INVALID_IP_RESPONSE'], ['api.ipify.org', 503, 'HTTP_ERROR']]
);

fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
  return response(401, {
    error: { code: 'unidentified-client', requestId: 'oauth-request-id', referenceId: 'oauth-reference-id' },
    raw: 'must-not-leak'
  }, { 'x-amz-cf-id': 'oauth-edge-id' });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.deepEqual(
  [diagnostic.oauth.status, diagnostic.oauth.code, diagnostic.oauth.providerCode],
  [401, 'OAUTH_FAILED', 'unidentified-client']
);
assert.deepEqual(
  [diagnostic.oauth.requestId, diagnostic.oauth.referenceId, diagnostic.oauth.edgeRequestId],
  ['oauth-request-id', 'oauth-reference-id', 'oauth-edge-id']
);
assert.equal(fetchedUrls.length, 2, 'egress probe 후 OAuth 401 실패 시 market endpoint를 호출하지 않음');
assert.doesNotMatch(JSON.stringify(diagnostic), /super-secret-value|must-not-leak|access_token|Bearer token-value/);

fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
  if (url.endsWith('/oauth2/token')) return response(200, { token_type: 'Bearer', access_token: 'token-value', expires_in: 3600 });
  return response(403, { error: { code: 'forbidden', requestId: 'safe-request-id', referenceId: 'safe-reference-id' }, raw: 'must-not-leak' }, { 'x-amz-cf-id': 'safe-edge-id' });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(diagnostic.oauth.ok, true);
assert(diagnostic.endpoints.every(item => item.code === 'IP_NOT_ALLOWED_OR_FORBIDDEN'), '실제 endpoint 403만 IP 제한으로 분류');
assert.equal(diagnostic.priceSmoke.code, 'IP_NOT_ALLOWED_OR_FORBIDDEN');
assert.deepEqual([diagnostic.endpoints[0].requestId, diagnostic.endpoints[0].referenceId, diagnostic.endpoints[0].edgeRequestId], ['safe-request-id', 'safe-reference-id', 'safe-edge-id']);
assert.deepEqual([diagnostic.priceSmoke.requestId, diagnostic.priceSmoke.referenceId, diagnostic.priceSmoke.edgeRequestId], ['safe-request-id', 'safe-reference-id', 'safe-edge-id']);
assert.equal(diagnostic.ok, false);
assert.equal(fetchedUrls.filter(url => url.endsWith('/oauth2/token')).length, 1, '진단 1회당 token 1회 확보');

fetchedUrls = [];
context.UrlFetchApp = { fetch: (url) => {
  fetchedUrls.push(url);
  if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
  if (url.endsWith('/oauth2/token')) return response(200, { token_type: 'Bearer', access_token: 'token-value', expires_in: 3600 });
  if (url.includes('/api/v1/prices?symbols=005930')) return response(200, { result: [{ symbol: '005930', lastPrice: 70000, timestamp: '2026-10-02T06:00:00Z' }] });
  return response(200, { result: [{ value: 1 }] });
} };
cache.clear();
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(diagnostic.ok, true);
assert.equal(diagnostic.oauth.source, 'NETWORK', '진단 OAuth 200은 실제 network 요청임을 표시');
assert.deepEqual([diagnostic.priceSmoke.resultCount, diagnostic.priceSmoke.symbol, diagnostic.priceSmoke.validLastPrice, diagnostic.priceSmoke.timestampPresent], [1, '005930', true, true]);
assert.match(webSync, /priceSmoke 005930/);
assert.match(webSync, /const ipBlocked = oauth\.ok/);
assert.match(webSync, /OAuth 토큰 발급 단계 실패/);
assert.match(webSync, /requestId/);
assert.match(webSync, /referenceId/);
assert.match(webSync, /x-amz-cf-id/);
assert.match(webSync, /unidentified-client/);
assert.match(webSync, /GAS egress 관측/);
assert.match(webSync, /egress\.ipFamily/);
assert.match(webSync, /oauthAccessDenied/);
assert.match(webSync, /동일하다고 보장되지 않습니다/);
assert.match(gasSource, /checkip\.amazonaws\.com/);
assert.match(gasSource, /api\.ipify\.org/);
assert.match(gasSource, /attempts:/);
assert.match(gasSource, /JSON\.parse\(body/);
assert.match(webSync, /bodyLength/);
assert.match(webSync, /contentType/);
const menuDiagnosisEgressBody = gasSource.match(/function runTossMarketDataDiagnosis\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(menuDiagnosisEgressBody, /egress\.attempts/);
assert.match(menuDiagnosisEgressBody, /bodyLength/);
assert.match(menuDiagnosisEgressBody, /contentType/);

const diagnosePriceSmoke = result => {
  fetchedUrls = [];
  cache.set('toss_oauth_token_v1', JSON.stringify({ accessToken: 'cached-token', expiresAt: Date.now() + 3600000 }));
  context.UrlFetchApp = { fetch: url => {
    fetchedUrls.push(url);
    if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
    if (url.endsWith('/oauth2/token')) return response(200, { token_type: 'Bearer', access_token: 'fresh-token', expires_in: 3600 });
    if (url.includes('/api/v1/prices?symbols=005930')) return response(200, { result });
    return response(200, { result: [{ value: 1 }] });
  } };
  return JSON.parse(context.handleDiagnoseTossMarketData().getContent());
};
diagnostic = diagnosePriceSmoke([]);
assert.equal(diagnostic.priceSmoke.code, 'PRICE_SMOKE_EMPTY');
assert.equal(diagnostic.ok, false);
assert.equal(properties.get('TOSS_LAST_DIAGNOSTIC_CODE'), 'PRICE_SMOKE_EMPTY');
assert.equal(fetchedUrls.filter(url => url.endsWith('/oauth2/token')).length, 1, 'cached token이 있어도 진단은 OAuth를 1회 실제 요청');
assert.equal(diagnostic.oauth.source, 'NETWORK');
diagnostic = diagnosePriceSmoke([{ symbol: '005930', lastPrice: 0, timestamp: '2026-10-02T06:00:00Z' }]);
assert.equal(diagnostic.priceSmoke.code, 'PRICE_SMOKE_INVALID_PRICE');
assert.equal(diagnostic.ok, false);
diagnostic = diagnosePriceSmoke([{ symbol: '005930', lastPrice: 70000, timestamp: '' }]);
assert.equal(diagnostic.priceSmoke.code, 'PRICE_SMOKE_TIMESTAMP_MISSING');
assert.equal(diagnostic.ok, false);
assert.notEqual(properties.get('TOSS_LAST_DIAGNOSTIC_CODE'), 'OK', 'semantic smoke 실패는 persisted code OK 금지');

// cache miss 동시 실행은 lock 대기 후 cache를 재확인하여 중복 OAuth 발급을 피합니다.
properties.set('TOSS_CLIENT_ID', 'client-lock-test');
properties.set('TOSS_CLIENT_SECRET', 'secret-lock-test');
cache.clear();
tossLockHeld = false;
tossLockWaits = 0;
injectTokenOnNextLock = 'token-from-other-execution';
let oauthFetches = 0;
context.UrlFetchApp = { fetch: url => {
  if (url.endsWith('/oauth2/token')) oauthFetches++;
  return response(200, { token_type: 'Bearer', access_token: 'should-not-be-issued', expires_in: 3600 });
} };
const lockToken = context._tossAccessToken_();
assert.equal(lockToken, 'token-from-other-execution', 'lock 획득 후 다른 실행이 만든 token 재사용');
assert.equal(oauthFetches, 0, 'single-flight cache 재확인으로 중복 OAuth 발급 방지');
assert.equal(tossLockWaits, 1);
assert.equal(tossLockHeld, false, '직접 획득한 lock은 반환');

// 401 처리 중 lock 대기 사이 다른 실행이 새 token을 저장하면 그 token을 삭제하지 않고 재사용합니다.
cache.set('toss_oauth_token_v1', JSON.stringify({ accessToken: 'rejected-token', expiresAt: Date.now() + 3600000 }));
tossLockHeld = false;
tossLockWaits = 0;
injectTokenOnNextLock = 'new-token-from-other-execution';
oauthFetches = 0;
context.UrlFetchApp = { fetch: url => {
  if (url.endsWith('/oauth2/token')) oauthFetches++;
  return response(200, { token_type: 'Bearer', access_token: 'should-not-be-issued-after-race', expires_in: 3600 });
} };
const racedRefreshToken = context._refreshTossAccessTokenAfter401_('rejected-token');
assert.equal(racedRefreshToken, 'new-token-from-other-execution', 'lock 획득 후 최신 token 재비교');
assert.equal(oauthFetches, 0, '다른 실행이 갱신한 token이 있으면 추가 OAuth 발급 금지');
assert.equal(JSON.parse(cache.get('toss_oauth_token_v1')).accessToken, 'new-token-from-other-execution', '새 token을 잘못 삭제하지 않음');
assert.equal(tossLockWaits, 1);

// 진단 OAuth도 lock 대기 중 설정이 변경되면 최신 자격증명을 사용합니다.
properties.set('TOSS_CLIENT_ID', 'client-before-wait');
properties.set('TOSS_CLIENT_SECRET', 'secret-before-wait');
cache.clear();
tossLockHeld = false;
tossLockWaits = 0;
injectCredentialsOnNextLock = { id: 'client-after-wait', secret: 'secret-after-wait' };
let diagnosticOauthPayload = null;
context.UrlFetchApp = { fetch: (url, options = {}) => {
  if (!url.endsWith('/oauth2/token')) throw new Error('unexpected diagnostic URL ' + url);
  diagnosticOauthPayload = options.payload;
  return response(200, { token_type: 'Bearer', access_token: 'diagnostic-new-token', expires_in: 3600 });
} };
const diagnosticTokenResult = context._tossDiagnosticAccessToken_();
assert.equal(diagnosticTokenResult.ok, true);
assert.equal(diagnosticOauthPayload.client_id, 'client-after-wait', 'lock 획득 뒤 최신 Client ID 사용');
assert.equal(diagnosticOauthPayload.client_secret, 'secret-after-wait', 'lock 획득 뒤 최신 Client Secret 사용');
assert.equal(tossLockWaits, 1);

// resource 401은 rejected cached token만 폐기하고 새 token으로 딱 1회 복구합니다.
cache.clear();
tossLockHeld = false;
tossLockWaits = 0;
oauthFetches = 0;
let resourceFetches = 0;
let issuedTokens = ['token-old', 'token-new'];
context.UrlFetchApp = { fetch: (url, options = {}) => {
  if (url.endsWith('/oauth2/token')) {
    const token = issuedTokens.shift();
    oauthFetches++;
    return response(200, { token_type: 'Bearer', access_token: token, expires_in: 3600 });
  }
  if (url.includes('/api/v1/prices')) {
    resourceFetches++;
    const auth = String(options.headers?.Authorization || '');
    if (resourceFetches === 1) {
      assert.equal(auth, 'Bearer token-old');
      return response(401, { error: { code: 'invalid_token' } });
    }
    assert.equal(auth, 'Bearer token-new');
    return response(200, { result: [{ symbol: '005930', lastPrice: 70000, currency: 'KRW' }] });
  }
  throw new Error('unexpected URL ' + url);
} };
const recovered = context._tossRequest_('/api/v1/prices', { symbols: '005930' }, 'MARKET_DATA', {});
assert.equal(recovered.result[0].lastPrice, 70000);
assert.equal(oauthFetches, 2, '초기 token + 401 후 재발급 각 1회');
assert.equal(resourceFetches, 2, 'resource 401 후 딱 1회 재시도');

// 두 번째 401은 추가 token 재발급 없이 오류로 종료합니다.
cache.clear();
tossLockHeld = false;
oauthFetches = 0;
resourceFetches = 0;
issuedTokens = ['token-a', 'token-b'];
context.UrlFetchApp = { fetch: url => {
  if (url.endsWith('/oauth2/token')) {
    oauthFetches++;
    return response(200, { token_type: 'Bearer', access_token: issuedTokens.shift(), expires_in: 3600 });
  }
  resourceFetches++;
  return response(401, { error: { code: 'invalid_token' } });
} };
assert.throws(() => context._tossRequest_('/api/v1/prices', { symbols: '005930' }, 'MARKET_DATA', {}), /Toss API 실패\(401\)/);
assert.equal(oauthFetches, 2, '두 번째 401에서 추가 OAuth 발급 금지');
assert.equal(resourceFetches, 2, '401 resource retry는 1회로 제한');

// 일반 retry budget의 마지막 시도에서 401이어도 token refresh 뒤 실제 resource 재요청을 보장합니다.
cache.clear();
tossLockHeld = false;
oauthFetches = 0;
resourceFetches = 0;
issuedTokens = ['token-before-last-401', 'token-after-last-401'];
context.Utilities.sleep = () => {};
context.UrlFetchApp = { fetch: (url, options = {}) => {
  if (url.endsWith('/oauth2/token')) {
    oauthFetches++;
    return response(200, { token_type: 'Bearer', access_token: issuedTokens.shift(), expires_in: 3600 });
  }
  resourceFetches++;
  if (resourceFetches <= 3) return response(503, { error: { code: 'temporary' } });
  if (resourceFetches === 4) {
    assert.equal(String(options.headers?.Authorization || ''), 'Bearer token-before-last-401');
    return response(401, { error: { code: 'invalid_token' } });
  }
  assert.equal(String(options.headers?.Authorization || ''), 'Bearer token-after-last-401');
  return response(200, { result: [{ symbol: '005930', lastPrice: 71000, currency: 'KRW' }] });
} };
const lastAttemptRecovered = context._tossRequest_('/api/v1/prices', { symbols: '005930' }, 'MARKET_DATA', {});
assert.equal(lastAttemptRecovered.result[0].lastPrice, 71000);
assert.equal(resourceFetches, 5, '3회 5xx + 마지막 401 뒤 새 token으로 실제 재요청');
assert.equal(oauthFetches, 2, '마지막 401에서도 OAuth refresh는 1회만');
