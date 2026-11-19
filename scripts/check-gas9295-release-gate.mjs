#!/usr/bin/env node
// GAS 9.295 full release safety: exact source, NAV, manual-only operator gate,
// read-only pre/post checks. No GAS network, deployment or financial writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeGas9295CodeMasterReusePreview}
 from './compose-gas9295-code-master-reuse-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,
 assertIssue507ManualReleasePermission,assertIssue7349295Prerequisites}
 from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport}
 from './issue860-fund-nav-release-compat.mjs';
import {assessGas9295ReleaseState,verifyGas9295PostdeployWithRetry}
 from './issue734-gas9295-release-readonly.mjs';

const {parent,candidate,manifest}=composeGas9295CodeMasterReusePreview();
const PIN='a360a32a2d459d1f28dee94365a28d8c3ca24367';
assert.equal(gasSourceBlobSha(parent),'f5e31eeb2255539a021546d8b90a71d5cc7ca33d');
assert.equal(gasSourceBlobSha(candidate),PIN);
assert.equal(manifest.candidateGitBlob,PIN);
assert.equal(assertGasReleaseReady(candidate),'9.295');
assert.throws(()=>assertGasReleaseReady(candidate+'\n// unapproved edit'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.295'),
 {version:'9.295',kb:true,hanwha:true,financialWrites:0});
assert.equal(manifest.changedBusinessFunctions.length,1);
for(const cfg of [
 {version:'9.295',eventName:'push',approved9295:true},
 {version:'9.295',eventName:'workflow_run',approved9295:true},
 {version:'9.295',eventName:'workflow_dispatch',approved9295:false}
])assert.throws(()=>assertIssue507ManualReleasePermission(cfg),
 /GAS_9295_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.295',eventName:'workflow_dispatch',approved9295:true
}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.295',eventName:'workflow_dispatch',dryRun:true
}));
for(const cfg of [
 {version:'9.295',publishedVersion:'9.293',liveIdleVerified:true},
 {version:'9.295',publishedVersion:'9.294',liveIdleVerified:false}
])assert.throws(()=>assertIssue7349295Prerequisites(cfg),/GAS_9295_/);
assert.doesNotThrow(()=>assertIssue7349295Prerequisites({
 version:'9.295',publishedVersion:'9.294',liveIdleVerified:true
}));
const trades=[{id:'tr_abc123'},{id:'srv_000111'}];
const ledger={status:'ok',tradeLedgerProtocolVersion:2,
 ledgerRevision:'a'.repeat(64),trades};
const gate={status:'ok',gasVersion:'9.294',writerGate:{
 mode:'OPEN',repairAuthorized:false,activeCount:0,activeOwners:[],
 expiredUnconfirmedCount:2,timeoutRetirementCandidates:0}};
const status={mode:'READ_ONLY',gasVersion:'9.294',gasVersionReady:true,
 triggerReady:true,tradeLedgerWriteUnverified:false,
 pendingTradeSnapshotRebuildFrom:'-',tradeSnapshotDeferredCount:0,pendingCount:0,
 overallStatus:'NORMAL',tradeSnapshotWorkerRuntimeAssessment:'NOT_RUNNING',
 close:{state:'COMPLETE',stage:'COMPLETE',fundState:'DONE'}};
const assess=(o={})=>assessGas9295ReleaseState({
 ledger:o.ledger??ledger,gate:o.gate??gate,
 status:o.status??status,expectedVersion:o.expectedVersion??'9.294'
});
const ok=assess();
assert.equal(ok.status,'VERIFIED');
assert.equal(ok.version,'9.294');
assert.equal(ok.tradeRows,2,'ledger count cannot be hardcoded to 338');
assert.equal(ok.snapshotIndependentRowProof,false);
assert.equal(ok.financeWrites,0);
for(const invalid of [
 {gate:{...gate,gasVersion:'9.293'}},
 {ledger:{...ledger,tradeLedgerProtocolVersion:1}},
 {ledger:{...ledger,ledgerRevision:'invalid'}},
 {ledger:{...ledger,trades:[trades[0],trades[0]]}},
 {gate:{...gate,writerGate:{...gate.writerGate,activeCount:1,
   activeOwners:[{owner:'anonymous'}]}}},
 {gate:{...gate,writerGate:{...gate.writerGate,mode:'BLOCKED'}}},
 {gate:{...gate,writerGate:{...gate.writerGate,repairAuthorized:true}}},
 {status:{...status,gasVersion:'9.293'}},
 {status:{...status,tradeLedgerWriteUnverified:true}},
 {status:{...status,pendingTradeSnapshotRebuildFrom:'2026-11-13'}},
 {status:{...status,tradeSnapshotDeferredCount:1}},
 {status:{...status,pendingCount:1}},
 {status:{...status,close:{...status.close,stage:'PRICE'}}},
 {status:{...status,close:{...status.close,fundState:'IN_PROGRESS'}}},
 {status:{...status,tradeSnapshotWorkerRuntimeAssessment:'RUNNING_RECENT_UNCONFIRMED'}},
 {status:{...status,triggerReady:false}},
 {status:{...status,overallStatus:'ERROR'}}
])assert.throws(()=>assess(invalid),/GAS9295_READONLY_/);
const after=assess({gate:{...gate,gasVersion:'9.295'},
 status:{...status,gasVersion:'9.295'},expectedVersion:'9.295'});
