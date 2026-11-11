#!/usr/bin/env node
// Pure in-memory review. No Apps Script, KRX requests, Sheet writes or deploy.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9292CloseOptimizationPreview}
 from './compose-issue860-gas9292-close-optimization-preview.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';
import {CURRENT_INDEX_ENDPOINT,PROPOSED_DERIVATIVE_ENDPOINT,gitBlobSha}
 from './compose-gas-vkospi-derivative-proposal.mjs';

const {parentSource:original,candidate,manifest}=composeIssue860Gas9292CloseOptimizationPreview();
assert.equal(manifest.baseVersion,'9.291');
assert.equal(manifest.candidateVersion,'9.292');
assert.equal(manifest.deployable,false);
assert.equal(manifest.sourceOnly,true);
assert.deepEqual([manifest.financeWrites,manifest.gasRequests,
 manifest.gasDeployments,manifest.telegramSends],[0,0,0,0]);
assert.equal(gitBlobSha(original),manifest.parentGitBlob);
assert.equal(gitBlobSha(candidate),manifest.candidateGitBlob);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_SOURCE_NOT_APPROVED/,
 'unreviewed v9.292 source cannot be deployed');
new vm.Script(candidate,{filename:'gas-v9292-source-only.gs'});
assert(original.includes(CURRENT_INDEX_ENDPOINT));
assert(candidate.includes(PROPOSED_DERIVATIVE_ENDPOINT));
const getBody=(source,name)=>{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
 assert(start>=0&&end>start,'MISSING_FUNCTION_'+name);
 return source.slice(start,end+2);
};
const getFunctions=source=>new Map(
 [...source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)]
 .map(m=>[m[1],getBody(source,m[1])]));
const prior=getFunctions(original),next=getFunctions(candidate);
assert.deepEqual([...prior.keys()],[...next.keys()]);
const changed=[...prior.keys()].filter(k=>prior.get(k)!==next.get(k)).sort();
assert.deepEqual(changed,manifest.changedBusinessFunctions.slice().sort(),
 'no finance writer, trading, fund lease, watchdog or other helper may change');
for(const name of ['_readRawSnapshotRowsByDate','diagnosePriceHistoryIntegrity',
 '_buildSnapshotRowsFromTradeAndPriceHistory','_writeSnapshotDateScoped_',
 'writeSnapshotRows','_portfolioFundAtomic_','runDailyPortfolioClose1900',
 'runPortfolioCloseWatchdog2030','runDeferredFundAfterPortfolioCloseFailure',
 'runTradeV2MigrationApply','runTradeV2MigrationRestore',
 '_refreshFundValuations']){
 assert.equal(prior.get(name),next.get(name),'PROTECTED_FUNCTION_'+name);
}
const price=next.get('saveDailyPriceHistory');
assert.match(price,/_snapshotRewritePlan\(ss, snapshotDate, expected\)/);
assert.match(price,/diagnoseSnapshotIntegrity\(ss, snapshotDate, undefined, undefined, expected\)/);
assert.match(price,/if \(savedIntegrity.status !== 'VALID'\) throw/);
const diag=next.get('diagnoseSnapshotIntegrity');
assert.match(diag,/_readRawSnapshotRowsByDate\(ss, date\)/);
assert.match(diag,/diagnosePriceHistoryIntegrity\(/);
assert.match(diag,/ISSUE860_INVALID_PREVERIFIED_ROWS/);
const vkospi=next.get('_readVkospiPointsFromKrx');
assert.match(vkospi,/\/svc\/apis\/idx\/drvprod_dd_trd/);
assert.match(vkospi,/vkospi_v3_/);
assert.doesNotMatch(vkospi,/vkospi_day_v2_/);

// Exercise the SAME v9.291/v9.292 function with a synthetic persisted
// Snapshot; only its second identical expected-row rebuild must disappear.
const date='2026-11-10';
const row=[date,'005930','TEST',1,100,100,210,210,110,110,'NH_REGULAR_CLOSE',''];
function audit(source,preverified=false,stored=row){
 const count={read:0,calculate:0,price:0};
 const env=vm.createContext({
  CONFIG:{SHEET_SNAPSHOT:'스냅샷'},
  Array,Number,String,Math,Object,JSON,_issue507GateInside_:true,
  _normalizeDate:s=>String(s||'').slice(0,10),
  _cleanCode:s=>String(s||'').trim(),
  _snapshotIntegrityKey:r=>String(r?.[1]||''),
  _snapshotStoredNumber:(v,d)=>Number(Number(v||0).toFixed(d)),
  _readRawSnapshotRowsByDate:()=>{count.read++;return [structuredClone(stored)];},
  _buildSnapshotRowsFromTradeAndPriceHistory:()=>{count.calculate++;return [structuredClone(row)];},
  _classifyRawSnapshotDuplicateGroups:()=>[],
  _isFundCode:()=>false,
  getCodeItems:()=>[{code:'005930',currency:'KRW'}],
  diagnosePriceHistoryIntegrity:()=>{count.price++;return{rows:[{
    code:'005930',name:'TEST',status:'VALID',sourceDate:date,
    storedPrice:210,currency:'KRW'}]};}
 });
 vm.runInContext(getBody(source,'diagnoseSnapshotIntegrity'),env);
 const r=preverified?env.diagnoseSnapshotIntegrity({},date,undefined,undefined,
  [structuredClone(row)]):env.diagnoseSnapshotIntegrity({},date);
 return {count,result:JSON.parse(JSON.stringify(r))};
}
const before=audit(original),after=audit(candidate,true);
assert.equal(before.result.status,'VALID');
assert.deepEqual(after.result,before.result);
assert.deepEqual(before.count,{read:1,calculate:1,price:1});
assert.deepEqual(after.count,{read:1,calculate:0,price:1});
const legacy=audit(candidate);
assert.deepEqual(legacy.result,before.result);
assert.equal(legacy.count.calculate,1);
assert.equal(audit(candidate,true,[...row.slice(0,7),999,...row.slice(8)]).result.status,'MISMATCH');
console.log('ISSUE860_9292_CLOSE_SPEED_SOURCE_ONLY_PASS exact_9291_sha protected_functions_unchanged persisted_snapshot_and_price_audit_retained duplicate_rebuild_removed vkospi_corrected deployable_false');
