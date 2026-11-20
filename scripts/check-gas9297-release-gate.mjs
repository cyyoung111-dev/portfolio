#!/usr/bin/env node
// #734: exact 9.297 source, manual-only release, idle Gate, source/derived split.
// Zero network or production data writes; the pin must be reviewed and immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
import {composeGas9297NavCollectorTwoStagePreview}
 from './compose-gas9297-nav-collector-two-stage-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,
 assertIssue507ManualReleasePermission,assertIssue7349297Prerequisites}
 from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport}
 from './issue860-fund-nav-release-compat.mjs';
import {assertGas9297ReadOnlyProof,verifyGas9297WithRetry,verifyGas9297PreflightWithRetry}
 from './issue734-gas9297-release-readonly.mjs';
const PIN='7d303bedb019150798ffdd21bab43849d28d63a8';
const {parent,candidate,manifest}=composeGas9297NavCollectorTwoStagePreview();
assert.equal(manifest.parentGitBlob,'e7dfcc8a1ad194e4a0ef586b83b7df66a83dd2c6');
assert.equal(manifest.candidateGitBlob,PIN,'reviewed 9.297 candidate must have an immutable blob pin');
assert.equal(gasSourceBlobSha(candidate),PIN);
assert.equal(assertGasReleaseReady(candidate),'9.297');
assert.throws(()=>assertGasReleaseReady(candidate+'\n// drift'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.297'),
 {version:'9.297',kb:true,hanwha:true,financialWrites:0});
function functions(source){
 const hits=[...source.matchAll(/^function ([\w$]+)\s*\(/gm)];
 return new Map(hits.map((match,i)=>[match[1],source.slice(match.index,
  hits[i+1]?.index??source.length).replaceAll('9.297','9.296')]));
}
const old=functions(parent),now=functions(candidate);
const changed=[...old].filter(([name,code])=>now.get(name)!==code).map(([name])=>name);
assert.deepEqual(changed.sort(),['_applyFundNavImport','handleCollectKbFundNav',
 'handleImportFundNav'].sort(),'only three intended guarded NAV functions may change');
assert.deepEqual([...now.keys()].filter(k=>!old.has(k)),[]);
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(manifest.financialWrites,0);
for(const args of [
 {version:'9.297',eventName:'push',approved9297:true},
 {version:'9.297',eventName:'workflow_run',approved9297:true},
 {version:'9.297',eventName:'workflow_dispatch',approved9297:false}
])assert.throws(()=>assertIssue507ManualReleasePermission(args),
 /GAS_9297_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.297',eventName:'workflow_dispatch',approved9297:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.297',eventName:'workflow_dispatch',dryRun:true}));
for(const args of [
 {version:'9.297',publishedVersion:'9.295',liveIdleVerified:true},
 {version:'9.297',publishedVersion:'9.296',liveIdleVerified:false},
 {version:'9.297',publishedVersion:'9.297',liveIdleVerified:true}
])assert.throws(()=>assertIssue7349297Prerequisites(args),/GAS_9297_/);
assert.doesNotThrow(()=>assertIssue7349297Prerequisites({
 version:'9.297',publishedVersion:'9.296',liveIdleVerified:true}));
const proof={status:'VERIFIED',version:'9.297',tradeRows:338,writerGateMode:'OPEN',
 activeCount:0,tradeSnapshotDeferredCount:0,pendingCount:0,financeWrites:0};
const hash={status:'CONSISTENT',rows:338,uniqueIds:338,migrationPreview:{
 status:'VERIFIED',physicalRevisionMatchesGasGetTrades:true,
 physicalRevisionMatchesPcCanonical:true}};
assert.equal(assertGas9297ReadOnlyProof(proof,hash).status,'VERIFIED');
for(const invalid of [
 {state:{...proof,version:'9.296'}},{state:{...proof,activeCount:1}},
 {state:{...proof,tradeSnapshotDeferredCount:1}},
 {state:{...proof,pendingCount:1}},
 {state:{...proof,financeWrites:1}},
 {hash:{...hash,rows:337}},
 {hash:{...hash,migrationPreview:{...hash.migrationPreview,
  physicalRevisionMatchesPcCanonical:false}}}
])assert.throws(()=>assertGas9297ReadOnlyProof(invalid.state||proof,invalid.hash||hash),
 /GAS9297_READONLY_FINANCIAL_INTEGRITY_UNVERIFIED/);
