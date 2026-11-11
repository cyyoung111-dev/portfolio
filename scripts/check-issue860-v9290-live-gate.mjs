#!/usr/bin/env node
// Strict offline 9.290 predeployment proof. No real GAS, HTTP, Sheets or deploy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {verifyIssue8609290LiveGate} from './issue860-v9290-live-gate.mjs';
import {composeIssue860Gas9290Preview} from './compose-issue860-gas9290-preview.mjs';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,
 assertIssue8609290Prerequisites} from './deploy-gas.mjs';

const {candidate,manifest}=composeIssue860Gas9290Preview();
assert.equal(manifest.candidateSourceGitBlob,'fa12c26b6b6d5f85d6d0e9f17d650a8824d0316c');
assert.equal(assertGasReleaseReady(candidate),'9.290');
assert.throws(()=>assertGasReleaseReady(candidate+'\nUNREVIEWED'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
for(const a of [
 {version:'9.290',eventName:'workflow_run',approved9290:true},
 {version:'9.290',eventName:'workflow_dispatch',approved9290:false},
 {version:'9.290',eventName:'workflow_dispatch',approved9289:true},
])assert.throws(()=>assertIssue507ManualReleasePermission(a),
 /GAS_9290_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.290',eventName:'workflow_dispatch',approved9290:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.290',eventName:'workflow_run',dryRun:true}));
for(const a of [
 {version:'9.290',publishedVersion:'9.288',liveGateVerified:true},
 {version:'9.290',publishedVersion:'9.290',liveGateVerified:true}
])assert.throws(()=>assertIssue8609290Prerequisites(a),/GAS_9290_REQUIRES_PUBLISHED_9289/);
assert.throws(()=>assertIssue8609290Prerequisites({
 version:'9.290',publishedVersion:'9.289',liveGateVerified:false
}),/GAS_9290_REQUIRES_LIVE_IDLE_AND_TRADE_V2_PROOF/);
assert.doesNotThrow(()=>assertIssue8609290Prerequisites({
 version:'9.290',publishedVersion:'9.289',liveGateVerified:true}));
assert.doesNotThrow(()=>assertIssue8609290Prerequisites({
 version:'9.290',publishedVersion:'9.288',dryRun:true}));

