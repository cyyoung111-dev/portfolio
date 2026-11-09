#!/usr/bin/env node
// Source-only fund/Snapshot hotfix package for release review.
// This creates only a local GitHub Actions artifact, never a GAS deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {extractExpectedGasVersion,gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';

const {parent,candidate,manifest}=composeFundSnapshot9287SourcePreview();
assert.equal(manifest.purpose,'FUND_SNAPSHOT_HOTFIX_NO_TRADE_V2');
assert.equal(manifest.releaseMode,'SOURCE_PREVIEW_ONLY');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.tradeLedgerMigrationRequired,false);
assert.equal(manifest.tradeLedgerV2Included,false);
assert.equal(extractExpectedGasVersion(parent),'9.285');
assert.equal(extractExpectedGasVersion(candidate),'9.287');
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceGitBlob);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION/);
assert(!candidate.includes("params.action === 'syncTradesV2'"));
new vm.Script(candidate,{filename:'review-gas9287-fund-only.gs'});

const dir='artifacts/gas9287-fund-review';
fs.mkdirSync(dir,{recursive:true});
const before=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.equal(before,parent,'Working GAS must remain exact reviewed parent');
const sourcePath=path.join(dir,'apps_script.gs');
const manifestPath=path.join(dir,'manifest.json');
const review={
 ...manifest,
 packageKind:'IMMUTABLE_SOURCE_REVIEW_NO_DEPLOY',
 sourceFile:'apps_script.gs',
 sourceSha:manifest.candidateSourceGitBlob,
 verifiedAgainstCurrentStagedSource:gasSourceBlobSha(before)===manifest.parentSourceGitBlob,
 validatedSyntax:true,
 nextStep:'SEPARATE_FULL_SOURCE_PIN_WEB_CONSUMER_DRY_RUN_AND_MANUAL_APPROVAL',
 deploymentDecision:'BLOCKED',
 runtimeMeasurements:'NOT_LIVE',
 signedAtRuntime:false,
 financialWrites:0,backupDeletes:0,telegramSends:0,gasDeployments:0
};
fs.writeFileSync(sourcePath,candidate);
fs.writeFileSync(manifestPath,JSON.stringify(review,null,2)+'\n');
assert.equal(gasSourceBlobSha(fs.readFileSync(sourcePath,'utf8')),review.sourceSha);
assert.equal(fs.readFileSync('src/gas/apps_script.gs','utf8'),parent);
console.log(JSON.stringify({kind:'GAS9287_FUND_HOTFIX_REVIEW_READY',
 sourceBlob:review.sourceSha,parentBlob:manifest.parentSourceGitBlob,
 proposedVersion:manifest.candidateVersion,tradeMigrationRequired:false,
 deploymentDecision:'BLOCKED',realGasReads:0,realGasWrites:0,financialWrites:0}));
