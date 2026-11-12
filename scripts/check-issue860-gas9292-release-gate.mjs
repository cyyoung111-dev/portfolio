#!/usr/bin/env node
// #860 9.292 source pin + manual release + live pre/post deployment contracts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeIssue860Gas9292CloseStatePreview} from './compose-issue860-gas9292-close-state-preview.mjs';
import {assertGasReleaseReady,gasSourceBlobSha,
 assertIssue507ManualReleasePermission,assertIssue8609292Prerequisites} from './deploy-gas.mjs';
import {assessGas9292Preflight} from './issue860-gas9292-predeploy-readonly.mjs';
import {assessGas9292PostDeploy,verifyGas9292PostDeployWithRetry} from './issue860-gas9292-postdeploy-readonly.mjs';
import {assertPublishedReleaseFundNavSupport} from './issue860-fund-nav-release-compat.mjs';

const {parent,source,manifest}=composeIssue860Gas9292CloseStatePreview();
assert.equal(gasSourceBlobSha(parent),'e9311667d513c1e43a8ed1af326a3ecdb9d1ca70');
assert.equal(manifest.candidateGitBlob,'a1fc71cd26616be250b4e07cceacbc73995be98e');
assert.equal(gasSourceBlobSha(source),manifest.candidateGitBlob);
assert.equal(assertGasReleaseReady(source),'9.292');
assert.throws(()=>assertGasReleaseReady(source+'\n// unexpected edit'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.deepEqual(manifest.changedFinancialWriters,[]);
assert.deepEqual(manifest.changedWatchdogFunctions,[]);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.292'),
 {version:'9.292',kb:true,hanwha:true,financialWrites:0});

for(const args of [
 {version:'9.292',eventName:'push',approved9292:true},
 {version:'9.292',eventName:'workflow_run',approved9292:true},
 {version:'9.292',eventName:'workflow_dispatch',approved9292:false}
])assert.throws(()=>assertIssue507ManualReleasePermission(args),
 /GAS_9292_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.292',eventName:'workflow_dispatch',approved9292:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.292',eventName:'workflow_dispatch',dryRun:true}));
assert.throws(()=>assertIssue8609292Prerequisites({
 version:'9.292',publishedVersion:'9.289',liveCloseGateVerified:true}),
 /GAS_9292_REQUIRES_PUBLISHED_9291/);
assert.throws(()=>assertIssue8609292Prerequisites({
 version:'9.292',publishedVersion:'9.291',liveCloseGateVerified:false}),
 /GAS_9292_REQUIRES_SETTLED_CLOSE_AND_BOUNDED_GATE_PROOF/);
assert.doesNotThrow(()=>assertIssue8609292Prerequisites({
 version:'9.292',publishedVersion:'9.291',liveCloseGateVerified:true}));
assert.doesNotThrow(()=>assertIssue8609292Prerequisites({
 version:'9.292',publishedVersion:'9.289',dryRun:true}));

const DATE='2026-11-11';
const close={gasVersion:'9.291',closeState:'COMPLETE',closeStage:'COMPLETE',
 closeComplete:true,priceOk:true,fundOk:true,fundAttemptState:'DONE',
 fundErrorPresent:false,snapshotStale:false,storedPriceRows:39,
 closeRunDate:DATE,storedPriceDate:DATE,snapshotLastDate:DATE,
 priceHistoryLastDate:DATE,fundAttemptDate:DATE,pendingKrxDatesCount:0};
const gate={gasVersion:'9.291',gateMode:'OPEN',recordedActive:1};
const ledger={status:'ok',tradeLedgerProtocolVersion:2,
 ledgerRevision:'a'.repeat(64),trades:[{id:'tr_123456'}]};
const ready=assessGas9292Preflight(close,gate,ledger);
assert.equal(ready.status,'VERIFIED');
assert.equal(ready.gateRecordedActive,1);
assert.equal(ready.gateIdleNotRequired,true);
assert.equal(ready.financialWrites,0);
for(const wrong of [
 {...close,closeState:'INCOMPLETE'}, {...close,fundOk:false},
 {...close,priceOk:false},{...close,snapshotLastDate:'2026-11-10'},
 {...close,pendingKrxDatesCount:1},{...close,storedPriceRows:0},
 {...close,fundErrorPresent:true}
])assert.throws(()=>assessGas9292Preflight(wrong,gate,ledger),
 /CLOSE_SETTLEMENT_UNVERIFIED/);
for(const badGate of [{...gate,recordedActive:3},
 {...gate,gateMode:'DRAINING'},{...gate,gasVersion:'9.289'}])
 assert.throws(()=>assessGas9292Preflight(close,badGate,ledger));
assert.throws(()=>assessGas9292Preflight(close,gate,{...ledger,
 tradeLedgerProtocolVersion:1}),/TRADE_LEDGER_V2_UNVERIFIED/);

const settings={gasVersion:'9.292',settings:{}};
const owner={functionName:'runDailyPortfolioClose1900',
 startedKst:'2026-11-12 10:40:00',ageMinutes:1,
 terminalReceiptPresent:false,retirementEligible:false};
const remoteGate={gasVersion:'9.292',writerGate:{mode:'OPEN',
 repairAuthorized:false,activeCount:1,activeOwners:[owner],
 expiredUnconfirmedCount:1,timeoutRetirementCandidates:0}};
