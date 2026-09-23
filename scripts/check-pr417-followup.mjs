import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
const fn=name=>{
  const start=gas.indexOf(`function ${name}(`); assert.notEqual(start,-1,`${name} 존재`);
  let brace=gas.indexOf('{',start),depth=0,end=brace;
  for(;end<gas.length;end++){ if(gas[end]==='{') depth++; else if(gas[end]==='}'&&!--depth){end++;break;} }
  return gas.slice(start,end);
};
const context={}; vm.createContext(context);
vm.runInContext(fn('_cleanCode'),context);
assert.equal(context._cleanCode('BRK.B'),'BRK.B');
assert.equal(context._cleanCode('BRK-B'),'BRK-B');
assert.notEqual(context._cleanCode('BRK.B'),context._cleanCode('BRK-B'));
assert.equal(context._cleanCode('5930'),'005930');
assert.equal(context._cleanCode('0046Y0'),'0046Y0');
assert.equal(context._cleanCode('F00001'),'F00001');

vm.runInContext("var CONFIG={TIMEZONE:'Asia/Seoul'};"+fn('_normalizeDate')+fn('_isConfirmedHistoryPrice_'),context);
assert.equal(context._isConfirmedHistoryPrice_({price:100,status:'CONFIRMED',priceType:'REGULAR_CLOSE',marketDate:'2026-09-22'},'2026-09-22'),true);
assert.equal(context._isConfirmedHistoryPrice_({price:100,status:'INDICATIVE',priceType:'REALTIME',marketDate:'2026-09-22'},'2026-09-22'),false);
assert.equal(context._isConfirmedHistoryPrice_({price:100,status:'CONFIRMED',priceType:'REGULAR_CLOSE',marketDate:'2026-09-21'},'2026-09-22'),false);

const compat=fn('handleGetPricesCompat');
assert.match(compat,/canPersistConfirmed = _isConfirmedHistoryPrice_\(val, saveDate\) \|\| String\(val\.source/);
assert.match(compat,/confirmedPersistDates\.length/);
assert.doesNotMatch(compat,/if \(persist && latestDisplayDate\) _rebuildSnapshotForDateFromHistory/);
const overseas=fn('fetchPricesYahooRegularClose');
assert.match(overseas,/row\.date === dateStr/);
assert.match(overseas,/source: 'YAHOO_REGULAR_CLOSE'/);
assert.match(overseas,/status: 'CONFIRMED'/);
const backup=fn('_backupSheetBeforeWrite');
assert.match(backup,/_readSystemBackupRegistry\(\)/);
assert.match(backup,/ss\.getSheetByName\(record\.name\)/);
assert.match(backup,/_sheetContentSignature\(candidate\) === expectedBackupSignature/);
assert.doesNotMatch(backup,/getProperty\(signatureKey\) === signature\) return/);
console.log('✅ PR #417 후속 해외 종가·INDICATIVE 차단·백업 검증·ticker 보존 회귀 검사 통과');
