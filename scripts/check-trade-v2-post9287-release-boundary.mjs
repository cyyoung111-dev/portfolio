#!/usr/bin/env node
// #734 source-only gate: the 14-column trade-v2 preview must never regress
// the published v9.287 fund/Snapshot hotfix. No network, Sheets, or deploy.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeFundSnapshot9287SourcePreview}
  from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9286IntegratedPreview}
  from './compose-gas9286-integrated-preview.mjs';
import {assertGasReleaseReady,extractExpectedGasVersion,gasSourceBlobSha}
  from './deploy-gas.mjs';

const live=composeFundSnapshot9287SourcePreview();
const legacy=composeGas9286IntegratedPreview();
assert.equal(live.manifest.candidateVersion,'9.287');
assert.equal(live.manifest.candidateSourceGitBlob,
 'e2f5239746598754305eb603bc33651f5c36d914');
assert.equal(gasSourceBlobSha(live.candidate),live.manifest.candidateSourceGitBlob);
assert.equal(assertGasReleaseReady(live.candidate),'9.287');
assert.equal(legacy.manifest.parentVersion,'9.284');
assert.equal(legacy.manifest.proposedVersion,'9.286');
assert.equal(legacy.manifest.columns,14);
assert.equal(legacy.manifest.tradeLedgerProtocolVersion,2);
assert.equal(legacy.manifest.productionDeploymentApproved,false);
assert.equal(legacy.manifest.requiresProductionMigration,true);
assert.equal(extractExpectedGasVersion(legacy.candidate),'9.286');
assert.throws(()=>assertGasReleaseReady(legacy.candidate),
 /GAS_RELEASE_UNREVIEWED_VERSION: 9\.286/,
 'Historical 9.286 preview must not replace the reviewed 9.287 production source');

const functionBody=(source,name)=>{
 const start=source.indexOf('function '+name+'(');
 assert(start>=0,'Missing GAS function '+name);
 const end=source.indexOf('\n}',start);
 assert(end>start,'Unterminated GAS function '+name);
 return source.slice(start,end+2);
};
// The preexisting trade-v2 preview already contains the identical fund
// writer, backed-up scoped Snapshot writer and timing probes. Preserve all of
// them verbatim when designing a future version based on v9.287.
for(const name of [
 '_refreshFundValuations','_backupSheetBeforeWrite','writeSnapshotRows'
])assert.equal(
 functionBody(legacy.candidate,name),functionBody(live.candidate,name),
 'Trade-v2 ancestor cannot replace v9.287 finance function: '+name);

for(const name of [
 '_tradeV2ValidateMutation_','_tradeV2MigrationPlan_',
 'handleTradeSyncV2WithReceipt_','handleTradeV2ReceiptReadOnly_'
])assert.ok(functionBody(legacy.candidate,name),
 '14-column v2 functionality must be available for future source review');
assert(legacy.candidate.includes("params.action === 'syncTradesV2'"));
assert(legacy.candidate.includes('intendedRows.length, 14)'));
assert(!live.candidate.includes("params.action === 'syncTradesV2'"));
assert(!live.candidate.includes('function _tradeV2ValidateMutation_('));

// Version 9.288 is merely a suggested NEXT release identifier, not a GAS
// deployment candidate. Reject even a version-label-only promotion of 9.286.
const renamed=legacy.candidate.replaceAll('9.286','9.288');
assert.equal(extractExpectedGasVersion(renamed),'9.288');
assert.throws(()=>assertGasReleaseReady(renamed),
 /GAS_RELEASE_UNREVIEWED_VERSION: 9\.288/,
 'A new version number does not authorize a financial writer');
new vm.Script(live.candidate,{filename:'reviewed-live-9287.gs'});
new vm.Script(legacy.candidate,{filename:'historical-v2-9286.gs'});
console.log('TRADE_V2_POST9287_RELEASE_BOUNDARY_PASS '+JSON.stringify({
 productionVersion:'9.287',productionSourcePinned:true,
 tradePreviewVersion:'9.286',tradePreviewDeployable:false,
 nextCandidate:'NOT_CREATED',nextReleaseApproval:false,
 v2SchemaColumns:14,immutableFundFunctionParity:3,
 verifiedShadowRows:'CHECK_SEPARATELY_WITH_GSHEET_CONNECTOR',
 gasWrites:0,financialWrites:0,telegramSends:0
}));