const good=assessGas9292PostDeploy({settings,ledger,gate:remoteGate});
assert.equal(good.status,'VERIFIED');
assert.equal(good.tradeLedgerVersion,2);
assert.equal(good.gateOwnerDiagnosticsAvailable,true);
assert.equal(good.reconciliationState,'NO_EXPIRED_ACTIVE_LEASES');
const awaiting=assessGas9292PostDeploy({settings,ledger,gate:{
 ...remoteGate,writerGate:{...remoteGate.writerGate,
  timeoutRetirementCandidates:1,
  activeOwners:[{...owner,ageMinutes:57,retirementEligible:true}]}
}});
assert.equal(awaiting.status,'VERIFIED',
 'a published source with old receipts may only reconcile at the next writer');
assert.equal(awaiting.reconciliationState,'AWAITING_NEXT_NORMAL_WRITER');
assert.equal(awaiting.timeoutRetirementCandidates,1);
assert.equal(awaiting.recordedActive,1,'postdeploy GET never invents idle state');
assert.equal(awaiting.financeWrites,0);
for(const invalid of [
 {...remoteGate,gasVersion:'9.291'},
 {...remoteGate,writerGate:{...remoteGate.writerGate,
  activeOwners:[{...owner,retirementEligible:true}]}},
 {...remoteGate,writerGate:{...remoteGate.writerGate,
  activeOwners:[]}},
 {...remoteGate,writerGate:{...remoteGate.writerGate,
  activeOwners:[{...owner,ageMinutes:-1}]}},
 {...remoteGate,writerGate:{...remoteGate.writerGate,
  mode:'DRAINING'}}
])assert.throws(()=>assessGas9292PostDeploy({
 settings,ledger,gate:invalid}));

// A completed 9.292 deployment can intermittently serve the previous
// web-app instance. Only that exact stale-version response may be retried.
let tries=0;const delays=[];
const recovered=await verifyGas9292PostDeployWithRetry({
 verify:async()=>{
  tries++;
  if(tries<3)throw Error('ISSUE860_9292_POSTDEPLOY_PREVIOUS_VERSION_WARM');
  return good;
 },
 delay:async ms=>{delays.push(ms);},maxAttempts:5
});
assert.equal(tries,3);
assert.equal(recovered.gasVersion,'9.292');
assert.equal(recovered.readbackAttempts,3);
assert.deepEqual(delays,[3000,6000]);
assert.equal(recovered.gasDeployments,0);
assert.equal(recovered.financeWrites,0);
let structuralTries=0;
await assert.rejects(()=>verifyGas9292PostDeployWithRetry({
 verify:async()=>{structuralTries++;throw Error('ISSUE860_9292_POSTDEPLOY_LEDGER_V2_UNVERIFIED');},
 delay:async()=>{throw Error('UNSAFE_RETRY');}
}),/LEDGER_V2_UNVERIFIED/);
assert.equal(structuralTries,1,'financial integrity failure must never retry');
let exhausted=0;
await assert.rejects(()=>verifyGas9292PostDeployWithRetry({
 verify:async()=>{exhausted++;throw Error('ISSUE860_9292_POSTDEPLOY_PREVIOUS_VERSION_WARM');},
 delay:async()=>{},maxAttempts:3
}),/PREVIOUS_VERSION_WARM/);
assert.equal(exhausted,3,'persistent old publication must still fail');
await assert.rejects(()=>verifyGas9292PostDeployWithRetry({
 verify:async()=>({...good,gasVersion:'9.291'}),delay:async()=>{}
}),/RETRY_RESULT_UNVERIFIED/);
await assert.rejects(()=>verifyGas9292PostDeployWithRetry({
 verify:async()=>good,maxAttempts:6
}),/RETRY_CONTRACT_INVALID/);
const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const on=wf.on||wf.true;
for(const n of ['use_9292_gate_selfheal','approve_9292'])
 assert.equal(on.workflow_dispatch.inputs[n].default,false,
  '9.292 manual selection must be opt-in');
const deploy=wf.jobs.deploy;
assert.match(deploy.env.GAS_9292_GATE_SELFHEAL,/workflow_dispatch/);
assert.match(deploy.env.GAS_9292_RELEASE_APPROVAL,/approve_9292/);
const steps=deploy.steps;
const pre=steps.find(x=>x.id==='gas9292_gate');
assert(pre);
assert.match(pre.if,/GAS_9292_RELEASE_APPROVAL == 'true'/);
assert.equal(pre.run,'node scripts/issue860-gas9292-predeploy-readonly.mjs');
const publish=steps.find(x=>x.name==='Deploy GAS');
assert.match(publish.env.GAS_9292_LIVE_PREFLIGHT_VERIFIED,/gas9292_gate.outputs.verified/);
const post=steps.find(x=>String(x.name).includes('v9.292 published'));
assert(post);
assert.match(post.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(post.run,/issue860-gas9292-postdeploy-readonly.mjs/);
assert.match(fs.readFileSync('scripts/deploy-gas.mjs','utf8'),
 /GAS_9292_GATE_SELFHEAL/);
console.log(JSON.stringify({
 kind:'ISSUE860_9292_MANUAL_RELEASE_REVIEW_PASS',
 sourceGitBlob:manifest.candidateGitBlob,
 manualApprovalRequired:true,predeploySettledClose:true,
 predeployV2Ledger:true,staleGateRepairDoesNotRequireIdle:true,
 postdeployReadOnlyGateDiagnostics:true,
 legacyFinancialWritersUnchanged:true,
 financialWrites:0,gasDeployments:0
}));