let tries=0;
const retry=await verifyGas9297WithRetry({verify:async()=>{
 if(++tries===1)throw Error('GAS9295_READONLY_VERSION_MISMATCH');
 return {...assertGas9297ReadOnlyProof(proof,hash),tradeV2HashVerified:true};
},delay:async()=>{}});
assert.equal(tries,2);assert.equal(retry.readbackAttempts,2);
let neverRetry=0;
await assert.rejects(verifyGas9297WithRetry({verify:async()=>{
 neverRetry++;throw Error('GAS9297_READONLY_FINANCIAL_INTEGRITY_UNVERIFIED');
},delay:async()=>{}}),/GAS9297_READONLY_FINANCIAL_INTEGRITY_UNVERIFIED/);
assert.equal(neverRetry,1);
// Production dry-run #44011635687 failed on a single 60s network read.
// Recover only transient transport errors, and always prove the whole
// unchanged 9.296 ledger and idle writer state again on each attempt.
const preProof={...proof,version:'9.296',pcAndPhysicalRevisionMatch:true};
for(const transient of ['GAS9295_READONLY_NETWORK_UNVERIFIED',
 'AUTOMATION_DIAG_NETWORK_FAILED','READBACK_NETWORK_UNVERIFIED']){
 let count=0;const delays=[];
 const restored=await verifyGas9297PreflightWithRetry({verify:async()=>{
  if(++count<3)throw Error(transient);
  return preProof;
 },delay:async ms=>{delays.push(ms);}});
 assert.equal(restored.readbackAttempts,3);
 assert.equal(count,3);assert.deepEqual(delays,[3000,6000]);
 assert.equal(restored.financeWrites,0);
}
let preAttempts=0;const preDelays=[];
await assert.rejects(verifyGas9297PreflightWithRetry({verify:async()=>{
 preAttempts++;throw Error('GAS9295_READONLY_NETWORK_UNVERIFIED');
},delay:async ms=>{preDelays.push(ms);}}),/GAS9295_READONLY_NETWORK_UNVERIFIED/);
assert.equal(preAttempts,3);assert.deepEqual(preDelays,[3000,6000]);
for(const code of ['GAS9295_READONLY_VERSION_MISMATCH','GAS9295_READONLY_AUTH_MISSING',
 'GAS9295_READONLY_LEDGER_UNVERIFIED','GAS9296_READONLY_HASH_MISMATCH',
 'GAS9295_READONLY_WRITER_ACTIVE','GAS9295_READONLY_PENDING_FINANCIAL_RECOVERY',
 'GAS9295_READONLY_HTTP_UNVERIFIED','GAS9295_READONLY_JSON_UNVERIFIED']){
 let count=0;
 await assert.rejects(verifyGas9297PreflightWithRetry({verify:async()=>{
  count++;throw Error(code);
 },delay:async()=>assert.fail('non-transient failures must not retry')}),new RegExp(code));
 assert.equal(count,1);
}
for(const invalid of [{version:'9.297'},{financeWrites:1},{activeCount:1},
 {pendingCount:1},{tradeSnapshotDeferredCount:1},{writerGateMode:'CLOSED'},
 {tradeRows:-1},{pcAndPhysicalRevisionMatch:false}]){
 let count=0;
 await assert.rejects(verifyGas9297PreflightWithRetry({verify:async()=>{
  count++;return {...preProof,...invalid};
 },delay:async()=>assert.fail('invalid proof must not retry')}),
 /GAS9297_PREDEPLOY_INTEGRITY_UNVERIFIED/);
 assert.equal(count,1);
}
const wf=YAML.parse(readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const input=(wf.on??wf.true).workflow_dispatch.inputs;
assert.equal(input.dry_run.default,true);
assert.deepEqual(input.candidate_version.options,['9.305']);
assert.equal(Object.hasOwn(input,'approve_9297'),false);
assert.equal(wf.jobs.deploy.environment,'portfolio-production-gas');
assert.equal(wf.jobs.deploy.concurrency['cancel-in-progress'],false);
assert.equal(wf.jobs.deploy.env.GAS_9297_NAV_TWO_STAGE,'false');
assert.equal(wf.jobs.deploy.env.GAS_9297_RELEASE_APPROVAL,'false');
assert(!wf.jobs.deploy.steps.some(s=>s.id==='gas9297_gate'||String(s.run||'').includes('issue734-gas9297-release-readonly.mjs')));
const runner=readFileSync('scripts/issue734-gas9297-release-readonly.mjs','utf8');
assert.doesNotMatch(runner,/setValues|appendRow|refreshFundValuations|collectKbFundNav|collectHanwhaFundNav|syncTrades\(/);
assert.match(runner,/\?await verifyGas9297PreflightWithRetry\(\{verify:\(\)=>verifyGas9296PostDeploy\(config\)\}\)/);
assert.match(runner,/verifyGas9295ReleaseReadOnly/);
assert.match(runner,/probeTradeHash/);
console.log('GAS9297_MANUAL_RELEASE_READY '+JSON.stringify({
 pin:PIN,changedFunctions:changed,preflightReadOnly:true,manualApproval:true,
 exactNavCollectorVersion:true,negativeCases:7,preflightNetworkRetryMax:3,preflightStrictIntegrity:true,postdeployReconcilesTradeV2:true,
 liveGasTouched:false,financeWrites:0,deployments:0
}));
