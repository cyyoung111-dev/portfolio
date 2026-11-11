#!/usr/bin/env node
// Exact full-source regression: no GAS/Sheet API and no deployment.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';
import {composeIssue860Gas9290Preview} from './compose-issue860-gas9290-preview.mjs';
import {extractExpectedGasVersion,gasSourceBlobSha} from './deploy-gas.mjs';

function functions(source){
 const out=new Map();
 for(const m of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)){
  const end=source.indexOf('\n}',m.index);
  assert(end>m.index&&!out.has(m[1]),'ISSUE860_FUNCTION_BOUNDARY_'+m[1]);
  out.set(m[1],source.slice(m.index,end+2));
 }
 return out;
}
const {parent,source,manifest}=composeIssue860Gas9291Preview();
const prev=composeIssue860Gas9290Preview();
assert.equal(parent,prev.candidate);
assert.equal(manifest.parentGitBlob,gasSourceBlobSha(parent));
assert.equal(manifest.sourceGitBlob,gasSourceBlobSha(source));
assert.equal(manifest.parentGitBlob,'fa12c26b6b6d5f85d6d0e9f17d650a8824d0316c');
assert.equal(extractExpectedGasVersion(parent),'9.290');
assert.equal(extractExpectedGasVersion(source),'9.291');
assert.equal(manifest.sourceOnly,true);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasDeployments,0);
assert.equal(manifest.telegramSends,0);
assert.equal(manifest.explicitManualReleaseRequired,true);
new vm.Script(source,{filename:'issue860-v9291-source-only.gs'});
const before=functions(parent),after=functions(source);
const added=[...after.keys()].filter(x=>!before.has(x)).sort();
assert.deepEqual(added,manifest.addedFunctions);
const changed=[];
for(const [name,body] of before){
 const revised=after.get(name);
 assert(revised,'Missing old GAS function '+name);
 if(revised.replaceAll("gasVersion: '9.291'","gasVersion: '9.290'")!==body)
  changed.push(name);
}
assert.deepEqual(changed.sort(),manifest.changedFunctions.slice().sort());
const protectedNames=[
 '_issue507GateInvoke_','_issue507GateEnter_',
 '_tradeV2MigrationManual_','runTradeV2MigrationPreflight',
 'runTradeV2MigrationApply','runTradeV2MigrationRestore',
 '_tradeV2ValidateMutation_','handleTradeSyncV2WithReceipt_',
 'saveDailyPriceHistory','writeSnapshotRows','_writeSnapshotDateScoped_',
 '_snapshotRewritePlan','diagnoseSnapshotIntegrity','diagnosePriceHistoryIntegrity',
 '_readRawSnapshotRowsByDate','_backupSnapshotBeforeWrite','_settleSnapshotBackupOperation',
 'runDeferredFundAfterPortfolioCloseFailure','_reconcilePortfolioFundBusy_',
 '_portfolioCloseRunState','_recordPortfolioCloseStage'
];
for(const name of protectedNames)assert.equal(after.get(name),before.get(name),
 'RELEASE_PROTECTED_FUNCTION_CHANGED_'+name);
assert.match(after.get('runPortfolioCloseWatchdog2030'),/var priceRecovery=_issue860RecoverStoredPriceWatchdog_\(\);/);
assert.match(after.get('_scheduleFundAfterFailedPortfolioPrice_'),/ISSUE860_STORED_PRICE_SOURCE_CHANGED/);
assert.match(after.get('_issue860RecoverStoredPriceWatchdog_'),/PRICE_COMPLETE_NAV_PENDING/);
assert.match(after.get('_issue860RecoverStoredPriceWatchdog_'),/STORED_PRICE_NAV_HANDOFF_UNVERIFIED/);
const again=composeIssue860Gas9291Preview();
assert.equal(again.manifest.sourceGitBlob,manifest.sourceGitBlob);
console.log(JSON.stringify({kind:'ISSUE860_9291_SOURCE_ONLY_REVIEW_PASS',
 version:manifest.candidateVersion,sourceGitBlob:manifest.sourceGitBlob,
 parentGitBlob:manifest.parentGitBlob,
 changedFunctions:changed,addedFunctions:added,
 protectedFunctionsUnchanged:protectedNames.length,
 tradeV2AndWriterGatesUnchanged:true,releaseRequiresSeparateManualApproval:true,
 financeWrites:0,gasDeployments:0,telegramSends:0}));
