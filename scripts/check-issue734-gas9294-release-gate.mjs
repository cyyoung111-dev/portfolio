#!/usr/bin/env node
// #734: 9.294 exact immutable source, read-only real release gates and
// manual-only operator workflow contract. No production data or GAS writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeIssue734Gas9294OwnerNavPreview}
 from './compose-issue734-gas9294-owner-nav-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,
 assertIssue507ManualReleasePermission,assertIssue7349294Prerequisites}
 from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport}
 from './issue860-fund-nav-release-compat.mjs';
import {assessGas9294Preflight}
 from './issue734-gas9294-predeploy-readonly.mjs';
import {assessGas9294PostDeploy,verifyGas9294PostDeployWithRetry}
 from './issue734-gas9294-postdeploy-readonly.mjs';

const PIN='f5e31eeb2255539a021546d8b90a71d5cc7ca33d';
const {parent,source,manifest}=composeIssue734Gas9294OwnerNavPreview();
assert.equal(gasSourceBlobSha(parent),'f6f9d2b03410a01bb1fbede81ed9b70b52688507');
assert.equal(gasSourceBlobSha(source),PIN);
assert.equal(manifest.candidateGitBlob,PIN);
assert.equal(assertGasReleaseReady(source),'9.294');
assert.throws(()=>assertGasReleaseReady(source+'\n// unapproved source'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.equal(assertGasReleaseReady(parent),'9.293');
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.294'),
 {version:'9.294',kb:true,hanwha:true,financialWrites:0});
assert.equal(manifest.deployable,false);
for(const args of [
 {version:'9.294',eventName:'push',approved9294:true},
 {version:'9.294',eventName:'workflow_run',approved9294:true},
 {version:'9.294',eventName:'workflow_dispatch',approved9294:false}
])assert.throws(()=>assertIssue507ManualReleasePermission(args),
 /GAS_9294_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.294',eventName:'workflow_dispatch',approved9294:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.294',eventName:'workflow_dispatch',dryRun:true}));
for(const args of [
 {version:'9.294',publishedVersion:'9.292',liveCloseOwnerVerified:true},
 {version:'9.294',publishedVersion:'9.293',liveCloseOwnerVerified:false}
])assert.throws(()=>assertIssue7349294Prerequisites(args),/GAS_9294_/);
assert.doesNotThrow(()=>assertIssue7349294Prerequisites({
 version:'9.294',publishedVersion:'9.293',liveCloseOwnerVerified:true}));

const published={status:'VERIFIED',gasVersion:'9.293',
 tradeLedgerVersion:2,tradeRows:338,writerGateMode:'OPEN',recordedActive:0};
const close={runDate:'2026-11-12',state:'INCOMPLETE',stage:'PRICE',
 fundState:'DONE',fundAttemptDate:'2026-11-11',snapshotStale:false};
const status={gasVersion:'9.293',triggerReady:true,
 tradeLedgerWriteUnverified:false,pendingTradeSnapshotRebuildFrom:'-',
 tradeSnapshotDeferredCount:0,snapshotLastDate:'2026-11-12',
 priceHistoryLastDate:'2026-11-12',close};
const snapshot={observedDate:'2026-11-12',storeStatus:'VALID',
 expectedRows:39,storedRows:39,verifiedFunds:2,issues:{
 missingCodes:0,unexpectedCodes:0,duplicateKeys:0,qtyMismatches:0,
 costAmtMismatches:0,evalUnitMismatches:0,evalAmtMismatches:0,
 sourceMismatches:0,sourceDataErrors:0},duplicateSummary:{groups:0},
 writes:0,noRebuildAttempted:true};
const ok=assessGas9294Preflight({published,status,snapshot});
assert.equal(ok.status,'VERIFIED');
assert.equal(ok.complete,false);
assert.equal(ok.navOwnerVerified,false);
assert.equal(ok.financeWrites,0);
assert.equal(ok.persistedCloseComplete,false);
// The protected 11/12 one-shot recovered this old owner to stored CLOSE
// COMPLETE. Accept only the independently matching date/PRICE/NAV receipt,
// not any previous-day fund DONE or a spoofed COMPLETE stage.
const recovered={...close,state:'COMPLETE',stage:'COMPLETE',
 summaryPresent:true,summaryRunDate:'2026-11-12',priceOk:true,fundOk:true,
 closeErrorCount:0,closeErrorPresent:false,fundErrorPresent:false,
 fundWarningPresent:false,fundState:'DONE',
 fundAttemptDate:'2026-11-12',fundDate:'2026-11-12',
 krxPublicationWaiting:false};
const recoveredStatus={...status,close:recovered,
 overallStatus:'NORMAL',pendingCount:0};
const recoveredReady=assessGas9294Preflight({
 published,status:recoveredStatus,snapshot});
assert.equal(recoveredReady.status,'VERIFIED');
assert.equal(recoveredReady.state,'COMPLETE');
assert.equal(recoveredReady.persistedCloseComplete,true);
assert.equal(recoveredReady.complete,false,
 'stored close completion is not independent Script API owner proof');
