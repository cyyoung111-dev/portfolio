// Exact approved-source GAS v9.285 preview regression. No live API/writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha,extractExpectedGasVersion,assertGasReleaseReady} from './deploy-gas.mjs';
import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import {composeGas9285FundNoopPreview} from './compose-gas9285-fund-noop-preview.mjs';

const {base,candidate,manifest}=composeGas9285FundNoopPreview();
assert.equal(base,fs.readFileSync('src/gas/apps_script.gs','utf8'),
 'existing live v9.284 release must stay untouched');
assert.equal(gasSourceBlobSha(base),manifest.baseSourceGitBlob);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceGitBlob);
assert.notEqual(candidate,base);
assert.equal(extractExpectedGasVersion(base),'9.284');
assert.equal(extractExpectedGasVersion(candidate),'9.285');
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasProjectWrites,0);
assert.equal((candidate.match(/gasVersion: '9\.285'/g)||[]).length,9);
assert.match(candidate,/var ISSUE507_GATE_API_VERSION='9\.285'/);

const releasePlan=JSON.parse(fs.readFileSync('ops/issue860/release-gas9285.json','utf8'));
assert.equal(releasePlan.version,'9.285');
assert.equal(releasePlan.purpose,'FUND_VERIFIED_NOOP_ONLY');
assert.equal(releasePlan.parentVersion,'9.284');
assert.equal(releasePlan.parentSourceGitBlob,manifest.baseSourceGitBlob);
assert.equal(releasePlan.candidateSourceGitBlob,manifest.candidateSourceGitBlob);
assert.equal(releasePlan.candidateSourceGitBlob,'954fd4aeae767ddac0cb161d3a81003b5b699d1c');
assert.equal(releasePlan.includesTradeLedgerV2,false);
assert.equal(releasePlan.tradeLedgerV2MinimumTargetVersion,'9.286');
assert.equal(releasePlan.approval.sourcePromotion,false);
assert.equal(releasePlan.approval.operationalRelease,false);
assert.equal(releasePlan.approval.financialWrites,false);
assert.equal(releasePlan.approval.deployInventoryReady,false);
assert.equal(releasePlan.approval.webClientVersionReady,false);
assert.equal(releasePlan.approval.manualDryRunPassed,false);
assert.equal(releasePlan.approval.appsScriptExecutionVerified,false);
// A green offline candidate test is not an authorization to ship GAS.
assert.equal(assertGasReleaseReady(base),'9.284');
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION/);
const currentWeb=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
assert.match(currentWeb,/const EXPECTED_GAS_VERSION = '9\\.284';/,
 'web consumer still expects the live GAS, not this unreleased candidate');
const gateReleaseId=s=>s.match(/var ISSUE507_GATE_RELEASE_ID='([a-f0-9]{64})'/)?.[1]||'';
assert.match(gateReleaseId(base),/^[a-f0-9]{64}$/);
assert.equal(gateReleaseId(candidate),gateReleaseId(base),
 'existing writer gate release id must not drift');
