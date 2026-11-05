import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha} from './deploy-gas.mjs';

// The published v9.281 source was read-only audited as deployment version 336
// on 2026-11-03. This is an immutable source regression, NOT a live GAS check.
const baseline=fs.readFileSync('reference/gas-v9.281.gs','utf8');
const candidate=fs.readFileSync('reference/gas-v9.282.gs','utf8');
assert.equal(gasSourceBlobSha(baseline),'ebe697563e94cf49e514037353260fce70ae1d57',
  'published v9.281 audited baseline has changed');

// Strip only the generated writer-admission line and the candidate-only gate
// appendix; keep all original business logic byte-for-byte. Inline one-liners
// are handled separately from multi-line original functions.
const guard=String.raw`if \(typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_\) return _issue507GateInvoke_\('[\w]+', [\w]+, this, arguments\);`;
const originalCandidate=candidate
  .replace(new RegExp('^  '+guard+'\\n','gm'),'')
  .replace(new RegExp('\\n  '+guard+' ','g'),' ')
  .replace(/gasVersion:\s*'9\.282'/g,"gasVersion: '9.281'")
  .split('\n\nvar ISSUE507_GATE_RELEASE_ID=')[0];
function getFunctions(source){
  const rows=[...source.matchAll(/^function\s+([\w$]+)\s*\(/gm)];
  const data=new Map();
  for(let i=0;i<rows.length;i++){
    const name=rows[i][1],body=source.slice(rows[i].index,rows[i+1]?.index??source.length).trim();
    assert.ok(!data.has(name),'duplicate GAS function: '+name);
    data.set(name,body);
  }
  return data;
}
const before=getFunctions(baseline),after=getFunctions(originalCandidate);
assert.equal(before.size,555,'original published function count must be exact');
assert.equal(after.size,555,'candidate must preserve all v9.281 entrypoints');
for(const [name,body] of before)
  assert.equal(after.get(name),body,'candidate altered published v9.281 financial business function: '+name);

// Execute ONLY extracted deterministic helpers in an isolated, synthetic VM.
// The live Google Apps Script project, Sheets, tokens and Telegram are never accessed.
const activeFunctions=[
  '_earliestChangedTradeDate','_readPendingTradeSnapshotRebuild',
  '_setPendingTradeSnapshotRebuild','_latestConfirmedSnapshotDate',
  '_collectDailySnapshotDates'
];
const properties=new Map();
const normalizeDate=value=>{
  const raw=String(value??'').trim(),m=raw.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if(!m)return '';
  const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]),t=Date.UTC(y,month-1,day),d=new Date(t);
  return d.getUTCFullYear()===y&&d.getUTCMonth()===month-1&&d.getUTCDate()===day
    ?String(y).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'):'';
};
const dateOffset=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const sheet=rows=>({
  getLastRow:()=>rows.length+1,
  getLastColumn:()=>Math.max(1,...rows.map(row=>row.length)),
  getRange:(r,c,count,width)=>({getValues:()=>rows.slice(r-2,r-2+count)
    .map(row=>row.slice(c-1,c-1+width))})
});
// The sandbox must use sheet names from the actual, audited v9.281 source.
// A wrong hard-coded name could silently skip a source while tests pass.
function productionSheetName(key){
  const match=baseline.match(new RegExp('\\b'+key+'\\s*:\\s*\\x27([^\\x27]+)\\x27'));
  assert.ok(match,'v9.281 CONFIG sheet name missing: '+key);
  return match[1];
}
const navName=baseline.match(/^var FUND_NAV_SHEET\s*=\s*'([^']+)';$/m)?.[1];
assert.ok(navName,'v9.281 fund NAV sheet source not found');
const config={
  SHEET_SNAPSHOT:productionSheetName('SHEET_SNAPSHOT'),
  SHEET_PH:productionSheetName('SHEET_PH'),
  SHEET_TRADES:productionSheetName('SHEET_TRADES'),
  SHEET_ETF_DIVIDENDS:productionSheetName('SHEET_ETF_DIVIDENDS')
};
// Only NAV supplies Saturday; only ETF distribution history supplies Sunday.
// The weekday synthesis cannot make this test pass by coincidence.
const sheets={
  [config.SHEET_SNAPSHOT]:sheet([['2026-06-05'],['2026-06-09'],['2026-06-10']]),
  [config.SHEET_PH]:sheet([['2026-06-05'],['2026-06-09']]),
  [config.SHEET_TRADES]:sheet([['2026-06-05','buy','ISA','ETF','441800',10,100]]),
  [navName]:sheet([['2026-06-06','','','','2026-06-05']]),
  [config.SHEET_ETF_DIVIDENDS]:sheet([['','','','2026-06-07','2026-06-05']])
};
const context=vm.createContext({
  _normalizeDate:normalizeDate,_dateOffset:dateOffset,today:()=> '2026-06-10',
  CONFIG:config,
  FUND_NAV_SHEET:navName,
  _readSettingsMap:()=>({DIVDATA:{}}),
  PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>properties.get(k)||null,
    setProperty:(k,v)=>properties.set(k,v),
    deleteProperty:k=>properties.delete(k)
  })},
  TRADE_SNAPSHOT_REBUILD_PENDING_KEY:'trade_snapshot_rebuild_pending_v1',
});
for(const name of activeFunctions)
  vm.runInContext(before.get(name),context,{filename:'published-v9281-'+name+'.gs'});
