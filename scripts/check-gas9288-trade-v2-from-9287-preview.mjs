#!/usr/bin/env node
// Pure offline check. Builds candidate in memory; never calls GAS/Sheets.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {composeFundSnapshot9287SourcePreview}
  from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9286IntegratedPreview}
  from './compose-gas9286-integrated-preview.mjs';
import {gasSourceBlobSha,extractExpectedGasVersion,assertGasReleaseReady}
  from './deploy-gas.mjs';

const {base,candidate,manifest}=composeGas9288TradeV2From9287Preview();
const live=composeFundSnapshot9287SourcePreview().candidate;
const old=composeGas9286IntegratedPreview().candidate;
assert.equal(base,live,'parent must be exactly approved current 9.287');
assert.equal(manifest.parentVersion,'9.287');
assert.equal(manifest.candidateVersion,'9.288');
assert.equal(manifest.parentSourceGitBlob,'e2f5239746598754305eb603bc33651f5c36d914');
assert.equal(gasSourceBlobSha(base),manifest.parentSourceGitBlob);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceGitBlob);
assert.equal(extractExpectedGasVersion(candidate),'9.288');
assert.equal(assertGasReleaseReady(live),'9.287');
assert.equal(assertGasReleaseReady(candidate),'9.288',
 'Exactly reviewed 9.288 source is pinned; deployment requires separate manual approval');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.requiresManualReleaseApproval,true);
assert.equal(manifest.requiresProductionMigration,true);
assert.equal(manifest.columns,14);
assert.equal(manifest.tradeLedgerProtocolVersion,2);
assert.equal(manifest.introducedFunctions.length,13);
assert.deepEqual(Array.from(manifest.manualMigrationFunctions).sort(),[
 '_tradeV2MigrationManual_','runTradeV2MigrationApply',
 'runTradeV2MigrationPreflight','runTradeV2MigrationRestore'
].sort());
assert.equal(manifest.migrationApplyRequiresApproval,true);
assert.equal(manifest.migrationBackupNeverAutomaticallyDeleted,true);
assert.equal(manifest.migrationPreservesSourceColumns,'A:K');
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(manifest.telegramSends,0);
new vm.Script(candidate,{filename:'undeployed-gas9288-trade-v2.gs'});
const fn=(src,name)=>{
 const start=src.indexOf('function '+name+'(');
 assert(start>=0,'missing function '+name);
 const end=src.indexOf('\n}',start);
 assert(end>start,'unterminated function '+name);
 return src.slice(start,end+2);
};
for(const name of manifest.protectedFinanceFunctions)
 assert.equal(fn(candidate,name),fn(live,name),
  '9.287 finance writer/backup/gate must be byte-identical: '+name);
for(const name of ['_tradeV2ValidateMutation_','_tradeV2ReceiptInput_',
 '_tradeV2CheckpointVerified_','_tradeV2MigrationPlan_',
 'handleTradeSyncV2WithReceipt_','handlePreviewTradeLedgerV2Migration_'])
 assert.equal(fn(candidate,name),fn(old,name),
  'only previously tested v2 helper may be transplanted: '+name);
for(const name of ['handleSyncTrades','handleGetTrades','handleGetBootstrap',
 '_portfolioSyncCanonical_','_recordPortfolioSyncSnapshotCompletion_'])
 assert.equal(fn(candidate,name).replaceAll("gasVersion: '9.288'","gasVersion: '9.286'"),
  fn(old,name),'v2 business function must match previously tested candidate: '+name);
assert(candidate.includes("params.action === 'syncTradesV2'"));
assert(candidate.includes("params.action === 'previewTradeLedgerV2Migration'"));
assert(candidate.includes('function runTradeV2MigrationApply()'));
assert(candidate.includes('function runTradeV2MigrationRestore()'));
assert(!fn(candidate,'doPost').includes('runTradeV2MigrationApply'));
assert(!fn(candidate,'doGet').includes('runTradeV2MigrationRestore'));
assert(candidate.includes("var ISSUE507_GATE_API_VERSION='9.288'"));
assert.equal((candidate.match(/gasVersion: '9\.288'/g)||[]).length,9);
assert.equal((candidate.match(/gasVersion: '9\.287'/g)||[]).length,0);
assert.equal((candidate.match(/gasVersion: '9\.286'/g)||[]).length,0);
assert(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8').includes('approve_9288:'),
 '9.288 requires explicit manual workflow approval input');
assert(fs.readFileSync('scripts/deploy-gas.mjs','utf8').includes("'9.288': '9e8584032daf896c5cffedb02041b604ee82ed07'"),
 '9.288 release must use exact reviewed candidate blob');
console.log('GAS9288_TRADE_V2_SOURCE_ONLY_PASS '+JSON.stringify({
 parentVersion:manifest.parentVersion,nextVersion:manifest.candidateVersion,
 parentReviewed:true,candidateReleased:false,
 financeExactParity:manifest.protectedFinanceFunctions.length,
 introducedFunctions:manifest.introducedFunctions.length,
 transplantedFunctions:manifest.transplantedFunctions,
 schemaColumns:14,financeWrites:0,gasProjectWrites:0,telegramSends:0
}));