assert.equal(after.version,'9.295');
let attempts=0;
const retry=await verifyGas9295PostdeployWithRetry({
 verify:async()=>{
  attempts++;
  if(attempts===1)throw Error('GAS9295_READONLY_VERSION_MISMATCH');
  return after;
 },delay:async()=>{},maxAttempts:3
});
assert.equal(retry.readbackAttempts,2);
await assert.rejects(verifyGas9295PostdeployWithRetry({
 verify:async()=>{throw Error('GAS9295_READONLY_LEDGER_UNVERIFIED')},
 delay:async()=>{}
}),/GAS9295_READONLY_LEDGER_UNVERIFIED/);

const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=(wf.on??wf.true).workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs).sort(),
 ['approve_9294','approve_9295','approve_9296','approve_9297','approve_9298','approve_9300','candidate_version','dry_run']);
assert.equal(inputs.dry_run.default,true);
assert.equal(inputs.candidate_version.default,'9.300');
assert.equal(inputs.approve_9294.default,false);
assert.equal(inputs.approve_9295.default,false);
assert.deepEqual(inputs.candidate_version.options,['9.294','9.295','9.296','9.297','9.298']);
assert.equal(wf.jobs.deploy.environment,'portfolio-production-gas');
assert.equal(wf.jobs.deploy['concurrency']['cancel-in-progress'],false);
const env=wf.jobs.deploy.env;
assert.match(env.GAS_9295_PRICE_MASTER_REUSE,/workflow_dispatch/);
assert.match(env.GAS_9295_PRICE_MASTER_REUSE,/candidate_version == '9.295'/);
assert.match(env.GAS_9295_RELEASE_APPROVAL,/approve_9295/);
assert.match(env.GAS_9294_CLOSE_OWNER_NAV,/candidate_version == '9.294'/);
const steps=wf.jobs.deploy.steps;
const pre=steps.find(step=>step.id==='gas9295_gate');
assert(pre);
assert.match(pre.if,/GAS_9295_PRICE_MASTER_REUSE == 'true'/);
assert.match(pre.if,/GAS_9295_RELEASE_APPROVAL == 'true'/);
assert.match(pre.if,/GAS_DEPLOY_DRY_RUN == 'true'/,
 'dry-run must execute the same Writer Gate preflight as live approval');
assert.equal(pre['continue-on-error'],undefined,
 'failed 9.295 preflight must block green dry-run and production');
assert.match(pre.run,/issue734-gas9295-release-readonly.mjs pre/);
const dryInventory=steps.find(x=>x.name===
 'Require clean full GAS deployment inventory on 9.295 dry-run');
const realInventory=steps.find(x=>x.name===
 'Require clean full GAS deployment inventory before real deploy');
assert(dryInventory&&realInventory,'both dry-run and real inventory gates required');
assert.match(dryInventory.if,/GAS_9295_PRICE_MASTER_REUSE == 'true'/);
assert.match(dryInventory.if,/GAS_DEPLOY_DRY_RUN == 'true'/);
assert.equal(dryInventory['continue-on-error'],undefined,
 'missing deployment ownership proof must fail dry-run');
assert.equal(dryInventory.run,realInventory.run,
 'dry-run inventory must execute the exact production audit');