const entrypointCount=s=>[...s.matchAll(/^function [A-Za-z_$][\\w$]*\\s*\\(/gm)].length;
assert.equal(entrypointCount(candidate),entrypointCount(base),
 'fund no-op cannot add GAS public entrypoints');
new vm.Script(candidate,{filename:'gas-9285-fund-noop-preview.gs'});

const source=isolateGasBusinessLogic(candidate);
const start=source.indexOf('function _refreshFundValuations(');
const end=source.indexOf('\n}',start);
assert(start>0&&end>start);
const realFunction=source.slice(start,end+2);
assert.match(realFunction,/if \(values\.length === 0\)[\s\S]*?return unchanged;/);
assert.match(realFunction,/var writeLock = LockService\.getScriptLock\(\);/);
assert.ok(realFunction.indexOf('return unchanged;')<realFunction.indexOf('getScriptLock()'),
 'no-op check must precede writer lock');
assert.equal(realFunction.indexOf('if (values.length === 0)'),
 realFunction.lastIndexOf('if (values.length === 0)'));

const older='2026-11-05',date='2026-11-06',weekend='2026-11-07',today='2026-11-08';
const nav=[older,'F00002','KB_TEST',2169.72,older,1000,2169.72,'','KB_VALUE_ST'];
let published=false,lockCount=0,writeCount=0,readCount=0;
const pendingDerivedDates=new Set();
const conf={code:'F00002',name:'KB_TEST',provider:'KB_VALUE_ST',units:1000,startDate:older};
const rows=()=>published?[{date:older,nav:2169.72},{date,nav:2050.08}]
 :[{date:older,nav:2169.72}];
const dateOffset=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const sheet={
 getLastRow:()=>2,
 getRange:()=>({getValues:()=>{readCount++;return [nav]},setValues:()=>{writeCount++;}})
};
const ss={getSheetByName:()=>sheet};
const ctx=vm.createContext({
  Date,JSON,Number,String,Array,Object,isFinite,
  FUND_NAV_SHEET:'펀드기준가격',CONFIG:{SHEET_PH:'가격이력'},
  FUND_PROVIDERS:{KB_VALUE_ST:{source:'FUNETF'}},
  today:()=>today,_fundDate:d=>d,_fundDateOffset:dateOffset,
  _normalizeDate:d=>String(d||''),
  _fundRecoveryDiagnosticStart:()=>{},_fundRecoveryDiagnosticFinish:()=>{},
  _readFundUnits:()=>[conf],_fundDerivedState:()=>({
    sheet:null,prices:[],priceKeys:{},snapshotKeys:{}
  }),
  _fundUnitsAtDate:(_confs,_code,_day)=>conf,
  _storedFundNavRows:()=>rows(),
  _fundNavExpectedPublicationDate:(d)=>d===older||d===date,
  _fundDailyValues:(_confs,code,navRows,from,to)=>[older,date,weekend].filter(d=>d>=from&&d<=to).map(d=>{
    const latest=navRows.filter(n=>n.date<=d).at(-1);
    return {date:d,code,name:'KB_TEST',nav:latest.nav,sourceDate:latest.date,
      units:1000,evalAmt:Math.round(latest.nav),provider:'KB_VALUE_ST'};
  }),
  _fundValueNeedsProcessing:value=>pendingDerivedDates.has(value.date),
  _fetchMissingFundNavBatches:()=>{throw Error('UNEXPECTED_NAV_FETCH')},
  LockService:{getScriptLock:()=>{lockCount++;throw Error('EXPECTED_WRITER_PATH')}},
  SpreadsheetApp:{flush:()=>{writeCount++;}}
});
vm.runInContext(realFunction,ctx);
let done=ctx._refreshFundValuations(ss,older,date,undefined,true);
assert.equal(done.completionStatus,'partial',
 'official NAV missing remains PARTIAL even if carry derived rows already match');
assert.equal(done.fundResults.F00002.navMissing,1);
assert.deepEqual([...done.fundResults.F00002.inputRequiredDates],[date]);
assert.equal(done.processing.nav.pending,1);
assert.equal(done.fundResults.F00002.valuations,0);
assert.equal(done.fundResults.F00002.completedSkipped,2);
assert.equal(done.processing.snapshots.processed,0);
assert.equal(done.saved,0);
assert.equal(done.continuation,false);
assert.equal(lockCount,0);
assert.equal(writeCount,0);
assert.equal(readCount,1,'initial NAV proof is still read and validated once');
published=true;
done=ctx._refreshFundValuations(ss,older,date,undefined,true);
assert.equal(done.completionStatus,'ok');
assert.equal(done.fundResults.F00002.navMissing,0);
assert.equal(done.fundResults.F00002.valuations,0);
assert.equal(done.fundResults.F00002.completedSkipped,2);
assert.equal(done.navSaved,0);
assert.equal(lockCount,0);
assert.equal(writeCount,0);
// An uncommitted 11/07 weekend carry Snapshot must NOT be treated as no-op.
pendingDerivedDates.add(weekend);
assert.throws(()=>ctx._refreshFundValuations(ss,older,weekend,undefined,true),
 /EXPECTED_WRITER_PATH/,
 'missing 11/07 weekend carry Snapshot must enter the protected writer');
assert.equal(lockCount,1);
pendingDerivedDates.clear();
pendingDerivedDates.add(date);
assert.throws(()=>ctx._refreshFundValuations(ss,older,date,undefined,true),
 /EXPECTED_WRITER_PATH/,
 'newly corrected official source must enter protected writer');
assert.equal(lockCount,2);
pendingDerivedDates.clear();
done=ctx._refreshFundValuations(ss,older,weekend,undefined,true);
assert.equal(done.completionStatus,'ok');
assert.equal(done.fundResults.F00002.valuations,0);
assert.equal(done.fundResults.F00002.completedSkipped,3);
assert.equal(done.fundResults.F00002.dates.find(x=>x.date===weekend).navState,
 'NON_PUBLICATION_CARRY','2026-11-07 Saturday carries last confirmed 11/06 NAV');
assert.equal(lockCount,2,'fully reconciled weekend must not acquire writer');
assert.equal(writeCount,0,'simulation cannot write financial data');
console.log('GAS9285_FUND_NOOP_PREVIEW_OK '+JSON.stringify({
 originalSourceBlob:manifest.baseSourceGitBlob,
 candidateSourceBlob:manifest.candidateSourceGitBlob,
 previewOnly:true,productionGasDeployed:false,financeWrites:0,
 cases:['confirmed_noop','missing_publication_partial','weekend_carry_uncommitted_requires_writer','actual_change_lock_preserved']
}));