const workflow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=workflow.on.workflow_dispatch.inputs;
for(const n of ['use_9290_close_perf','approve_9290']){
 assert.equal(inputs[n].type,'boolean');
 assert.equal(inputs[n].default,false);
}
const steps=workflow.jobs.deploy.steps;
const index=steps.findIndex(x=>String(x.name||'').includes('before v9.290'));
const release=steps.findIndex(x=>x.name==='Deploy GAS');
assert(index>0&&index<release);
assert.equal(steps[index].run,'node scripts/issue860-v9290-live-gate.mjs');
assert.equal(steps[index]['continue-on-error'],undefined);
assert.match(steps[index].if,/GAS_9290_RELEASE_APPROVAL == 'true'/);
assert.match(steps[index].if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(steps[release].env.GAS_9290_LIVE_GATE_VERIFIED,/steps\.gas9290_gate\.outputs\.verified/);

const url='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const token='TEST_MOCK_PRIVATE_TOKEN';
const date='2026-11-10';
const base={
 status:'ok',gasVersion:'9.289',
 automation:{
  gasVersion:'9.289',overallStatus:'NORMAL',snapshotLastDate:date,
  priceHistoryLastDate:date,snapshotStale:false,pendingKrxCloseDates:[],
  portfolioCloseRunStale:false,pendingTradeSnapshotRebuildFrom:'',
  portfolioClose:{runDate:date,priceDate:date,priceRows:39,priceOk:true,fundOk:true,errors:[]},
  closeRun:{runDate:date,state:'COMPLETE',stage:'COMPLETE'},
  fundAttempt:{state:'DONE',date},tradeLedgerWriteUnverified:false,
  tradeSnapshotDeferredCount:0
 }
};
const trades=Array.from({length:338},(_,i)=>({id:'srv_'+i.toString(16).padStart(32,'0'),
 code:'005930',date,tradeType:'buy',qty:1,price:100}));
const good={getAutomationStatus:base,
 getTrades:{status:'ok',tradeLedgerProtocolVersion:2,
  ledgerRevision:'a'.repeat(64),trades},
 getWriterGateStatus:{status:'ok',gasVersion:'9.289',
  writerGate:{mode:'OPEN',activeCount:0,repairAuthorized:false}}};
async function exercise(payload=good,expectCalls=3){
 const seen=[];
 const result=await verifyIssue8609290LiveGate({
  url,token,now:new Date('2026-11-10T13:40:00Z'),
  fetchImpl:async(dest,options)=>{
   const isGate=options.method==='GET';
   const action=isGate?new URL(dest).searchParams.get('action'):options.body.get('action');
   const credential=isGate?new URL(dest).searchParams.get('accessToken'):options.body.get('accessToken');
   assert.equal(credential,token);
   seen.push(action);
   return {ok:true,json:async()=>payload[action]};
  }
 });
 const expectedSequence=expectCalls===4
  ?['getAutomationStatus','getTrades','diagnoseSnapshotIntegrity','getWriterGateStatus']
  :['getAutomationStatus','getTrades','getWriterGateStatus'];
 assert.deepEqual(seen,expectedSequence.slice(0,seen.length));
 return result;
}
const success=await exercise();
assert.equal(success.status,'VERIFIED');
assert.equal(success.tradeRows,338);
assert.equal(success.recordedActive,0);
assert.equal(success.financialWrites,0);
assert.equal(success.callCount,3);
assert(!JSON.stringify(success).includes('srv_'));
assert(!JSON.stringify(success).includes(token));
for(const [value,pattern] of [
 [{...good,getAutomationStatus:{...base,gasVersion:'9.288'}},/PUBLISHED_9289_UNVERIFIED/],
 [{...good,getAutomationStatus:{...base,
  automation:{...base.automation,closeRun:{...base.automation.closeRun,state:'INCOMPLETE',stage:'PRICE'}}}},/CLOSE_NOT_SETTLED/],
 [{...good,getAutomationStatus:{...base,
  automation:{...base.automation,portfolioClose:{...base.automation.portfolioClose,priceDate:'2026-11-09'}}}},/DATA_NOT_SETTLED/],
 [{...good,getTrades:{...good.getTrades,trades:[...trades.slice(0,-1),trades[0]]}},/TRADE_ID_UNVERIFIED/],
 [{...good,getTrades:{...good.getTrades,tradeLedgerProtocolVersion:1}},/TRADE_LEDGER_UNVERIFIED/],
 [{...good,getAutomationStatus:{...base,automation:{...base.automation,
  pendingTradeSnapshotRebuildFrom:'2026-11-10',overallStatus:'WARNING'}}},/DATA_NOT_SETTLED/],
 [{...good,getAutomationStatus:{...base,automation:{...base.automation,
  tradeSnapshotDeferredCount:1}}},/DATA_NOT_SETTLED/],
 [{...good,getAutomationStatus:{...base,automation:{...base.automation,
  tradeLedgerWriteUnverified:true}}},/DATA_NOT_SETTLED/],
 [{...good,getWriterGateStatus:{...good.getWriterGateStatus,
  writerGate:{...good.getWriterGateStatus.writerGate,activeCount:1}}},/WRITER_GATE_NOT_IDLE/]
]){
 await assert.rejects(()=>exercise(value),pattern);
}
// Close PRICE timeout must not block a safe *repair* deployment when the
// real RAW Snapshot audit independently matches trade/price/NAV/FX sources.
// It remains INCOMPLETE and the old fund attempt must never be called DONE.
const empty=[];
const rawDiagnostic={
 date,status:'VALID',expectedRowCount:39,storedRowCount:39,
 totalEvalDifference:0,
 missingCodes:[],unexpectedCodes:[],duplicateKeys:[],conflictKeys:[],
 qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],
 evalAmtMismatches:[],sourceMismatches:[],sourceDataErrors:[],
 priceIntegrity:[{status:'VALID'}],
 fundNavStates:[{code:'F00001',sourceDate:'2026-11-08',
   valueDate:'2026-11-08',temporary:true}]
};
const rawProof={status:'ok',diagnostics:[rawDiagnostic],
 diagnostic:{...rawDiagnostic}};
