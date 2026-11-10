#!/usr/bin/env node
// #860 immutable source-only successor, no OAuth, no Sheets or GAS network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9290Preview} from './compose-issue860-gas9290-preview.mjs';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {assertGasReleaseReady,gasSourceBlobSha,extractExpectedGasVersion} from './deploy-gas.mjs';

function functions(source) {
 const out=new Map();
 for(const match of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
  const end=source.indexOf('\n}',match.index);
  assert(end>match.index&&!out.has(match[1]),'FUNCTION_BOUNDARY_'+match[1]);
  out.set(match[1],source.slice(match.index,end+2));
 }
 return out;
}
const {parent,candidate,manifest}=composeIssue860Gas9290Preview();
const approvedParent=composeIssue860Gas9289PerfCandidate();
assert.equal(parent,approvedParent.candidate);
assert.equal(gasSourceBlobSha(parent),'e6c0d8eba5eba8012ae761de7f436e86601b63d9');
assert.equal(manifest.parentSourceGitBlob,gasSourceBlobSha(parent));
assert.equal(manifest.candidateSourceGitBlob,gasSourceBlobSha(candidate));
assert.equal(extractExpectedGasVersion(parent),'9.289');
assert.equal(extractExpectedGasVersion(candidate),'9.290');
assert.equal(assertGasReleaseReady(parent),'9.289');
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION/,
 'Source-only next version is not approved/deployable just by existence');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasDeployments,0);
assert.equal(manifest.telegramSends,0);
new vm.Script(candidate,{filename:'undeployed-issue860-v9290.gs'});
const before=functions(parent),after=functions(candidate);
assert.deepEqual([...after.keys()],[...before.keys()]);
const changed=[];
for(const [name,body] of before) {
 const normalized=after.get(name).replaceAll("gasVersion: '9.290'","gasVersion: '9.289'");
 if(body!==normalized)changed.push(name);
}
assert.deepEqual(changed.sort(),manifest.changedBusinessFunctions.slice().sort());
for(const name of [
 '_writeSnapshotDateScoped_','_backupSheetBeforeWrite','_backupSnapshotBeforeWrite',
 '_settleSnapshotBackupOperation','_readRawSnapshotRowsByDate',
 '_snapshotRewritePlan','_buildSnapshotRowsFromTradeAndPriceHistory',
 'diagnosePriceHistoryIntegrity','_readPriceIntegrityContext',
 '_refreshFundValuations','runDailyPortfolioClose1900',
 'runPortfolioCloseWatchdog2030','runDeferredFundAfterPortfolioCloseFailure',
 '_issue507GateInvoke_','_issue507GateEnter_',
 '_tradeV2MigrationManual_','runTradeV2MigrationPreflight',
 'runTradeV2MigrationApply','runTradeV2MigrationRestore',
 '_tradeV2ValidateMutation_','handleTradeSyncV2WithReceipt_'
]) {
 assert(before.has(name),'Missing protected function '+name);
 assert.equal(after.get(name),before.get(name),'PROTECTED_BUSINESS_DRIFT_'+name);
}
assert(candidate.includes("var ISSUE507_GATE_API_VERSION='9.290'"));
assert(candidate.includes('ISSUE860_FRESH_DATE_APPEND'));
assert(candidate.includes('ISSUE860_PREVERIFIED_EXPECTED_ROWS'));
assert(candidate.includes('[ISSUE860_CLOSE_STAGE]'));
assert(candidate.includes('[ISSUE860_FUND_STAGE]'));
assert(candidate.includes('function runTradeV2MigrationRestore()'));
assert(candidate.includes("params.action === 'syncTradesV2'"));
assert(!candidate.includes("gasVersion: '9.289'"));
const oneMore=composeIssue860Gas9290Preview();
assert.equal(candidate,oneMore.candidate);
assert.equal(manifest.candidateSourceGitBlob,oneMore.manifest.candidateSourceGitBlob);
console.log(JSON.stringify({
 kind:'ISSUE860_GAS9290_SOURCE_REVIEW_PASS',
 parentVersion:manifest.parentVersion,proposedVersion:manifest.candidateVersion,
 parentSourceGitBlob:manifest.parentSourceGitBlob,
 candidateSourceGitBlob:manifest.candidateSourceGitBlob,
 changedBusinessFunctions:changed,untouchedBusinessFunctions:before.size-changed.length,
 migrationUnchanged:true,financeWriterRecoveryUnchanged:true,
 writerGateUnchanged:true,releasePinBlocked:true,
 sourceOnly:true,financialWrites:0,gasDeployments:0,telegramSends:0
}));
