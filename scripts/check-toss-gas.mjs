import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const view = fs.readFileSync('src/web/views/views_history.js', 'utf8');
// PC/mobile OAuth 401 and WTS IP-policy 403 are not interchangeable.
// The GAS egress probe is not proof of the actual Toss request IP.
assert.match(view,/토스 OAuth 401은 Client ID\/Secret/);
assert.match(view,/실제 Toss 요청 송신 IP를 확인한 뒤 필요한 범위만 허용하세요/);
assert.doesNotMatch(view,/Google IP range pool 허용 IP를 등록해야 합니다/);

assert.match(source, /TOSS_API_BASE\s*=\s*'https:\/\/openapi\.tossinvest\.com'/);
assert.match(source, /TOSS_CLIENT_ID/); assert.match(source, /TOSS_CLIENT_SECRET/);
assert.match(source, /grant_type:\s*'client_credentials'/);
assert.match(source, /Authorization:\s*'Bearer '\s*\+\s*token/);
assert.match(source, /\/api\/v1\/prices/); assert.match(source, /symbols\.join\(','\)/);
assert.match(source, /\/api\/v1\/candles/); assert.match(source, /interval:\s*'1d'/);
assert.match(source, /adjusted:\s*'false'/); assert.match(source, /nextBefore/);
assert.match(source, /Retry-After/); assert.match(source, /Math\.pow\(2, attempt\)/);
assert.match(source, /X-RateLimit-Reset/);
assert.match(source, /LockService\.getScriptLock/);
assert.match(source, /function _refreshTossAccessTokenAfter401_\(/);
assert.match(source, /status === 401 && !oauthRecoveryUsed/);
assert.match(source, /var prices = fetchPricesGoogleFinance\(items, dateStr, ss\)/);
assert.match(source, /var val = \(tossPrices\[code\]/);
assert.match(source, /diagnoseTossMarketData/);
assert.match(source, /function _tossDiagnosticSharedToken_\(/);
assert.match(source, /CACHED_TOKEN_REUSED/);
assert.match(source, /function handleDiagnoseTossMarketData\(forceFreshOAuth\)/);
assert.match(source, /\/api\/v1\/exchange-rate/);
assert.match(source, /\/api\/v1\/market-calendar\/KR/);
assert.match(source, /\/api\/v1\/market-calendar\/US/);
assert.match(source, /\/api\/v1\/market-indicators\/prices/);
assert.match(source, /\/api\/v1\/market-indicators\/KOSPI\/candles/);
assert.match(source, /IP_NOT_ALLOWED_OR_FORBIDDEN/);
assert.match(source, /function _tossDiagnosticRequest_\(/);
const diagnosticMatch = source.match(/function handleDiagnoseTossMarketData\(forceFreshOAuth\)\s*\{([\s\S]*?)\n\}/);
assert.ok(diagnosticMatch && !/(?:setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet)\s*\(/.test(diagnosticMatch[1]));
assert.ok(!/Logger\.log\([^\n]*(?:access_token|client_secret|TOSS_CLIENT_SECRET)/i.test(source));
console.log('Toss GAS integration contract checks passed');