const recoverable={
 ...base,automation:{
  ...base.automation,overallStatus:'INCOMPLETE',
  expectedSnapshotDate:date,
  portfolioClose:{...base.automation.portfolioClose,
   runDate:'2026-11-09',priceDate:'2026-11-09'},
  closeRun:{runDate:date,state:'INCOMPLETE',stage:'PRICE'},
  fundAttempt:{state:'DONE',date:'2026-11-09'}
 }
};
const safeRepair={...good,getAutomationStatus:recoverable,
 diagnoseSnapshotIntegrity:rawProof};
const repair=await exercise(safeRepair,4);
assert.equal(repair.status,'VERIFIED');
assert.equal(repair.releaseSafety,'REPAIR_WITH_INDEPENDENT_RAW_SNAPSHOT_PROOF');
assert.equal(repair.closeFinality,'INCOMPLETE');
assert.equal(repair.fundFinality,'PENDING_UNVERIFIED');
assert.equal(repair.closeState,'INCOMPLETE');
assert.equal(repair.callCount,4);
assert.equal(repair.snapshotAudit.storedRows,39);
assert.equal(repair.snapshotAudit.carryRows,1);
assert.equal(repair.financialWrites,0);
for(const [payload,pattern] of [
 [{...safeRepair,diagnoseSnapshotIntegrity:{...rawProof,
  diagnostic:{...rawDiagnostic,status:'PARTIAL'},
  diagnostics:[{...rawDiagnostic,status:'PARTIAL'}]}},/SNAPSHOT_NOT_VERIFIED/],
 [{...safeRepair,diagnoseSnapshotIntegrity:{...rawProof,
  diagnostic:{...rawDiagnostic,duplicateKeys:['private']},
  diagnostics:[{...rawDiagnostic,duplicateKeys:['private']}]}},/SNAPSHOT_NOT_VERIFIED/],
 [{...safeRepair,diagnoseSnapshotIntegrity:{...rawProof,
  diagnostic:{...rawDiagnostic,priceIntegrity:[{status:'PRICE_SUSPICIOUS'}]},
  diagnostics:[{...rawDiagnostic,priceIntegrity:[{status:'PRICE_SUSPICIOUS'}]}]}},/SNAPSHOT_NOT_VERIFIED/],
 [{...safeRepair,getAutomationStatus:{...recoverable,
  automation:{...recoverable.automation,
   pendingTradeSnapshotRebuildFrom:'2026-11-10'}}},/DATA_NOT_SETTLED/],
 [{...safeRepair,getAutomationStatus:{...recoverable,
  automation:{...recoverable.automation,
   expectedSnapshotDate:'2026-11-09'}}},/DATA_NOT_SETTLED/],
 [{...safeRepair,getWriterGateStatus:{...good.getWriterGateStatus,
  writerGate:{...good.getWriterGateStatus.writerGate,activeCount:1}}},/WRITER_GATE_NOT_IDLE/],
 [{...safeRepair,getAutomationStatus:{...recoverable,
  automation:{...recoverable.automation,closeRun:{
    runDate:date,state:'INCOMPLETE',stage:'FUND_PENDING'}}}},/CLOSE_NOT_SETTLED/]
])await assert.rejects(()=>exercise(payload,4),pattern);

console.log(JSON.stringify({kind:'ISSUE860_9290_MANUAL_GATE_PASS',
 reviewedSourceSha:manifest.candidateSourceGitBlob,
 manualApprovalMandatory:true,published9289Mandatory:true,
 closeAndFundSameDateRequiredForCOMPLETE:true,
 repairRequiresIndependentRawSnapshot:true,ledgerV2ProofRequired:true,
 writerIdleRequired:true,apiCalls:3,financialWrites:0,deployments:0,
 telegramSends:0}));
