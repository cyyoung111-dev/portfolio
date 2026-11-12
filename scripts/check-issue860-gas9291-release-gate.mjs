#!/usr/bin/env node
// v9.291 operational release contract: pinned full source, separate real manual
// approval, proof-gated live deployment. No GAS/Sheets/API requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,
 assertIssue8609291Prerequisites} from './deploy-gas.mjs';
const {source,manifest}=composeIssue860Gas9291Preview();
const sha='e9311667d513c1e43a8ed1af326a3ecdb9d1ca70';
assert.equal(manifest.sourceGitBlob,sha);
assert.equal(assertGasReleaseReady(source),'9.291');
assert.throws(()=>assertGasReleaseReady(source+'\nUNREVIEWED'),
 /GAS_RELEASE_SOURCE_NOT_APPROVED/);
for(const props of [
 {version:'9.291',eventName:'workflow_dispatch',approved9291:false},
 {version:'9.291',eventName:'workflow_run',approved9291:true},
 {version:'9.291',eventName:'workflow_dispatch',approved9290:true}
])assert.throws(()=>assertIssue507ManualReleasePermission(props),
 /GAS_9291_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.291',eventName:'workflow_dispatch',approved9291:true}));
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({
 version:'9.291',eventName:'workflow_run',dryRun:true}));
for(const ver of ['9.288','9.290','9.291']){
 assert.throws(()=>assertIssue8609291Prerequisites({
  version:'9.291',publishedVersion:ver,liveGateVerified:true}),
  /GAS_9291_REQUIRES_PUBLISHED_9289/);
}
assert.throws(()=>assertIssue8609291Prerequisites({
 version:'9.291',publishedVersion:'9.289',liveGateVerified:false}),
 /GAS_9291_REQUIRES_LIVE_IDLE_LEDGER_AND_RAW_SNAPSHOT_PROOF/);
assert.doesNotThrow(()=>assertIssue8609291Prerequisites({
 version:'9.291',publishedVersion:'9.289',liveGateVerified:true}));
assert.doesNotThrow(()=>assertIssue8609291Prerequisites({
 version:'9.291',publishedVersion:'9.288',dryRun:true}));
const workflow=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
assert.equal(Object.hasOwn(workflow.on.workflow_dispatch.inputs,'use_9291_watchdog_recovery'),false);
assert.equal(Object.hasOwn(workflow.on.workflow_dispatch.inputs,'approve_9291'),false);
assert(!workflow.jobs.deploy.steps.some(x=>String(x.name||'').includes('before v9.291')));
assert(workflow.jobs.deploy.steps.some(x=>x.name==='Deploy GAS'));
console.log(JSON.stringify({kind:'ISSUE860_GAS9291_MANUAL_RELEASE_GATE_PASS',
 sourceGitBlob:sha,manualApprovalRequired:true,
 repairProofRequired:true,published9289Required:true,
 noGASWritesInTest:true,sourcePinned:true}));
