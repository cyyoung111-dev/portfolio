import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const runtime=fs.readFileSync('src/web/domain/market/market_briefing_runtime.js','utf8');
const store=fs.readFileSync('src/web/domain/market/market_briefing_runtime_store.js','utf8');
const bootstrap=fs.readFileSync('src/web/app/bootstrap.js','utf8');
const master=fs.readFileSync('src/web/domain/market/market_briefing_master.js','utf8');
assert.match(gas,/MARKET_BRIEFING_MASTER_SHEET = 'MARKET_MASTER'/);
assert.match(gas,/appendMarketBriefingObservations/);
assert.match(gas,/getMarketBriefingMaster/);
assert.match(gas,/readActions = \[[^\]]*'getExchangeRateHistory'[^\]]*'getMarketBriefingMaster'[^\]]*'getMarketBriefingSnapshots'/);
assert.match(gas,/function handleAppendMarketBriefingObservations/);
assert.match(gas,/function handleGetMarketBriefingMaster/);
assert.match(gas,/LockService\.getScriptLock\(\)/);
assert.match(gas,/_normalizeDate\(r\[1\]\)\|\|''/);
assert.match(gas,/\[seriesId,tradingDate,String\(r\.session\|\|'UNKNOWN'\),observedAt,receivedAt\]\.join\('\|'\)/);
assert.match(gas,/MARKET_BRIEFING_TIMESTAMP_RE/);
assert.match(gas,/function _marketBriefingIsoTimestamp_/);
assert.match(gas,/observedMs > receivedMs/);
assert.match(gas,/reject\('OBSERVED_AFTER_RECEIVED'\)/);
assert.match(gas,/timestampQuality=observedAt \? 'OBSERVED' : 'RECEIVE_ONLY'/);
assert.match(gas,/lagSeconds=observedAt \? Math\.round\(\(receivedMs-observedMs\)\/1000\) : null/);
assert.match(gas,/timestampQuality:observedAt\?'OBSERVED':'RECEIVE_ONLY'/);
assert.match(gas,/rejected: rejected, rejectionReasons: rejectionReasons/);
assert.match(gas,/'currency','source_date','fallback'/);
assert.match(gas,/currency:r\[14\]\|\|null,sourceDate:_normalizeDate\(r\[15\]\|\|''\)\|\|null,fallback:/);
assert.doesNotMatch(gas,/observedAt\s*=\s*receivedAt/);
assert.match(master,/observedAt must not be after receivedAt/);

const sheetRows=[['series_id','trading_date','value','market','session','source','status','finality','observed_at','received_at','timestamp_quality','lag_seconds','revision','quality']];
const sheet={getLastRow:()=>sheetRows.length,getLastColumn:()=>Math.max(...sheetRows.map(row=>row.length)),getRange:(r,c,n=1,m=1)=>({
  getValues:()=>Array.from({length:n},(_,ri)=>Array.from({length:m},(_,ci)=>sheetRows[r-1+ri]?.[c-1+ci]??'')),
  setValues:(values)=>values.forEach((row,ri)=>row.forEach((value,ci)=>{sheetRows[r-1+ri]??=[];sheetRows[r-1+ri][c-1+ci]=value;})),
  setValue:(value)=>{sheetRows[r-1]??=[];sheetRows[r-1][c-1]=value;}
})};
const ss={getSheetByName:(name)=>name==='MARKET_MASTER'?sheet:null};
const context=vm.createContext({console,LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},ContentService:{MimeType:{JSON:'JSON'},createTextOutput:(value)=>({value,setMimeType(){return this;},getContent(){return this.value;}})}});
new vm.Script(gas).runInContext(context);context.getss=()=>ss;
const sample={seriesId:'KOSPI',tradingDate:'2026-09-18',value:3400,market:'KRX',session:'REGULAR',source:'TOSS',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:'2026-09-18T06:30:00.000Z',receivedAt:'2026-09-18T06:31:00.000Z',currency:'KRW',sourceDate:'2026-09-18',fallback:true};
assert.equal(JSON.parse(context.handleAppendMarketBriefingObservations(JSON.stringify([sample])).getContent()).saved,1);
const roundTrip=JSON.parse(context.handleGetMarketBriefingMaster('2026-09-18','2026-09-18','').getContent()).observations[0];
assert.equal(roundTrip.currency,'KRW');assert.equal(roundTrip.sourceDate,'2026-09-18');assert.equal(roundTrip.fallback,true);assert.equal(roundTrip.observedAt,'2026-09-18T06:30:00.000Z');assert.equal(roundTrip.receivedAt,'2026-09-18T06:31:00.000Z');assert.equal(roundTrip.timestampQuality,'OBSERVED');
console.log('MARKET_MASTER append-only 서버 영속화/중복방지/timestamp 품질 계약 통과');

assert.match(store,/function mergeObservations/);
assert.match(runtime,/async function syncServerMaster/);
assert.match(runtime,/getMarketBriefingMaster/);
assert.match(runtime,/appendMarketBriefingObservations/);
assert.match(bootstrap,/runtime\.syncServerMaster/);

assert.match(gas,/MARKET_BRIEFING_SNAPSHOT_SHEET = 'MARKET_SNAPSHOTS'/);
assert.match(gas,/function handleAppendMarketBriefingSnapshot/);
assert.match(gas,/function handleGetMarketBriefingSnapshots/);
assert.match(gas,/asOf!==expectedAsOf/);
assert.match(gas,/return jsonOk\(\{saved:0,immutable:true\}\)/);
assert.match(gas,/snapshots:out,invalid:invalid/);
assert.match(runtime,/getMarketBriefingSnapshots/);
assert.match(runtime,/snap\.status!=='ok'/);
assert.match(runtime,/snapshotSync=\{status:'error'/);
assert.match(runtime,/releaseAndPersist/);
assert.match(runtime,/persistence\.status!=='ok'/);
assert.match(store,/function mergeSnapshots/);
assert.match(bootstrap,/market_briefing_runtime\.js\?v=20260929-4/);
console.log('MARKET_SNAPSHOTS 불변 저장/검증/hydrate 계약 통과');
