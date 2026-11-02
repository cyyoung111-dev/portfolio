import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';
import {inspectCombinedGasReleasePreflight} from './preflight-gas9283-nh-krx-release.mjs';
import {prepareGasNh9283WithKrxTurnoverPreview} from './compose-gas9283-turnover-preview.mjs';

const {candidate}=prepareGasNh9283WithKrxTurnoverPreview();
const baseline=fs.readFileSync('src/gas/apps_script.gs','utf8');
const result=inspectCombinedGasReleasePreflight();
assert.equal(result.status,'NOT_AUTHORIZED_FOR_DEPLOYMENT');
assert.equal(result.deploymentAllowed,false);
assert.equal(result.sourceContractVerified,true);
assert.equal(result.releaseAllowlist,'BLOCKED');
assert.equal(result.observedProduction,'UNVERIFIED_OR_DIFFERENT');
assert.equal(result.selectedMainReviewed,false);
assert.equal(result.sourceVersion,'9.283');
assert.equal(result.sourceBlob,gasSourceBlobSha(candidate));
assert.equal(result.sourceInProductionFile,false);
assert.equal(result.financialWrites,0);
assert.equal(result.gasWrites,0);
assert.equal(result.telegramSends,0);
assert.equal(result.unresolved.length,6);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION/);
assert.throws(()=>inspectCombinedGasReleasePreflight({baseline:baseline+'// tampered'}),/PREFLIGHT_BASELINE_MISMATCH/);
const fakeSha='f'.repeat(40);
const fakeLive=inspectCombinedGasReleasePreflight({
 observedLiveVersion:'9.282',
 observedPublishedBlob:result.predecessorBlob,
 observedGateReleaseId:baseline.match(/var ISSUE507_GATE_RELEASE_ID='([a-f0-9]{64})'/)[1],
 observedGateMode:'OPEN',
 verifiedReviewHead:fakeSha,mergedMainHead:fakeSha
});
assert.equal(fakeLive.observedProduction,'EXACT_V9282_GATED');
assert.equal(fakeLive.selectedMainReviewed,true);
assert.equal(fakeLive.deploymentAllowed,false,'synthetic live facts never authorize release');
assert.equal(fakeLive.releaseAllowlist,'BLOCKED');
assert.equal(inspectCombinedGasReleasePreflight({
 observedLiveVersion:'9.282',
 observedPublishedBlob:'0'.repeat(40)
}).observedProduction,'UNVERIFIED_OR_DIFFERENT');
new vm.Script(candidate,{filename:'combined-9.283-candidate.gs'});
assert.equal(fs.readFileSync('src/gas/apps_script.gs','utf8'),baseline);
console.log('GAS_COMBINED_9283_RELEASE_PREFLIGHT_PASS '+JSON.stringify({
 candidateBlob:result.sourceBlob,
 predecessorBlob:result.predecessorBlob,
 nhReviewedBlob:result.nhPreviewBlob,
 deployable:false,
 liveStateVerified:false,
 financeWrites:0
}));
