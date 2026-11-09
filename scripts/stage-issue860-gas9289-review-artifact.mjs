#!/usr/bin/env node
// Offline, reproducible release-review artifact for #860.
// Never authenticates or writes to GAS, Sheets, triggers or Telegram.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';

const PARENT_BLOB='9e8584032daf896c5cffedb02041b604ee82ed07';
const REVIEW_BLOB='e6c0d8eba5eba8012ae761de7f436e86601b63d9';
const {parent,candidate,manifest}=composeIssue860Gas9289PerfCandidate();

assert.equal(manifest.parentVersion,'9.288');
assert.equal(manifest.candidateVersion,'9.289');
assert.equal(manifest.parentSourceGitBlob,PARENT_BLOB);
assert.equal(manifest.candidateSourceGitBlob,REVIEW_BLOB);
assert.equal(gasSourceBlobSha(parent),PARENT_BLOB);
assert.equal(gasSourceBlobSha(candidate),REVIEW_BLOB);
assert.equal(assertGasReleaseReady(parent),'9.288');
assert.throws(()=>assertGasReleaseReady(candidate),
 /GAS_RELEASE_UNREVIEWED_VERSION: 9\.289/,
 'Review artifact must never authorize deployment');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.waitingOnTradeV2Release,true);
new vm.Script(candidate,{filename:'gas9289-source-for-review-only.gs'});

const dir='artifacts/issue860-gas9289-perf-source-review';
fs.mkdirSync(dir,{recursive:true});
const sourcePath=path.join(dir,'apps_script.gs');
const manifestPath=path.join(dir,'manifest.json');
fs.writeFileSync(sourcePath,candidate,'utf8');
const review={
 kind:'ISSUE860_9289_SOURCE_ONLY_NOT_APPROVED',
 parentVersion:'9.288',candidateVersion:'9.289',
 parentSourceGitBlob:PARENT_BLOB,candidateSourceGitBlob:REVIEW_BLOB,
 sourceFilename:'apps_script.gs',sourceSha:REVIEW_BLOB,
 changedFunctions:manifest.proposedFunctionChanges,
 financeWriterUnchanged:true,tradeV2MigrationUnchanged:true,
 requiresProduction9288First:true,requiresExplicitSeparateReview:true,
 requiresManualDryRun:true,requiresManualReleaseApproval:true,
 reviewedForProduction:false,deployAllowed:false,
 gasProductionUpdated:false,financialSheetsModified:false,
 currentRuntimePerformanceMeasured:false,
 financeWrites:0,gasProjectWrites:0,telegramSends:0
};
fs.writeFileSync(manifestPath,JSON.stringify(review,null,2)+'\n','utf8');
assert.equal(gasSourceBlobSha(fs.readFileSync(sourcePath,'utf8')),REVIEW_BLOB);
assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath,'utf8')),review);
console.log(JSON.stringify({
 kind:'ISSUE860_9289_SOURCE_REVIEW_ARTIFACT_READY',
 parentBlob:PARENT_BLOB,candidateBlob:REVIEW_BLOB,
 status:'REVIEW_ONLY_DEPLOY_BLOCKED',
 sourceReviewFiles:2,financeWrites:0,gasDeployments:0,telegramSends:0
}));