assert.equal(steps.indexOf(dryInventory)<steps.indexOf(pre),true,
 'inventory before Writer Gate preflight');
assert.equal(steps.indexOf(pre)<steps.findIndex(x=>x.name==='Deploy GAS'),true,
 'Writer Gate proof must precede deploy, including dry-run');
const deploy=steps.find(step=>step.name==='Deploy GAS');
assert(deploy);
assert.match(deploy.env.GAS_9295_LIVE_PREFLIGHT_VERIFIED,/gas9295_gate/);
assert(steps.some(step=>/issue734-gas9295-release-readonly.mjs post/.test(String(step.run||''))));
assert(!steps.some(step=>step.name==='Deploy GAS'&&
 /GAS_9295_RELEASE_APPROVAL/.test(String(step.if||''))),
 'production release still relies on preflight + code-enforced approval checks');
const source=fs.readFileSync('scripts/issue734-gas9295-release-readonly.mjs','utf8');
assert.doesNotMatch(source,/fetchPricesToss|handleGetPricesCompat|batchUpsertPriceHistory|syncTrades|runDailyPriceHistory/);
assert.doesNotMatch(source,/requestGsheetFormJson|setValues|appendRow/);
assert.doesNotMatch(source,/request\(endpoint,token,'getSettings'/,
 'GAS getSettings is not guaranteed read-only: it can settle pending code deletion');
console.log('GAS9295_RELEASE_GATE_READY '+JSON.stringify({
 sourcePin:PIN,manualApprovalRequired:true,dryRunDefault:true,
 negativePreflightCases:17,postdeployRetries:2,
 liveDataFetched:false,financeWrites:0,gasDeployments:0
}));

{
 const evidence=[];
 const privateMarker='PRIVATE_ACCOUNT_AMOUNT_RAW_ERROR';
 const rejected={...status,overallStatus:'ERROR',fundWarningClass:'NAV_PUBLICATION_OR_INPUT_PENDING',
  snapshotLastDate:'2026-11-17',priceHistoryLastDate:'2026-11-18',
  close:{...status.close,state:'ERROR',stage:'ERROR',runDate:'2026-11-18',
    expectedRunDate:'2026-11-18',snapshotStale:true,fundState:'ERROR',
    fundErrorPresent:true,fundErrorCode:'NAV_CONFLICT',privateMarker,
    closeErrorCount:1,expectedSnapshotDate:'2026-11-18'},
  latestBackfill:{runDate:'2026-11-18',targetDate:'2026-11-17',attempted:true,ok:false,
    failureClass:'SAVED_SNAPSHOT_INTEGRITY_FAILED',rawError:privateMarker}};
 assert.throws(()=>assessGas9295ReleaseState({ledger,gate,status:rejected,reportBlockedAutomation:r=>evidence.push(r)}),/AUTOMATION_NOT_STABLE/);
 assert.equal(evidence.length,1);
 const row=evidence[0];
 assert.equal(row.overallStatus,'ERROR');assert.equal(row.fundErrorCode,'NAV_CONFLICT');
 assert.equal(row.latestBackfill.failureClass,'SAVED_SNAPSHOT_INTEGRITY_FAILED');
 assert.equal(row.snapshotStale,true);assert.equal(row.releaseAuthorized,false);
 assert.equal(row.financeWrites,0);assert.equal(row.gasDeployments,0);
 assert.doesNotMatch(JSON.stringify(row),/PRIVATE_ACCOUNT_AMOUNT_RAW_ERROR|tr_abc123|srv_000111|ledgerRevision/);
 const unknown={...rejected,close:{...rejected.close,fundErrorCode:privateMarker,expectedRunDate:'2026-02-30'}};
 assert.throws(()=>assessGas9295ReleaseState({ledger,gate,status:unknown,reportBlockedAutomation:r=>evidence.push(r)}),/AUTOMATION_NOT_STABLE/);
 assert.equal(evidence[1].fundErrorCode,'UNKNOWN');assert.equal(evidence[1].expectedRunDate,'-');
 assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE_ACCOUNT_AMOUNT_RAW_ERROR/);
 assert.equal(assessGas9295ReleaseState({ledger,gate,status,reportBlockedAutomation:()=>assert.fail('normal state must not emit blocker')}).status,'VERIFIED');
}
console.log('PASS: same-response automation blocker evidence, strict release gate unchanged, no raw finance data');
