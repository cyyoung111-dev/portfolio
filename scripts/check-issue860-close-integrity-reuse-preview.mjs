#!/usr/bin/env node
// #860 offline parity and fail-closed proof; only in-memory GAS stubs.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {composeIssue860CloseIntegrityReusePreview} from './compose-issue860-close-integrity-reuse-preview.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';

const date='2026-11-10';
const good=[date,'005930','TEST',1,100,100,210,210,110,110,'NH_REGULAR_CLOSE',''];
function body(s,name) {
 const i=s.indexOf('function '+name+'('),j=s.indexOf('\n}',i);
 assert(i>=0&&j>i,'MISSING_FUNCTION:'+name);
 return s.slice(i,j+2);
}
function run(source,{preverified=false,input=good,inputs=null,stored=good,priceStatus='VALID'}={}) {
 const count={snapshotReads:0,calcBuilds:0,priceAudits:0};
 const ctx=vm.createContext({
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
  Array,Number,String,Math,Object,JSON,
  _issue507GateInside_:true,
  _normalizeDate:x=>String(x??'').slice(0,10),
  _cleanCode:x=>String(x??'').trim(),
  _snapshotIntegrityKey:r=>String(r?.[1]||''),
  _snapshotStoredNumber:(v,d)=>Number(Number(v??0).toFixed(d)),
  _readRawSnapshotRowsByDate:(_ss,d)=>{assert.equal(d,date);count.snapshotReads++;return [structuredClone(stored)];},
  _buildSnapshotRowsFromTradeAndPriceHistory:(_ss,d)=>{assert.equal(d,date);count.calcBuilds++;return [structuredClone(good)];},
  _classifyRawSnapshotDuplicateGroups:()=>[],
  _isFundCode:()=>false,
  getCodeItems:()=>[{code:'005930',currency:'KRW'}],
  diagnosePriceHistoryIntegrity:(_ss,dates)=>{assert.equal(dates[0],date);count.priceAudits++;return{rows:[{code:'005930',name:'TEST',status:priceStatus,sourceDate:date,storedPrice:210,currency:'KRW'}]};}
 });
 vm.runInContext(body(source,'diagnoseSnapshotIntegrity'),ctx);
 const res=preverified
  ?ctx.diagnoseSnapshotIntegrity({},date,undefined,undefined,inputs===null?[structuredClone(input)]:structuredClone(inputs))
  :ctx.diagnoseSnapshotIntegrity({},date);
 return {result:JSON.parse(JSON.stringify(res)),count};
}
const parent=composeIssue860Gas9289PerfCandidate().candidate;
assert.equal(assertGasReleaseReady(parent),'9.289');
const candidate=composeIssue860CloseIntegrityReusePreview(parent);
assert.throws(()=>assertGasReleaseReady(candidate.source),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.throws(()=>composeIssue860CloseIntegrityReusePreview(candidate.source),/ISSUE860_FINALITY_ALREADY_PATCHED/);
new vm.Script(candidate.source,{filename:'issue860-unapproved-close-finality.gs'});
const baseFuncs=new Map([...parent.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>[m[1],body(parent,m[1])]));
const nextFuncs=new Map([...candidate.source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>[m[1],body(candidate.source,m[1])]));
assert.deepEqual([...nextFuncs.keys()],[...baseFuncs.keys()]);
assert.deepEqual([...baseFuncs.keys()].filter(n=>baseFuncs.get(n)!==nextFuncs.get(n)).sort(),
 ['diagnoseSnapshotIntegrity','saveDailyPriceHistory']);
for(const protectedName of [
 '_readRawSnapshotRowsByDate','_readPriceIntegrityContext','diagnosePriceHistoryIntegrity',
 '_buildSnapshotRowsFromTradeAndPriceHistory','_snapshotRewritePlan',
 '_writeSnapshotDateScoped_','writeSnapshotRows','_backupSheetBeforeWrite',
 'runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
 'runDeferredFundAfterPortfolioCloseFailure','runTradeV2MigrationApply',
 'runTradeV2MigrationRestore','_refreshFundValuations'
])assert.equal(nextFuncs.get(protectedName),baseFuncs.get(protectedName),'PROTECTED_'+protectedName);
const close=nextFuncs.get('saveDailyPriceHistory');
assert.match(close,/diagnoseSnapshotIntegrity\(ss, snapshotDate, undefined, undefined, expected\)/);
assert.match(close,/_snapshotRewritePlan\(ss, snapshotDate, expected\)/);
assert.match(close,/if \(savedIntegrity.status !== 'VALID'\) throw/);
const baseline=run(parent);
const optimized=run(candidate.source,{preverified:true});
assert.deepEqual(optimized.result,baseline.result,'Full result and price/source arithmetic same');
assert.equal(baseline.count.calcBuilds,1);
assert.equal(optimized.count.calcBuilds,0);
assert.equal(optimized.count.snapshotReads,1,'Still independently reads persisted snapshot');
assert.equal(optimized.count.priceAudits,1,'Still validates price history');
const legacy=run(candidate.source);
assert.deepEqual(legacy.result,baseline.result,'Old diagnostic callers remain identical');
assert.equal(legacy.count.calcBuilds,1);
const mismatch=run(candidate.source,{preverified:true,stored:[...good.slice(0,7),999,...good.slice(8)]});
assert.equal(mismatch.result.status,'MISMATCH','Persisted value tampering must fail');
const badPrice=run(candidate.source,{preverified:true,priceStatus:'SUSPICIOUS'});
assert.equal(badPrice.result.status,'PRICE_SUSPICIOUS','Independent price-source audit retained');
for(const invalid of [
 [date,'','TEST',1,100,100,210,210,110,110,'NH_REGULAR_CLOSE',''],
 ['2026-11-09',...good.slice(1)],
 good.slice(0,11)
]){
 const rejected=run(candidate.source,{preverified:true,input:invalid});
 assert.equal(rejected.result.status,'SOURCE_INCOMPLETE','Untrusted preverified rows must fail');
 assert(rejected.result.sourceDataErrors.some(s=>s.includes('ISSUE860_INVALID_PREVERIFIED_ROWS')));
}
const duplicate=run(candidate.source,{preverified:true,inputs:[good,good]});
assert.equal(duplicate.result.status,'SOURCE_INCOMPLETE');
assert(duplicate.result.sourceDataErrors.some(s=>s.includes('ISSUE860_DUPLICATE_PREVERIFIED_ROWS')));
console.log(JSON.stringify({
 kind:'ISSUE860_CLOSE_INTEGRITY_REUSE_SOURCE_ONLY_PASS',
 originalExpectedRebuilds:baseline.count.calcBuilds,optimizedExpectedRebuilds:optimized.count.calcBuilds,
 independentSnapshotReads:optimized.count.snapshotReads,independentPriceAudits:optimized.count.priceAudits,
 persistedMismatchRejected:true,suspiciousPriceRejected:true,
 invalidInputRejected:true,legacyCallersSame:true,
 protectedBusinessFunctions:baseFuncs.size-2,productionApproved:false,
 financeWrites:0,gasDeployments:0,telegramSends:0
}));
