// #860 + #826. Reviewed exact v9.291 source -> source-only v9.292.
// One bounded change bundle: avoid the duplicated same-run Snapshot rebuild
// while preserving persisted row audit, and correct VKOSPI derivative API.
// This is NOT a release/deploy/approval and cannot touch private GAS/Sheets.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {gitBlobSha} from './compose-gas-vkospi-derivative-proposal.mjs';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';
import {composeIssue826Gas9291VkospiSourceOnly,ISSUE826_REVIEWED_GAS_9291_BLOB}
 from './compose-issue826-gas9291-vkospi-source-only.mjs';
import {composeIssue860CloseIntegrityReusePreview}
 from './compose-issue860-close-integrity-reuse-preview.mjs';

const once=(s,oldText,newText,label)=>{
 assert.equal(s.split(oldText).length,2,'ISSUE860_9292_SOURCE_DRIFT_'+label);
 return s.replace(oldText,newText);
};
export function composeIssue860Gas9292CloseOptimizationPreview(){
 const parent=composeIssue860Gas9291Preview();
 assert.equal(parent.manifest.candidateVersion,'9.291');
 assert.equal(parent.manifest.sourceGitBlob,ISSUE826_REVIEWED_GAS_9291_BLOB);
 assert.equal(gitBlobSha(parent.source),ISSUE826_REVIEWED_GAS_9291_BLOB);
 const vkospi=composeIssue826Gas9291VkospiSourceOnly(parent.source);
 const speed=composeIssue860CloseIntegrityReusePreview(vkospi.candidate);
 assert.equal(speed.snapshotReReadRetained,true);
 assert.equal(speed.priceIntegrityRetained,true);
 let source=speed.source;
 source=once(source,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.291',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.292','HEADER');
 const count=source.split("gasVersion: '9.291'").length-1;
 assert(count>=5&&count<=20,'ISSUE860_9292_VERSION_COUNT_UNVERIFIED');
 source=source.replaceAll("gasVersion: '9.291'","gasVersion: '9.292'");
 source=once(source,
  "var ISSUE507_GATE_API_VERSION='9.291'",
  "var ISSUE507_GATE_API_VERSION='9.292'",'GATE');
 new vm.Script(source,{filename:'issue860-gas9292-unreleased-preview.gs'});
 assert.equal(gitBlobSha(vkospi.parentSource),ISSUE826_REVIEWED_GAS_9291_BLOB);
 return Object.freeze({
  parentSource:parent.source,candidate:source,
  manifest:Object.freeze({
   baseVersion:'9.291',candidateVersion:'9.292',
   parentGitBlob:ISSUE826_REVIEWED_GAS_9291_BLOB,
   candidateGitBlob:gitBlobSha(source),
   protectedFunctionsUnchanged:true,
   changedBusinessFunctions:['diagnoseSnapshotIntegrity',
    'saveDailyPriceHistory','_readVkospiPointsFromKrx'],
   snapshotPersistedReadStillRequired:true,
   priceSourceAuditStillRequired:true,
   independentLiveKrxAccessNotVerified:true,
   sourceOnly:true,deployable:false,
   financeWrites:0,gasRequests:0,gasDeployments:0,telegramSends:0
  })
 });
}
