// Pre-release contract only. No network, secrets, GAS, or financial sheet access.
// A green CI test proves the candidate CANNOT be published by the existing path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {prepareIssue507Runtime} from './prepare-issue507-runtime-integration.mjs';
import {assertGasReleaseReady,extractExpectedGasVersion,assertGasProjectFileSet} from './deploy-gas.mjs';

const source=fs.readFileSync('reference/gas-v9.281.gs','utf8');
const {candidate,manifest}=prepareIssue507Runtime({source});
const sha256=value=>createHash('sha256').update(value).digest('hex');

assert.equal(assertGasReleaseReady(source),'9.281');
assert.equal(extractExpectedGasVersion(candidate),'9.281');
assert.equal(manifest.baseSourceSha256,sha256(source));
assert.equal(manifest.candidateSha256,sha256(candidate));
assert.equal(manifest.entrypointCount,555);
assert.equal(manifest.deployable,false);
assert.equal(manifest.preparedOnly,true);
assert.equal(manifest.financeWriteAuthorized,false);
assert.equal(manifest.productionSourceChanged,false);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_SOURCE_NOT_APPROVED/);
assert.throws(()=>assertGasProjectFileSet([
 {name:'appsscript',type:'JSON',source:'{}'},
 {name:'Code',type:'SERVER_JS',source:candidate},
 {name:'issue507-repair',type:'SERVER_JS',source:'function repair(){}'},
],'Code',[]),/UNREVIEWED_FILES/);

// The complete synthetic production candidate compiles, but neither real
// HTTP nor manual-refresh entrypoint can start without initialized admission.
// No substitute metadata, approval value, fake operator receipt, or API read.
new vm.Script(candidate,{filename:'issue507-staged-gas.gs'});
const lock={hasLock:()=>false,waitLock:()=>{},releaseLock:()=>{}};
const ctx=vm.createContext({
 LockService:{getScriptLock:()=>lock},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{throw Error('BOOTSTRAP_METADATA_DENIED');}})},
 Utilities:{getUuid:()=>{throw new Error('UNEXPECTED_UUID');}},
});
vm.runInContext(candidate,ctx);
for(const [name,args] of [
 ['doPost',[{postData:{contents:'action=refreshFundValuations'}}]],
 ['handleRefreshFundValuations',['2026-10-30','2026-10-30','F00001']],
 ['rebuildDailySnapshots',[]],
]){
 assert.equal(typeof ctx[name],'function');
 assert.throws(()=>ctx[name](...args),/BOOTSTRAP_METADATA_DENIED/,name);
}

// This is deliberately NOT a release-readiness success signal. Operator
// attestations must be verified independently, not manufactured by CI.
const blockers=[
 'REVIEWED_NEW_GAS_VERSION_AND_SOURCE_BLOB_NOT_INSTALLED',
 'WEB_API_DEPLOYMENT_VERSION_ALIGNMENT_NOT_VERIFIED',
 'OLD_DEPLOYMENTS_ALL_ACTORS_AND_EXTERNAL_WRITERS_NOT_VERIFIED',
 'FRESH_RUNTIME_DRAIN_AND_39_ROW_PREVIEW_NOT_EXECUTED',
 'FINANCIAL_ORIGINAL_WRITE_APPROVAL_NOT_GRANTED',
];
assert.ok(blockers.length>=5);
console.log(JSON.stringify({
 status:'BLOCKED',
 gate:'ISSUE507_ACTIVATION_REQUIRES_SEPARATE_RELEASE',
 productionVersion:'9.281',
 candidateOnly:true,
 entrypointCount:manifest.entrypointCount,
 existingDeploymentRejectsCandidate:true,
 financeMutationPerformed:false,
 blockers,
}));
