import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {prepareIssue507Runtime} from './prepare-issue507-runtime-integration.mjs';
import {prepareIssue507ProposedRelease} from './prepare-issue507-proposed-release.mjs';
import {extractExpectedGasVersion,gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';

const sha256=s=>createHash('sha256').update(s).digest('hex');
const source=fs.readFileSync('reference/gas-v9.281.gs','utf8');
const base=prepareIssue507Runtime();
const {candidate,manifest}=prepareIssue507ProposedRelease();

assert.equal(assertGasReleaseReady(source),'9.281');
assert.equal(extractExpectedGasVersion(base.candidate),'9.281');
assert.equal(extractExpectedGasVersion(candidate),'9.282');
assert.equal(manifest.baseVersion,'9.281');
assert.equal(manifest.proposedVersion,'9.282');
assert.equal(manifest.entrypointCount,555);
assert.ok(manifest.gasResponseFieldCount>=1);
assert.ok(manifest.releaseId!==base.manifest.releaseId);
assert.equal(manifest.candidateSha256,sha256(candidate));
assert.equal(manifest.candidateGitBlob,gasSourceBlobSha(candidate));
assert.deepEqual([manifest.deployable,manifest.productionSourceChanged,
 manifest.webVersionChanged,manifest.deploymentApprovalAdded,
 manifest.financeWriteAuthorized,manifest.operatorEvidenceVerified],
 [false,false,false,false,false,false]);

// Verify the proposed source differs from the original staged candidate only
// in approved version fields and the execution gate release identifier.
const oldId="var ISSUE507_GATE_RELEASE_ID='"+base.manifest.releaseId+"';";
const newId="var ISSUE507_GATE_RELEASE_ID='"+manifest.releaseId+"';";
const reversed=candidate
  .replace(newId,oldId)
  .replace("ISSUE507_GATE_API_VERSION='9.282'","ISSUE507_GATE_API_VERSION='9.281'")
  .replace(/(Google Apps Script\s+v)9\.282\b/,(_m,p)=>p+'9.281')
  .replace(/(gasVersion\s*:\s*['"])9\.282(?=['"])/g,(_m,p)=>p+'9.281');
assert.equal(reversed,base.candidate);

// The new version is intentionally NOT in the approved deployment allowlist.
// A release PR must separately review/pin the entire source and web/API version.
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.throws(()=>prepareIssue507ProposedRelease({source:source+'\n'}),/ISSUE507_BASE_SOURCE_CHANGED/);
new vm.Script(candidate,{filename:'issue507-v9282-preview.gs'});

// Without operator-controlled gate initialization, no production entrypoint
// may execute. This is deliberately an in-memory simulation only.
const ctx=vm.createContext({
 LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock:()=>{},releaseLock:()=>{}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{throw Error('BOOTSTRAP_METADATA_DENIED');}})},
 Utilities:{getUuid:()=>{throw Error('UNEXPECTED_UUID');}},
});
vm.runInContext(candidate,ctx);
for(const [name,args] of [
 ['doPost',[{postData:{contents:'action=refreshFundValuations'}}]],
 ['handleRefreshFundValuations',['2026-10-30','2026-10-30','F00001']],
 ['rebuildDailySnapshots',[]],
])assert.throws(()=>ctx[name](...args),/BOOTSTRAP_METADATA_DENIED/,name);

console.log(JSON.stringify({
 state:'STAGED_ONLY',
 version:manifest.proposedVersion,
 entrypoints:manifest.entrypointCount,
 versionFields:manifest.gasResponseFieldCount,
 approvedByCurrentDeployer:false,
 operationalDeployment:false,
 financeMutationPerformed:false,
}));
