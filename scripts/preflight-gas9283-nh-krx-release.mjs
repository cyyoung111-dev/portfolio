// Read-only review evidence for the combined GAS v9.283 candidate.
// DO NOT consume this module as a source for production deployment.
// No APIs, files, credentials, manifests, triggers or finance data are mutated.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {gasSourceBlobSha,extractExpectedGasVersion,assertGasReleaseReady} from './deploy-gas.mjs';
import {prepareNh0645Gas9283} from './prepare-nh-0645-gas-release-9283.mjs';
import {prepareGasNh9283WithKrxTurnoverPreview} from './compose-gas9283-turnover-preview.mjs';

export const GAS_COMBINED_PREFLIGHT_STATUS='NOT_AUTHORIZED_FOR_DEPLOYMENT';
const PREDECESSOR_SHA='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const NH_REVIEW_SHA='22a5e37d48ca3b39c71dfa32d6afae5401ed4d5b';
const REQUIRED_VERSION='9.283';

export function inspectCombinedGasReleasePreflight({
 baseline=fs.readFileSync('reference/gas-v9.282.gs','utf8'),
 observedLiveVersion=null, observedPublishedBlob=null,
 observedGateReleaseId=null, observedGateMode=null,
 verifiedReviewHead=null, mergedMainHead=null
}={}){
 const expected=fs.readFileSync('reference/gas-v9.282.gs','utf8');
 if(gasSourceBlobSha(expected)!==PREDECESSOR_SHA ||
    typeof baseline!=='string'||gasSourceBlobSha(baseline)!==PREDECESSOR_SHA)
   throw Error('PREFLIGHT_BASELINE_MISMATCH');
 const {candidate:nhCandidate,manifest:nh}=prepareNh0645Gas9283();
 const {candidate,manifest}=prepareGasNh9283WithKrxTurnoverPreview();
 const newHash=gasSourceBlobSha(candidate);
 const gateId=baseline.match(/var ISSUE507_GATE_RELEASE_ID='([a-f0-9]{64})'/)?.[1]||'';
 if(!gateId || !candidate.includes("var ISSUE507_GATE_RELEASE_ID='"+gateId+"';"))
   throw Error('PREFLIGHT_WRITER_GATE_ID_MISMATCH');
 if(manifest.status!=='COMBINED_PREVIEW_NOT_DEPLOYABLE' ||
    nh.candidateBlob!==NH_REVIEW_SHA || gasSourceBlobSha(nhCandidate)!==NH_REVIEW_SHA ||
    extractExpectedGasVersion(candidate)!==REQUIRED_VERSION ||
    manifest.combinedPreviewBlob!==newHash)
   throw Error('PREFLIGHT_SOURCE_CANDIDATE_MISMATCH');
 const refs=[...candidate.matchAll(/\bgasVersion:\s*['"](\d+\.\d+)['"]/g)].map(x=>x[1]);
 if(refs.length!==9||refs.some(x=>x!==REQUIRED_VERSION) ||
    !candidate.includes("var ISSUE507_GATE_API_VERSION='9.283'") ||
    !candidate.includes('kst.minutes<405||kst.minutes>=480') ||
    candidate.includes('kst.minutes<450||kst.minutes>=480'))
   throw Error('PREFLIGHT_TIME_OR_VERSION_MISMATCH');
 const originalWrappers=(baseline.match(/_issue507GateInvoke_\('/g)||[]).length;
 const candidateWrappers=(candidate.match(/_issue507GateInvoke_\('/g)||[]).length;
 if(candidateWrappers!==originalWrappers+3)
   throw Error('PREFLIGHT_WRITER_GUARD_SCOPE_CHANGED');
 if((candidate.match(/function handleRepairF00001Snapshot/g)||[]).length!==
    (baseline.match(/function handleRepairF00001Snapshot/g)||[]).length)
   throw Error('PREFLIGHT_FINANCIAL_REPAIR_SCOPE_CHANGED');
 let releaseGate='BLOCKED';
 try{assertGasReleaseReady(candidate);releaseGate='APPROVED';}catch(e){
  if(e.message!=='GAS_RELEASE_UNREVIEWED_VERSION: 9.283' && !String(e.message).startsWith('GAS_RELEASE_SOURCE_NOT_APPROVED:'))
   throw Error('PREFLIGHT_UNEXPECTED_RELEASE_GATE');
 }
 if(releaseGate!=='BLOCKED')throw Error('PREFLIGHT_PREMATURE_SOURCE_APPROVAL');
 const validSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
 const deployedFactsConfirmed=observedLiveVersion==='9.282'
   &&observedPublishedBlob===PREDECESSOR_SHA
   &&observedGateReleaseId===gateId
   &&observedGateMode==='OPEN';
 const trustedMain=validSha(verifiedReviewHead)&&verifiedReviewHead===mergedMainHead;
 return {
  mode:'GAS_NH_KRX_COMBINED_RELEASE_PREFLIGHT',
  status:GAS_COMBINED_PREFLIGHT_STATUS,
  deploymentAllowed:false,
  sourceVersion:REQUIRED_VERSION,sourceBlob:newHash,
  predecessorBlob:PREDECESSOR_SHA,nhPreviewBlob:NH_REVIEW_SHA,
  sourceContractVerified:true,
  observedProduction:deployedFactsConfirmed?'EXACT_V9282_GATED':'UNVERIFIED_OR_DIFFERENT',
  selectedMainReviewed:trustedMain,
  sourceInProductionFile:false,
  releaseAllowlist:releaseGate,
  deployManifestApproved:false,manualApprovalReceived:false,
  productionEnvironmentVerified:false,
  postDeployHttpReadbackVerified:false,
  morningNhWindowLiveVerified:false,
  eveningKrxTurnoverLiveVerified:false,
  scheduledTelegramVerified:false,
  financialWrites:0,gasWrites:0,telegramSends:0,
  unresolved:[
   'VERIFY_LIVE_GAS_PUBLISHED_VERSION_AND_WRITER_GATE',
   'VERIFY_REVIEWED_MAIN_SHA_AND_MERGE_CHAIN',
   'APPROVE_EXACT_COMBINED_BLOB_AND_RELEASE_MANIFEST',
   'SYNC_ALL_GAS_VERSION_CONSUMERS_AND_MANUAL_DEPLOY_GUARDS',
   'AUTHORIZE_MANUAL_DEPLOYMENT_SEPARATELY',
   'VERIFY_LIVE_NH_0645_AND_KRX_1700_READBACK_BEFORE_CRON_AND_TELEGRAM'
  ]
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=inspectCombinedGasReleasePreflight();
 console.log(JSON.stringify(result));
}