const buy=['2026.6.5','buy','ISA','ETF','441800',10,100,'ETF','','',''];
const sale=['2026-06-09','sell','ISA','ETF','441800',3,140,'ETF','','',''];
const editBuy=[...buy];editBuy[6]=110;
const editSale=[...sale];editSale[5]=4;
assert.equal(context._earliestChangedTradeDate([buy,sale],[editBuy,sale]),'2026-06-05',
  'historical cost basis edit must replay from first affected buy date');
assert.equal(context._earliestChangedTradeDate([buy,sale],[buy,editSale]),'2026-06-09',
  'later sale qty change must not change earlier snapshots');
assert.equal(context._earliestChangedTradeDate([buy,sale],[buy]),'2026-06-09',
  'sale deletion must preserve earliest removed day');
assert.equal(context._earliestChangedTradeDate([buy,sale],[sale,buy]),'2026-06-05',
  'same ledger rows in changed chronology must still replay');
assert.equal(context._earliestChangedTradeDate([buy,sale],[buy,sale]),'');
const moveBuy=[...buy];moveBuy[0]='2026-06-04';
assert.equal(context._earliestChangedTradeDate([buy,sale],[moveBuy,sale]),'2026-06-04',
  'moving an old trade must start before both old and new dates');
context._setPendingTradeSnapshotRebuild('2026-06-09');
context._setPendingTradeSnapshotRebuild('2026-06-05');
context._setPendingTradeSnapshotRebuild('2026-06-08');
assert.equal(context._readPendingTradeSnapshotRebuild().from,'2026-06-05',
  'pending checkpoint cannot advance past an older unresolved trade');
assert.equal(context._latestConfirmedSnapshotDate({getSheetByName:n=>sheets[n]},false),'2026-06-09',
  'normal edits must not falsely treat current intraday Snapshot as confirmed');
assert.equal(context._latestConfirmedSnapshotDate({getSheetByName:n=>sheets[n]},true),'2026-06-10');
const range={getSheetByName:n=>sheets[n]||null};
assert.deepEqual(Object.keys(context._collectDailySnapshotDates(range,'2026-06-05','2026-06-10',{})).sort(),
  ['2026-06-05','2026-06-06','2026-06-07','2026-06-08','2026-06-09'],
  'NAV-only Saturday and dividend-only Sunday must survive, plus synthesized weekday; current day excluded');
assert.deepEqual(Object.keys(context._collectDailySnapshotDates(range,'2026-06-05','2026-06-10',{includeToday:true})).sort(),
  ['2026-06-05','2026-06-06','2026-06-07','2026-06-08','2026-06-09','2026-06-10']);

assert.ok(!Object.keys(context._collectDailySnapshotDates(
  {getSheetByName:n=>n===navName?null:sheets[n]||null},
  '2026-06-05','2026-06-10',{})).includes('2026-06-06'),
  'Saturday is NAV-only and must not be synthesized');
assert.ok(!Object.keys(context._collectDailySnapshotDates(
  {getSheetByName:n=>n===config.SHEET_ETF_DIVIDENDS?null:sheets[n]||null},
  '2026-06-05','2026-06-10',{})).includes('2026-06-07'),
  'Sunday is ETF-distribution-only and must not be synthesized');

// Enforce checkpoint-write → verified ledger write → dated Snapshot rebuild
// → fingerprint → pending clearance ordering on the actual v9.281 function.
const write=before.get('handleSyncTrades'),checkpoints=[
  '_setPendingTradeSnapshotRebuild(affectedFrom);',
  '_markTradeLedgerWriteUnverified_();',
  'sh.clearContents();',
  '_verifyTradeWrittenRange(',
  '_clearTradeLedgerWriteJournal_();',
  'snapshotRebuild = rebuildDailySnapshots(',
  '_recordTradeLedgerFingerprint_(ss);',
  '_clearPendingTradeSnapshotRebuild();'
];
let prev=-1;
for(const step of checkpoints){
  const next=write.indexOf(step,prev+1);
  assert.ok(next>prev,'v9.281 source checkpoint/order invalid: '+step);
  prev=next;
}
assert.match(write,/saveState: 'partial'[\s\S]*followupRequired: true/,
  'failed snapshot replay must not become a full trade-save success');
const worker=before.get('runPendingTradeSnapshotRebuild');
assert.match(worker,/ordered\.slice\(0,2\)/,'hourly worker has bounded two-date batch');
assert.match(before.get('_ensurePendingTradeSnapshotRebuildTrigger'),
  /everyHours\(1\)/,'restore worker must use hourly cadence');
assert.match(before.get('_getAutomationStatusData'),
  /tradeSnapshotDeferredCount[\s\S]*tradeSnapshotWorkerLastResult/,
  'v9.281 must expose aggregate pending/deferred information through read-only status');
assert.match(baseline,/if \(params\.action === 'getPortfolioSyncReceipt'\) return jsonError\('getPortfolioSyncReceipt 은 POST 전용입니다'\)/,
  'do not mistake the receipt POST read-only action for a public GET route');
assert.match(before.get('handleGetPortfolioSyncReceipt'),/receiptState:/);

console.log(JSON.stringify({
  mode:'IMMUTABLE_V9281_SYNTHETIC_SOURCE_ONLY',
  auditedPublishedVersion:'9.281',referenceFunctions:before.size,
  candidateBusinessFunctionsUnchanged:true,changedDayFloorVerified:true,
  pendingCheckpointVerified:true,incompleteTodayExcluded:true,
  sourceWeekdayCoverageVerified:true,receiptWriteRequests:0,
  sheetWrites:0,gasDeployments:0,
  workerBatchDatesPerRun:2,workerCadence:'HOURLY',
  liveRuntimeReadback:false,financialDataReconciliation:false
}));