assert.equal(recoveredReady.navOwnerVerified,false);
assert.equal(recoveredReady.processExecutionOwnerVerified,false);
let recoveredBad=0;
for(const bad of [
 {close:{summaryRunDate:'2026-11-11'}},
 {close:{fundDate:'2026-11-11'}},
 {close:{fundAttemptDate:'2026-11-11'}},
 {close:{priceOk:false}},
 {close:{fundOk:false}},
 {close:{closeErrorCount:1}},
 {close:{closeErrorPresent:true}},
 {close:{fundErrorPresent:true}},
 {close:{fundWarningPresent:true}},
 {close:{fundState:'IN_PROGRESS'}},
 {close:{krxPublicationWaiting:true}},
 {close:{summaryPresent:false}},
 {close:{stage:'FUND_PENDING'}},
 {close:{runDate:'2026-11-13'}},
 {state:{overallStatus:'WARNING'}},
 {state:{pendingCount:1}}
]){
 const next={...recoveredStatus,...bad.state,
   close:{...recovered,...bad.close}};
 assert.throws(()=>assessGas9294Preflight({
   published,status:next,snapshot
 }),/ISSUE734_9294_PREFLIGHT_CLOSE_OWNER_OR_DATE_CHANGED/);
 recoveredBad++;
}
assert.equal(recoveredBad,16);
for(const invalid of [
 {published:{...published,gasVersion:'9.292'}},
 {published:{...published,recordedActive:1}},
 {published:{...published,tradeRows:337}},
 {status:{...status,gasVersion:'9.292'}},
 {status:{...status,close:{...close,runDate:'2026-11-11'}}},
 {status:{...status,close:{...close,state:'COMPLETE'}}},
 {status:{...status,close:{...close,snapshotStale:true}}},
 {status:{...status,close:{...close,fundState:'IN_PROGRESS'}}},
 {status:{...status,tradeLedgerWriteUnverified:true}},
 {snapshot:{...snapshot,storedRows:38}},
 {snapshot:{...snapshot,issues:{...snapshot.issues,sourceDataErrors:1}}}
])assert.throws(()=>assessGas9294Preflight({
 published:invalid.published??published,
 status:invalid.status??status,
 snapshot:invalid.snapshot??snapshot
}),/ISSUE734_9294_PREFLIGHT_/);

const trades=Array.from({length:338},(_,i)=>({id:'tr_'+String(i).padStart(6,'0')}));
const settings={status:'ok',gasVersion:'9.294',settings:{}};
const ledger={status:'ok',tradeLedgerProtocolVersion:2,
 ledgerRevision:'a'.repeat(64),trades};
const gate={status:'ok',gasVersion:'9.294',writerGate:{
 mode:'OPEN',repairAuthorized:false,activeCount:0,activeOwners:[],
 expiredUnconfirmedCount:3,timeoutRetirementCandidates:0}};
const post=assessGas9294PostDeploy({settings,ledger,gate});
assert.equal(post.status,'VERIFIED');
assert.equal(post.tradeRows,338);
assert.equal(post.financeWrites,0);
for(const invalid of [
 {settings:{...settings,gasVersion:'9.293'}},
 {gate:{...gate,gasVersion:'9.293'}},
 {gate:{...gate,writerGate:{...gate.writerGate,activeCount:1}}},
 {ledger:{...ledger,trades:trades.slice(1)}},
 {ledger:{...ledger,trades:[...trades.slice(0,-1),trades[0]]}}
])assert.throws(()=>assessGas9294PostDeploy({
 settings:invalid.settings??settings,ledger:invalid.ledger??ledger,
 gate:invalid.gate??gate
}),/ISSUE734_9294_POSTDEPLOY_/);
let attempts=0;
const fresh=await verifyGas9294PostDeployWithRetry({maxAttempts:3,
 verify:async()=>{attempts++;if(attempts<2)
  throw Error('ISSUE734_9294_POSTDEPLOY_PREVIOUS_VERSION_WARM');
  return post;},delay:async()=>{}});
assert.equal(fresh.readbackAttempts,2);

const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=(wf.on??wf.true).workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs).sort(),['approve_9294','dry_run']);
assert.equal(inputs.dry_run.default,true);
assert.equal(inputs.approve_9294.default,false);
const env=wf.jobs.deploy.env;
assert.match(env.GAS_9294_CLOSE_OWNER_NAV,/workflow_dispatch/);
assert.match(env.GAS_9294_RELEASE_APPROVAL,/approve_9294/);
assert.equal(env.GAS_9293_ORPHANED_CLOSE,'false');
assert.equal(wf.jobs.deploy.environment,'portfolio-production-gas');
const steps=wf.jobs.deploy.steps;
const pre=steps.find(s=>s.id==='gas9294_gate');
assert(pre);
assert.match(pre.if,/GAS_9294_RELEASE_APPROVAL/);
assert.match(pre.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(pre.run,/issue734-gas9294-predeploy-readonly/);
const deploy=steps.find(s=>s.name==='Deploy GAS');
assert.match(deploy.env.GAS_9294_LIVE_PREFLIGHT_VERIFIED,/gas9294_gate/);
assert(steps.some(s=>String(s.run||'').includes('issue734-gas9294-postdeploy-readonly')));
assert.equal(wf.jobs.deploy['concurrency']['cancel-in-progress'],false);

console.log(JSON.stringify({
 kind:'ISSUE734_GAS9294_RELEASE_GATE_PASS',pin:PIN,
 predeployNegativeCases:11,recoveredCloseNegativeCases:16,
 postdeployNegativeCases:5,
 manualApprovalOnly:true,dryRunDefault:true,
 financeWrites:0,gasDeployments:0}));
