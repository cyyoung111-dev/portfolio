#!/usr/bin/env node
// #734 9.293 exact-blob manual release preflight and postdeploy contract tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeIssue734Gas9293OrphanedClosePreview}
 from './compose-issue734-gas9293-orphaned-close-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,
 assertIssue507ManualReleasePermission,assertIssue7349293Prerequisites}
 from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport}
 from './issue860-fund-nav-release-compat.mjs';
import {assessGas9293Preflight}
 from './issue734-gas9293-predeploy-readonly.mjs';
import {assessGas9293PostDeploy,verifyGas9293PostDeployWithRetry}
 from './issue734-gas9293-postdeploy-readonly.mjs';

const PIN='f6f9d2b03410a01bb1fbede81ed9b70b52688507';
const {parent,source,manifest}=composeIssue734Gas9293OrphanedClosePreview();
assert.equal(gasSourceBlobSha(parent),'a1fc71cd26616be250b4e07cceacbc73995be98e');
assert.equal(gasSourceBlobSha(source),PIN);
assert.equal(manifest.candidateGitBlob,PIN);
assert.equal(assertGasReleaseReady(source),'9.293');
assert.throws(()=>assertGasReleaseReady(source+'\n// unreviewed'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.equal(assertGasReleaseReady(parent),'9.292');
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.293'),
 {version:'9.293',kb:true,hanwha:true,financialWrites:0});
assert.equal(manifest.deployable,false,'source preview itself is never approval');
for(const args of [
 {version:'9.293',eventName:'push',approved9293:true},
 {version:'9.293',eventName:'workflow_run',approved9293:true},
 {version:'9.293',eventName:'workflow_dispatch',approved9293:false},
])assert.throws(()=>assertIssue507ManualReleasePermission(args),
 /GAS_9293_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.293',eventName:'workflow_dispatch',approved9293:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.293',eventName:'workflow_dispatch',dryRun:true}));
for(const a of [
 {version:'9.293',publishedVersion:'9.291',liveOrphanedCloseVerified:true},
 {version:'9.293',publishedVersion:'9.292',liveOrphanedCloseVerified:false}
])assert.throws(()=>assertIssue7349293Prerequisites(a),/GAS_9293_/);
assert.doesNotThrow(()=>assertIssue7349293Prerequisites({
 version:'9.293',publishedVersion:'9.292',liveOrphanedCloseVerified:true}));

const published={status:'VERIFIED',gasVersion:'9.292',tradeLedgerVersion:2,
 tradeRows:338,gateMode:'OPEN',recordedActive:0,timeoutRetirementCandidates:0};
const close={gasVersion:'9.292',observedKstDate:'2026-11-12',
 closeRunDate:'2026-11-12',closeState:'INCOMPLETE',closeStage:'PRICE',
 snapshotLastDate:'2026-11-11',priceHistoryLastDate:'2026-11-12',
 pendingKrxDatesCount:0,snapshotStale:true};
const issues={missingCodes:39,unexpectedCodes:0,duplicateKeys:0,
 qtyMismatches:0,costAmtMismatches:0,evalUnitMismatches:0,
 evalAmtMismatches:0,sourceMismatches:0,sourceDataErrors:0};
const snapshot={observedDate:'2026-11-12',storeStatus:'NO_SNAPSHOT',
 expectedRows:39,storedRows:0,verifiedFunds:2,priceSourceStates:{VALID:37},
 issues,duplicateSummary:{groups:0},writes:0,noRebuildAttempted:true};
const good=assessGas9293Preflight({published,close,snapshot});
assert.equal(good.status,'VERIFIED');
assert.equal(good.unrecoveredRows,39);
assert.equal(good.financeWrites,0);
for(const invalid of [
 {published:{...published,tradeRows:337}},
 {published:{...published,recordedActive:1}},
 {published:{...published,gasVersion:'9.291'}},
 {close:{...close,closeStage:'COMPLETE'}},
 {close:{...close,snapshotLastDate:'2026-11-12'}},
 {close:{...close,closeRunDate:'2026-11-11'}},
 {close:{...close,pendingKrxDatesCount:1}},
 {snapshot:{...snapshot,storedRows:1}},
 {snapshot:{...snapshot,priceSourceStates:{VALID:36}}},
 {snapshot:{...snapshot,issues:{...issues,sourceDataErrors:1}}}
])assert.throws(()=>assessGas9293Preflight({
 published:invalid.published??published,
 close:invalid.close??close,
 snapshot:invalid.snapshot??snapshot
}),/ISSUE734_9293_PREFLIGHT_/);

const trades=Array.from({length:338},(_,i)=>({id:'tr_'+String(i).padStart(6,'0')}));
const settings={status:'ok',gasVersion:'9.293',settings:{}};
const ledger={status:'ok',tradeLedgerProtocolVersion:2,ledgerRevision:'a'.repeat(64),trades};
const gate={status:'ok',gasVersion:'9.293',writerGate:{
 mode:'OPEN',repairAuthorized:false,activeCount:0,activeOwners:[],
 expiredUnconfirmedCount:3,timeoutRetirementCandidates:0}};
const post=assessGas9293PostDeploy({settings,ledger,gate});
assert.equal(post.status,'VERIFIED');
assert.equal(post.tradeRows,338);
assert.equal(post.snapshotStillRequiresSeparateProof,true);
for(const invalid of [
 {settings:{...settings,gasVersion:'9.292'}},
 {gate:{...gate,gasVersion:'9.292'}},
 {gate:{...gate,writerGate:{...gate.writerGate,activeCount:1}}},
 {ledger:{...ledger,trades:trades.slice(1)}},
 {ledger:{...ledger,trades:[...trades.slice(0,-1),trades[0]]}}
])assert.throws(()=>assessGas9293PostDeploy({
 settings:invalid.settings??settings,ledger:invalid.ledger??ledger,
 gate:invalid.gate??gate
}),/ISSUE734_9293_POSTDEPLOY_/);
let attempts=0;
const stable=await verifyGas9293PostDeployWithRetry({maxAttempts:3,
 verify:async()=>{attempts++;if(attempts<2)
  throw Error('ISSUE734_9293_POSTDEPLOY_PREVIOUS_VERSION_WARM');
  return post;},
 delay:async()=>{}});
assert.equal(stable.readbackAttempts,2);
assert.equal(attempts,2);

const flow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const on=flow.on??flow.true;
const opts=on.workflow_dispatch.inputs;
assert.equal(opts.use_9293_orphaned_close.default,false);
assert.equal(opts.approve_9293.default,false);
const steps=flow.jobs.deploy.steps;
const gateStep=steps.find(s=>s.id==='gas9293_gate');
assert(gateStep);
assert.match(gateStep.if,/GAS_9293_RELEASE_APPROVAL/);
assert.match(gateStep.if,/GAS_DEPLOY_DRY_RUN != 'true'/);
assert.match(gateStep.run,/issue734-gas9293-predeploy-readonly/);
assert(steps.some(s=>String(s.run||'').includes('issue734-gas9293-postdeploy-readonly')));
const deploy=steps.find(s=>s.name==='Deploy GAS');
assert.match(deploy.env.GAS_9293_LIVE_PREFLIGHT_VERIFIED,/gas9293_gate/);

console.log(JSON.stringify({kind:'ISSUE734_GAS9293_RELEASE_GATE_PASS',
 pin:PIN,predeployNegativeCases:10,postdeployNegativeCases:5,
 manualPermissionRequired:true,workflowDispatchOnly:true,
 liveMissingDayProofRequired:true,gasDeployments:0,financeWrites:0}));
