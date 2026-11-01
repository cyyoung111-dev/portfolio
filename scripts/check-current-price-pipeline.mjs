import assert from 'node:assert/strict';
import fs from 'node:fs';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');

assert.match(gas, /priceType:\s*'REALTIME',\s*status:\s*'INDICATIVE'/,'NH 현재가를 확정 종가로 분류하지 않음');
assert.match(gas, /var krxItems = gfItems\.filter/,'국내 확정 Snapshot은 KRX 종가를 우선');
assert.match(gas, /var val = \(tossPrices\[code\] && tossPrices\[code\]\.price > 0\)/);
assert.match(gas, /var krxItems = targetItems\.filter/);
assert.match(gas, /usedDate: usedDate/);
assert.match(gas, /latestEntry\.date > priceDates\[code\]/);
assert.match(gas, /var cacheRaw = todayStr \+ '\|p=' \+ \(persist \? '1' : '0'\)/);
assert.match(gas, /prices_v9277_p' \+ \(persist \? '1' : '0'\)/);
assert.match(gas, /cachedPayload\.priceLookup\.snapshotCreated = persist && cachedLatestDate/);
assert.match(gas, /function _newPriceLookupTimings_\(\)/);
for (const key of ['setup', 'codeItems', 'initialPriceHistory', 'tossToken', 'tossPricesHttp', 'krx', 'recentHistory', 'snapshot', 'other', 'finalize']) {
  assert.match(gas, new RegExp(`${key}:`), `timing key ${key} 누락`);
}
assert.match(gas, /fetchPricesToss\(targetItems, timings, tossProviderMeta\)/);
assert.match(gas, /lookupMeta\.krxExecuted = krxItems\.length > 0/);
assert.match(gas, /lookupMeta\.krxElapsedMs = timings\.krx/);
assert.match(gas, /recentHistoryFallbackItems: \[\]/);
assert.match(gas, /recentHistoryFallbackItems\.push\(\{[\s\S]*?code: code,[\s\S]*?name: codeNameMap\[code\] \|\| code,[\s\S]*?priceDate: latestEntry\.date/);
assert.doesNotMatch(gas, /recentHistoryFallbackItems\.push\(\{[^}]*tossPrices/);
const fallbackItems = value => Array.isArray(value) ? value : [];
assert.deepEqual(fallbackItems([]), []);
assert.deepEqual(fallbackItems(null), []);
assert.deepEqual(fallbackItems([{ code: '005930', name: '삼성전자', priceDate: '2026-09-16' }]), [{ code: '005930', name: '삼성전자', priceDate: '2026-09-16' }]);
assert.match(gas, /if \(persist\) Object\.keys\(newItemsByDate\)/);
assert.match(gas, /if \(persist\) _updateTodaySnapshotSource/);
assert.match(gas, /if \(persist && confirmedPersistDates\.length\) _rebuildSnapshotForDateFromHistory/);
const currentPriceBody = gas.slice(gas.indexOf('function handleGetPricesCompat'), gas.indexOf('function _latestDateFromPriceDates'));
assert.doesNotMatch(currentPriceBody, /fetchPricesGoogleFinance\(/, '현재가 경로에서 GOOGLEFINANCE fallback을 사용하면 안 됩니다');
assert.match(web, /현재가 갱신 · \$\{entries\.length\}개 · 화면만 반영/);
assert.match(web, /저장 이력\/Snapshot 미변경/);
assert.match(web, /\$\{toss\}건/);
assert.match(web, /data-price-detail="recent-history"/);
assert.match(web, /data-price-detail="timings"/);
assert.match(web, /function _priceLookupDetail\(kind\)/);
assert.match(web, /price-lookup-detail/);

const delegation = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');
assert.match(delegation, /closest\('\[data-price-detail\]'\)/);
const index = fs.readFileSync('src/web/index.html', 'utf8');
assert.match(index, /components\.css\?v=20261102-1/);
assert.match(index, /settings_sync\.js\?v=20261028-6/);
assert.match(index, /settings_fetch\.js\?v=20261102-1/);
assert.match(web, /const requestKey = targetUrl \+ '\\|' \+ generation \+ '\\|' \+ dateStr/,
  '현재가 in-flight 요청은 GSheet URL+generation+날짜별로 격리');
assert.match(web, /const isCurrentConnection = \(\) =>[\s\S]*isGsheetConnectionCurrent\(targetUrl, generation\)/,
  '현재가 응답 적용 전 연결 generation 검증');
assert.match(web, /requestGsheetActionJson\([\s\S]*'getPrices'[\s\S]*targetUrl[\s\S]*if \(!isCurrentConnection\(\)\) return null/,
  '이전 연결 getPrices 응답을 새 연결 전역 상태에 적용하지 않음');
assert.match(index, /event_delegation\.js\?v=20261101-9/);
const sw = fs.readFileSync('src/web/sw.js', 'utf8');
assert.match(sw, /portfolio-cache-\d{8}-\d+/);
assert.match(sw, /components\.css\?v=20261102-1/);

// 새 관측성은 추가 호출을 만들지 않고 기존 단일 batch/read 경계를 계측한다.
const getPricesBody = gas.slice(gas.indexOf('function handleGetPricesCompat'), gas.indexOf('function _latestDateFromPriceDates'));
assert.equal((getPricesBody.match(/fetchPricesToss\(/g) || []).length, 1);
assert.equal((getPricesBody.match(/getLatestPriceHistoryEntries\(/g) || []).length, 1);
assert.equal((getPricesBody.match(/getPriceHistoryRow\(/g) || []).length, 2);
assert.doesNotMatch(getPricesBody, /forEach\([\s\S]{0,120}Date\.now\(\)/);

console.log('✅ NH 현재가 전체 경로·fallback·persist=false·smoke 회귀 검사 통과');

assert.match(gas, /tossAttempted: false/);
assert.match(gas, /tossStatus: 'NOT_RUN'/);
assert.match(gas, /lookupMeta\.tossStatus = 'ERROR'/);
assert.match(web, /data-price-detail="providers"/);
assert.match(web, /현재가 provider 상태/);

assert.match(gas, /!credentials\.key\|\|!credentials\.secret/);
assert.match(gas, /lookupMeta\.tossAttempted = !!tossProviderMeta\.attempted/);
assert.match(gas, /lookupMeta\.tossReason = tossProviderMeta\.reason \|\| ''/);

assert.doesNotMatch(gas,/openapi\.tossinvest\.com|function _tossRequest_|function handleSaveTossConfig/);
assert.doesNotMatch(web,/Toss|토스\s*API/);
