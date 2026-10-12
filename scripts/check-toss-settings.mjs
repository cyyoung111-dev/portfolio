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
assert.doesNotMatch(menuDiagnosisBody, /허용 IP에 임시 등록|Google IP range pool 허용 IP 등록/,
  'GAS 메뉴에서도 검증되지 않은 IP 또는 Google 공유 IP 대역 전체를 등록하도록 권고하면 안 됨');
assert.match(menuDiagnosisBody, /실제 Toss 요청 송신 IP로 확인되지 않았습니다/);
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
assert.match(diagnosticTokenBody, /_tossWithTokenLock_[\s\S]*_tossDiagnosticIssueAccessTokenUnlocked_\(\)/, '진단 OAuth 발급은 단일 lock을 소유합니다');
const diagnosticIssueBody = gasSource.match(/function _tossDiagnosticIssueAccessTokenUnlocked_\([\s\S]*?\n\}/)?.[0] || '';
assert.match(diagnosticIssueBody, /var credentials = _tossProperties_\(\)/, '획득한 lock 안에서 자격증명 재조회');
assert.doesNotMatch(diagnosticIssueBody, /_tossWithTokenLock_|getScriptLock\(/, '발급 본체에서는 중복 잠금 금지');

const diagnoseBody = gasSource.match(/function handleDiagnoseTossMarketData\(forceFreshOAuth\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(diagnoseBody, /setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet/);
assert.match(gasSource, /status === 403 \? 'IP_NOT_ALLOWED_OR_FORBIDDEN'/);
assert.doesNotMatch(webSync, /localStorage\.(?:setItem|getItem)\([^)]*Toss|lsSave\([^)]*Toss/i);
assert.doesNotMatch(gasSource, /Logger\.log\([^\n]*(?:TOSS_CLIENT_SECRET|Authorization|access_token)/i);
assert.match(gasSource, /function _tossCachedAccessToken_\(/);
assert.match(gasSource, /function _tossDiagnosticSharedToken_\(/);
assert.match(gasSource, /freshOAuth:|freshOAuth === '1'/);
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
let diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
diagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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
  return JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
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

// 진단 버튼 기본 경로는 기존 토큰을 재사용하고, 임의로 다른 실행의 토큰을 무효화하지 않습니다.
properties.set('TOSS_CLIENT_ID', 'reuse-client');
properties.set('TOSS_CLIENT_SECRET', 'reuse-secret');
cache.set('toss_oauth_token_v1', JSON.stringify({ accessToken: 'reused-token', expiresAt: Date.now() + 3600000 }));
let cachedOauthIssues = 0;
let resourceReads = 0;
context.UrlFetchApp = { fetch: (url, options = {}) => {
  if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
  if (url.endsWith('/oauth2/token')) {
    cachedOauthIssues++;
    return response(200, { token_type: 'Bearer', access_token: 'issued-token', expires_in: 3600 });
  }
  resourceReads++;
  assert.equal(options.headers.Authorization, 'Bearer reused-token', '캐시 토큰이 실제 resource probe에도 전달');
  if (url.includes('/api/v1/prices')) return response(200, { result: [{ symbol:'005930', lastPrice: 70000, timestamp:'2026-10-12T06:00:00Z' }] });
  return response(200, { result: [{ value: 1 }] });
} };
let safeDiagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(safeDiagnostic.ok, true);
assert.deepEqual([safeDiagnostic.oauth.source, safeDiagnostic.oauth.status, safeDiagnostic.oauth.code, safeDiagnostic.freshOAuthTested],
  ['CACHE', null, 'CACHED_TOKEN_REUSED', false], '기존 토큰 재사용은 OAuth HTTP 200으로 오표시하지 않음');
assert.equal(safeDiagnostic.gasVersion, '9.199');
assert.equal(cachedOauthIssues, 0, '캐시 유효 시 진단 버튼 신규 발급 0회');
assert.equal(resourceReads, 6, '시세 smoke 포함 기존 진단 호출은 수행');
assert.equal(JSON.parse(cache.get('toss_oauth_token_v1')).accessToken, 'reused-token');
assert.doesNotMatch(JSON.stringify(safeDiagnostic), /reuse-secret|reused-token|issued-token/);

// 캐시 만료/없음: single-flight 신규 발급 뒤 진단하고, 다음 요청에서 재사용합니다.
cache.delete('toss_oauth_token_v1');
cachedOauthIssues = 0;
resourceReads = 0;
context.UrlFetchApp = { fetch: (url, options = {}) => {
  if (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) return egressResponse();
  if (url.endsWith('/oauth2/token')) {
    cachedOauthIssues++;
    return response(200, { token_type: 'Bearer', access_token: 'issued-token', expires_in: 3600 });
  }
  resourceReads++;
  assert.equal(options.headers.Authorization, 'Bearer issued-token');
  if (url.includes('/api/v1/prices')) return response(200, { result: [{ symbol:'005930', lastPrice: 70000, timestamp:'2026-10-12T06:00:00Z' }] });
  return response(200, { result: [{ value: 1 }] });
} };
safeDiagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(safeDiagnostic.oauth.source, 'NETWORK');
assert.equal(safeDiagnostic.freshOAuthTested, true);
assert.equal(cachedOauthIssues, 1, '캐시 miss에서 최초 발급 1회');
safeDiagnostic = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(safeDiagnostic.oauth.source, 'CACHE', '두 번째 기본 진단은 캐시 재사용');
assert.equal(cachedOauthIssues, 1, '기본 재진단으로 추가 발급하지 않음');

// 명시적인 강제 진단은 별도 시험으로 남기되 정상 기본 경로와 구분합니다.
safeDiagnostic = JSON.parse(context.handleDiagnoseTossMarketData(true).getContent());
assert.equal(safeDiagnostic.oauth.source, 'NETWORK');
assert.equal(cachedOauthIssues, 2, '강제 진단에서만 추가 발급');
console.log('✅ Toss 캐시 재사용·명시적 강제 인증·시세 probe·비밀키 비노출 검증 통과');

// 진단 캐시 miss 직후 다른 실행이 lock 내에서 token을 발급했을 때 새 발급을 생략합니다.
cache.delete('toss_oauth_token_v1');
tossLockHeld = false;
tossLockWaits = 0;
injectTokenOnNextLock = 'concurrent-token';
let racedOauthIssues = 0;
context.UrlFetchApp = { fetch: url => {
  if (url.endsWith('/oauth2/token')) racedOauthIssues++;
  throw new Error('이미 발급된 token이 있으므로 OAuth 요청이 없어야 합니다');
} };
const raceDiagnostic = context._tossDiagnosticSharedToken_(false);
assert.equal(raceDiagnostic.source, 'CACHE');
assert.equal(raceDiagnostic.token, 'concurrent-token');
assert.equal(racedOauthIssues, 0, 'lock 대기 중 발급된 토큰 재사용');
assert.equal(tossLockHeld, false, '미스 잠금 정상 반환');

// 모바일/PC 연결지문은 GAS 배포 suffix와 accessToken 설정 유무만 표시하고 원문 URL을 숨깁니다.
const connectionHelper = webSync.match(/function _tossConnectionSummary_\(rawUrl, hasAccessToken\) \{([\s\S]*?)\n\}/)?.[0] || '';
assert.ok(connectionHelper, '브라우저 연결지문 생산 helper 필요');
const summarizeConnection = vm.runInNewContext(connectionHelper + '\n_tossConnectionSummary_', {URL});
const configured = summarizeConnection('https://script.google.com/macros/s/AKfycb-test-F9ABCDEF/exec?accessToken=TOPSECRET', true);
assert.match(configured, /배포 …F9ABCDEF \/exec/);
assert.match(configured, /GAS 접근토큰 설정됨/);
assert.doesNotMatch(configured, /TOPSECRET|AKfycb-test/);
assert.match(summarizeConnection('https://script.google.com/macros/s/example/dev', false), /GAS 접근토큰 미설정/);
assert.match(summarizeConnection('', false), /URL 미설정/);
console.log('✅ Toss 모바일 연결지문 비밀정보 비노출 및 lock 경쟁 검사 통과');

// Codex P2: GAS getScriptLock() 호출마다 서로 다른 Lock handle이 나오는 환경을 재현합니다.
// 같은 ScriptLock singleton을 돌려주는 구 테스트는 중첩 waitLock을 탐지하지 못합니다.
const priorLockService = context.LockService;
let lockHandle = null;
let lockAcquisitions = 0;
let duplicateAttempts = 0;
context.LockService = {
  getScriptLock() {
    const handle = {
      hasLock: () => lockHandle === handle,
      waitLock() {
        if (lockHandle) { duplicateAttempts++; throw new Error('nested ScriptLock acquisition'); }
        lockHandle = handle;
        lockAcquisitions++;
      },
      releaseLock() {
        assert.equal(lockHandle, handle, '다른 핸들의 lock은 해제할 수 없음');
        lockHandle = null;
      },
    };
    return handle;
  },
};
properties.set('TOSS_CLIENT_ID', 'distinct-handle-client');
properties.set('TOSS_CLIENT_SECRET', 'distinct-handle-secret');
cache.delete('toss_oauth_token_v1');
let isolatedOauthCalls = 0;
context.UrlFetchApp = { fetch: (url, opts) => {
  if (!url.endsWith('/oauth2/token')) throw new Error('예상 밖 요청: ' + url);
  assert.ok(lockHandle, '발급 중 ScriptLock 반드시 소유');
  isolatedOauthCalls++;
  assert.equal(opts.payload.client_id, 'distinct-handle-client');
  return response(200, { token_type: 'Bearer', access_token: 'distinct-token', expires_in: 3600 });
} };
const issuedWhenEmpty = context._tossDiagnosticSharedToken_(false);
assert.equal(issuedWhenEmpty.ok, true);
assert.equal(issuedWhenEmpty.source, 'NETWORK');
assert.equal(issuedWhenEmpty.token, 'distinct-token');
assert.equal(isolatedOauthCalls, 1);
assert.equal(lockAcquisitions, 1, '캐시 미스에서 잠금 한 번만 획득');
assert.equal(duplicateAttempts, 0, '다른 ScriptLock 핸들 재진입이 없어야 함');
assert.equal(lockHandle, null, '성공 시 잠금 해제');

const cachedWithoutExtraLock = context._tossDiagnosticSharedToken_(false);
assert.equal(cachedWithoutExtraLock.source, 'CACHE');
assert.equal(isolatedOauthCalls, 1);
assert.equal(lockAcquisitions, 1, '캐시 유효 진단에서는 잠금 없음');

const forcedIssue = context._tossDiagnosticSharedToken_(true);
assert.equal(forcedIssue.source, 'NETWORK');
assert.equal(isolatedOauthCalls, 2, '강제 진단에서도 단일 발급');
assert.equal(lockAcquisitions, 2, '강제 진단은 잠금 1회 추가');
assert.equal(duplicateAttempts, 0);
assert.equal(lockHandle, null);
context.LockService = priorLockService;
console.log('✅ 서로 다른 GAS ScriptLock 객체 + 진단 OAuth 단일 잠금 회귀검사 통과');

// 운영에서 관측한 IP가 Google Apps Script/Toss의 실제 송신 IP라는 증거는 아닙니다.
assert.doesNotMatch(webSync, /허용 IP에 임시 등록/,
  '검증되지 않은 진단 IP를 Toss 허용목록에 등록하라고 안내하면 안 됨');
assert.match(webSync, /이 주소를 근거 없이 Toss 허용 IP에 등록하지 마세요/);


// 실제 웹 진단 함수: 연결 URL/접근토큰이 바뀌거나 늦은 과거 응답이 도착해도 오귀속 금지.
const diagHelper = webSync.match(/function _tossConnectionSummary_\(rawUrl, hasAccessToken\) \{[\s\S]*?\n\}/)?.[0];
const diagUi = webSync.match(/let _tossDiagnosisRunId = 0;[\s\S]*?async function diagnoseTossFromUI\(\) \{[\s\S]*?\n\}(?=\n\nasync function clearTossConfigFromUI)/)?.[0];
assert.ok(diagHelper && diagUi, '실제 웹 연결 지문과 진단 실행 함수 추출');
const diagView = { textContent: '', innerHTML: '' };
const pendingDiag = [];
const ui = {
  GSHEET_API_URL: 'https://script.google.com/macros/s/DEPLOY-OLD12345/exec',
  generation: 1,
  token: 'TOKEN-A-PRIVATE',
  renders: 0,
  URL,
  window: { GAS_API_KEY_STATUS: { toss: {} } },
  getGsheetConnectionGeneration: () => ui.generation,
  getGsheetAccessToken: () => ui.token,
  isGsheetConnectionCurrent: (url, gen) => url === ui.GSHEET_API_URL && gen === ui.generation,
  $el: () => diagView,
  _escapeHtml: value => String(value),
  _renderTossConfigStatus: () => { ui.renders++; },
  requestGsheetActionJson: (action, params, opts) => {
    assert.equal(action, 'diagnoseTossMarketData');
    assert.equal(opts.targetUrl, ui.GSHEET_API_URL, '요청 시점의 GAS 배포를 지정');
    return new Promise((resolve, reject) => pendingDiag.push({ resolve, reject }));
  }
};
new vm.Script(diagHelper + '\n' + diagUi + '\nthis.runDiagnosis = diagnoseTossFromUI;')
  .runInContext(vm.createContext(ui));
const responseDiag = {
  status: 'ok', generatedAt: '2026-10-12T09:00:00Z', gasVersion: '9.199', ok: true,
  oauth: { ok: true, status: null, source: 'CACHE', code: 'CACHED_TOKEN_REUSED' },
  egressProbe: { ok: false, code: 'NOT_AVAILABLE' }, endpoints: [], priceSmoke: {}
};
const oldUrl = ui.runDiagnosis();
ui.GSHEET_API_URL = 'https://script.google.com/macros/s/DEPLOY-NEW67890/exec';
ui.generation++;
pendingDiag[0].resolve(responseDiag);
await oldUrl;
assert.match(diagView.textContent, /이전 진단 결과를 폐기/);
assert.equal(ui.renders, 0, '이전 GAS 응답은 새 계정 표시 금지');

const oldToken = ui.runDiagnosis();
ui.token = 'TOKEN-B-PRIVATE';
pendingDiag[1].resolve(responseDiag);
await oldToken;
assert.match(diagView.textContent, /이전 진단 결과를 폐기/);
assert.equal(ui.renders, 0, '같은 GAS URL에서 접근토큰 변경도 감지');

const older = ui.runDiagnosis();
const newer = ui.runDiagnosis();
pendingDiag[3].resolve(responseDiag);
await newer;
const latestHtml = diagView.innerHTML;
assert.match(latestHtml, /NEW67890/);
assert.doesNotMatch(latestHtml, /TOKEN-B-PRIVATE|DEPLOY-NEW67890/);
assert.equal(ui.renders, 1);
pendingDiag[2].resolve({ status: 'error', message: 'old response' });
await older;
assert.equal(diagView.innerHTML, latestHtml, '늦은 과거 실패가 최신 진단을 덮지 않음');
assert.equal(ui.renders, 1);

const staleError = ui.runDiagnosis();
ui.generation++;
pendingDiag[4].reject(new Error('old deployment timeout'));
await staleError;
assert.match(diagView.textContent, /이전 진단 결과를 폐기/);
assert.doesNotMatch(diagView.textContent, /old deployment timeout/);
console.log('✅ Toss 진단 UI: 연결 변경·토큰 교체·중복 응답·이전 오류 오귀속 차단 통과');


// Codex P2: 캐시상 유효하지만 provider가 거부한 token만 401 후 단 1회 복구.
properties.set('TOSS_CLIENT_ID', 'recovery-client');
properties.set('TOSS_CLIENT_SECRET', 'recovery-secret');
const fillDiagnosticCache = token => cache.set('toss_oauth_token_v1', JSON.stringify({
  accessToken: token, expiresAt: Date.now() + 3600000
}));
const recoveryMarketReply = url => url.includes('/api/v1/prices?symbols=005930')
  ? response(200, { result: [{symbol: '005930', lastPrice: 71000, timestamp: '2026-10-12T06:00:00Z'}] })
  : response(200, { result: [{ value: 1 }] });
const egressOrNull = url => (url.includes('checkip.amazonaws.com') || url.includes('api.ipify.org')) ? egressResponse() : null;

// 캐시 토큰 폐기 => 리소스 401 확인 이후에만 새 OAuth 발급, 재진단은 동일 새 토큰 사용.
fillDiagnosticCache('stale-cache-token');
let diagOauthIssues = 0, diagOldReads = 0, diagRecoveredReads = 0;
context.UrlFetchApp = { fetch: (url, opts={}) => {
  const ip = egressOrNull(url); if (ip) return ip;
  if (url.endsWith('/oauth2/token')) {
    diagOauthIssues++;
    return response(200, {token_type:'Bearer', access_token:'recovery-token', expires_in:3600});
  }
  const bearer = opts.headers?.Authorization;
  if (bearer === 'Bearer stale-cache-token') {
    diagOldReads++; return response(401, {error: {code:'invalid_token'}});
  }
  assert.equal(bearer, 'Bearer recovery-token');
  diagRecoveredReads++;
  return recoveryMarketReply(url);
} };
const resolved401 = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(resolved401.ok, true);
assert.deepEqual([resolved401.oauth.source,resolved401.oauth.status,resolved401.oauth.recovery.attempted,
  resolved401.oauth.recovery.ok,resolved401.oauth.recovery.code,resolved401.freshOAuthTested],
  ['CACHE',null,true,true,'RESOURCE_401_RECOVERED',false],
  '캐시 OAuth 200으로 오표시하지 않고 복구 및 resource 재조회 성공 기록');
assert.equal(diagOauthIssues,1,'거부된 cache token에서 OAuth 발급 최대 1회');
assert.equal(diagOldReads,6,'기존 진단의 6개 endpoint를 확인');
assert.equal(diagRecoveredReads,6,'복구 시 전 endpoint 및 smoke를 신규 token으로 재진단');
assert.equal(JSON.parse(cache.get('toss_oauth_token_v1')).accessToken,'recovery-token');
assert.doesNotMatch(JSON.stringify(resolved401),/stale-cache-token|recovery-token|recovery-secret/);

// ScriptLock을 기다리는 동안 다른 호출자가 이미 token을 교체했으면 신규 OAuth 발급 0회.
fillDiagnosticCache('raced-stale-token');
injectTokenOnNextLock = 'other-execution-token';
diagOauthIssues = 0;
context.UrlFetchApp = { fetch: (url, opts={}) => {
  const ip = egressOrNull(url); if (ip) return ip;
  if(url.endsWith('/oauth2/token')) { diagOauthIssues++; throw Error('중복 재발급 금지'); }
  if(opts.headers?.Authorization === 'Bearer raced-stale-token') return response(401,{error:{code:'invalid_token'}});
  assert.equal(opts.headers?.Authorization, 'Bearer other-execution-token');
  return recoveryMarketReply(url);
} };
const racedRecovery = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(racedRecovery.ok,true);
assert.equal(racedRecovery.oauth.recovery.ok,true);
assert.equal(diagOauthIssues,0);
assert.equal(JSON.parse(cache.get('toss_oauth_token_v1')).accessToken,'other-execution-token');

// 새 토큰으로도 401: 추가 재발급 없이 실패로 종료.
fillDiagnosticCache('always-401-old');
diagOauthIssues = 0;
context.UrlFetchApp = { fetch: url => {
  const ip=egressOrNull(url); if(ip) return ip;
  if(url.endsWith('/oauth2/token')) {
    diagOauthIssues++;return response(200,{token_type:'Bearer',access_token:'always-401-new',expires_in:3600});
  }
  return response(401,{error:{code:'invalid_token'}});
} };
const second401 = JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(second401.ok,false);
assert.deepEqual([second401.oauth.recovery.attempted,second401.oauth.recovery.ok,
  second401.oauth.recovery.code],[true,false,'RESOURCE_401_AFTER_RETRY']);
assert.equal(diagOauthIssues,1,'두 번째 401에서도 추가 OAuth 발급 금지');

// 리소스 403은 권한 차단이지 폐기된 cache token이라고 가정하지 않습니다.
fillDiagnosticCache('no-refresh-on-403');
diagOauthIssues=0;
context.UrlFetchApp={fetch: url=>{
  const ip=egressOrNull(url);if(ip)return ip;
  if(url.endsWith('/oauth2/token')) {diagOauthIssues++; throw Error('403으로 신규 OAuth 실행 금지');}
  return response(403,{error:{code:'access_denied'}});
}};
const forbiddenDiagnostic=JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(forbiddenDiagnostic.ok,false);
assert.equal(forbiddenDiagnostic.oauth.recovery,undefined);
assert.equal(diagOauthIssues,0);

// 복구 OAuth 실패는 서버 예외 원문을 응답/로그에 노출하지 않고 원래 401 증거를 보존.
fillDiagnosticCache('oauth-fails-on-recovery');
diagOauthIssues=0;
context.UrlFetchApp={fetch: url=>{
  const ip=egressOrNull(url);if(ip)return ip;
  if(url.endsWith('/oauth2/token')) {diagOauthIssues++;throw Error('sensitive-credential-string');}
  return response(401,{error:{code:'invalid_token'}});
}};
const failedRefresh=JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(failedRefresh.ok,false);
assert.deepEqual([failedRefresh.oauth.recovery.attempted,failedRefresh.oauth.recovery.ok,
  failedRefresh.oauth.recovery.code],[true,false,'OAUTH_REQUEST_ERROR']);
assert.equal(diagOauthIssues,1);
assert.doesNotMatch(JSON.stringify(failedRefresh),/sensitive-credential-string|oauth-fails-on-recovery/);
console.log('✅ 캐시 401 단일 복구·경합 재사용·재차 401·403 비재시도·OAuth 실패 민감정보 차단 통과');


// 추가 자체검토: 401 token은 복구되지만 새 token의 리소스 권한이 403인 경우
// "진단 복구 성공"으로만 보고하지 않고 원인별 실패를 분리합니다.
fillDiagnosticCache('token-revoked-before-403');
let mixedRecoveryOauthIssues=0;
context.UrlFetchApp={fetch:(url,opts={})=>{
  const ip=egressOrNull(url); if(ip)return ip;
  if(url.endsWith('/oauth2/token')) {
    mixedRecoveryOauthIssues++;
    return response(200,{token_type:'Bearer',access_token:'refreshed-but-403',expires_in:3600});
  }
  if(opts.headers?.Authorization==='Bearer token-revoked-before-403')return response(401,{error:{code:'invalid_token'}});
  assert.equal(opts.headers?.Authorization,'Bearer refreshed-but-403');
  return response(403,{error:{code:'access_denied'}});
}};
const mixedRecovery=JSON.parse(context.handleDiagnoseTossMarketData().getContent());
assert.equal(mixedRecovery.ok,false,'다른 리소스 오류가 남으면 전체 진단 성공으로 표시하면 안 됨');
assert.equal(mixedRecovery.oauth.recovery.ok,true,'기존 캐시 401 자체는 해소됨');
assert.equal(mixedRecovery.oauth.recovery.code,'RESOURCE_401_RECOVERED_PROBES_FAILED',
  '401 해결 뒤 API 403/권한 오류가 남은 상태를 명시적으로 표시');
assert.equal(mixedRecoveryOauthIssues,1,'401 뒤 신규 발급은 최대 한 번');
assert(mixedRecovery.endpoints.every(item=>item.status===403));
assert.equal(mixedRecovery.priceSmoke.status,403);
assert.match(webSync,/RESOURCE_401_RECOVERED_PROBES_FAILED/);

// 스프레드시트 메뉴의 실제 생산 UI 함수를 실행해 잘못된 IP 등록 지시가 사라졌는지 검사.
let menuAlert='';
const savedDiagnosisHandler=context.handleDiagnoseTossMarketData;
context.SpreadsheetApp={getUi:()=>({alert:message=>{menuAlert=String(message);}})};
context.handleDiagnoseTossMarketData=()=>({getContent:()=>JSON.stringify({
  status:'ok', generatedAt:'2026-10-12T10:00:00Z', gasVersion:'9.199',
  oauth:{ok:true,status:null,code:'CACHED_TOKEN_REUSED',source:'CACHE',
    recovery:{attempted:true,ok:true,code:'RESOURCE_401_RECOVERED_PROBES_FAILED'}},
  egressProbe:{ok:true,ip:'2001:2d8::1234',ipFamily:'IPv6',status:200,code:'OK',provider:'ip-check'},
  endpoints:[{name:'priceApi',status:403,ok:false,code:'IP_NOT_ALLOWED_OR_FORBIDDEN'}],
  priceSmoke:{status:403,ok:false,code:'IP_NOT_ALLOWED_OR_FORBIDDEN'}
})});
context.runTossMarketDataDiagnosis();
assert.match(menuAlert,/기존 캐시 재사용/);
assert.match(menuAlert,/기존 401 해소, 다른 API 진단 실패/);
assert.match(menuAlert,/실제 Toss 요청 송신 IP로 확인되지 않았습니다/);
assert.match(menuAlert,/Google 공유 IP 대역 전체를 근거 없이 허용하지 마세요/);
assert.doesNotMatch(menuAlert,/허용 IP에 임시 등록|Google IP range pool 허용 IP 등록/);
assert.doesNotMatch(menuAlert,/client-secret|accessToken=|Bearer /);
context.handleDiagnoseTossMarketData=savedDiagnosisHandler;
console.log('✅ 캐시 401→리소스 403 분리 및 실제 GAS 메뉴 IP 오등록 경고·비민감 표시 검증 통과');
