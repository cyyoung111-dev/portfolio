import assert from 'node:assert/strict';
import fs from 'node:fs';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');

assert.match(gas, /function _normalizeTossSymbol_\(value\)/);
assert.match(gas, /var symbol = _normalizeTossSymbol_\(row\.symbol\)/);
assert.match(gas, /Number\.isFinite\(price\) && price > 0/);
assert.match(gas, /var val = \(tossPrices\[code\] && tossPrices\[code\]\.price > 0\)/);
assert.match(gas, /var krxItems = targetItems\.filter/);
assert.match(gas, /usedDate: usedDate/);
assert.match(gas, /latestEntry\.date > priceDates\[code\]/);
assert.match(gas, /var cacheRaw = todayStr \+ '\|p=' \+ \(persist \? '1' : '0'\)/);
assert.match(gas, /prices_v9108_p' \+ \(persist \? '1' : '0'\)/);
assert.match(gas, /cachedPayload\.priceLookup\.snapshotCreated = persist && cachedLatestDate/);
assert.match(gas, /if \(persist\) Object\.keys\(newItemsByDate\)/);
assert.match(gas, /if \(persist\) _updateTodaySnapshotSource/);
assert.match(gas, /if \(persist && latestDisplayDate\) _rebuildSnapshotForDateFromHistory/);
const currentPriceBody = gas.slice(gas.indexOf('function handleGetPricesCompat'), gas.indexOf('function _latestDateFromPriceDates'));
assert.doesNotMatch(currentPriceBody, /fetchPricesGoogleFinance\(/, '현재가 경로에서 GOOGLEFINANCE fallback을 사용하면 안 됩니다');
assert.match(gas, /function _tossPriceSmoke_\(\)/);
assert.match(gas, /symbols=005930/);
assert.match(gas, /validLastPrice: Number\.isFinite\(price\) && price > 0/);
assert.match(gas, /timestampPresent: !!\(row && row\.timestamp\)/);
assert.doesNotMatch(gas.match(/function _tossPriceSmoke_\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || '', /Logger\.log|PropertiesService|setValue|setValues|appendRow/i);
assert.match(web, /현재가 갱신 · \$\{Object\.keys\(results\)\.length\}개 · 화면만 반영/);
assert.match(web, /저장 이력\/Snapshot 미변경/);
assert.match(web, /Toss \$\{toss\}건/);

console.log('✅ Toss 현재가 전체 경로·fallback·persist=false·smoke 회귀 검사 통과');
