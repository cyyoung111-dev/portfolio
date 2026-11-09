#!/usr/bin/env node
// Offline source review artifact; no GAS, Sheets, portfolio writes or sends.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {composeGas9288TradeV2From9287Preview}
  from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {assertGasReleaseReady,gasSourceBlobSha}
  from './deploy-gas.mjs';
const {candidate,base,manifest}=composeGas9288TradeV2From9287Preview();
assert.equal(manifest.parentVersion,'9.287');
assert.equal(manifest.candidateVersion,'9.288');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.requiresProductionMigration,true);
assert.equal(gasSourceBlobSha(base),manifest.parentSourceGitBlob);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceGitBlob);
assert.throws(()=>assertGasReleaseReady(candidate),
 /GAS_RELEASE_UNREVIEWED_VERSION: 9\.288/);
new vm.Script(candidate,{filename:'gas9288-undeployed-source.gs'});
const dir='artifacts/gas9288-trade-v2-review';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'apps_script.gs'),candidate);
const review={...manifest,
  kind:'SOURCE_ONLY_TRADE_V2_UNAPPROVED',
  sourceFilename:'apps_script.gs',sourceSha:manifest.candidateSourceGitBlob,
  deployAllowed:false,migrationAllowed:false,reviewCompleted:false,
  productionGASChanged:false,productionSheetChanged:false,
  independentRuntimeE2E:'NOT_TESTED',
  financeWrites:0,gasProjectWrites:0,backupDeletes:0,telegramSends:0
};
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(review,null,2)+'\n');
assert.equal(gasSourceBlobSha(fs.readFileSync(path.join(dir,'apps_script.gs'),'utf8')),
 manifest.candidateSourceGitBlob);
console.log(JSON.stringify({kind:'GAS9288_SOURCE_REVIEW_READY',
 parentBlob:manifest.parentSourceGitBlob,candidateBlob:manifest.candidateSourceGitBlob,
 releaseDecision:'BLOCKED',migrationDecision:'BLOCKED',
 gasProjectWrites:0,financialWrites:0,telegramSends:0}));
