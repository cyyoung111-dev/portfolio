#!/usr/bin/env node
// #860 exact next-release source composition and immutable finance safety.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,extractExpectedGasVersion} from './deploy-gas.mjs';

function funcs(source){
 const out=new Map();
 for(const m of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)){
  const end=source.indexOf('\n}',m.index);
  assert(end>m.index&&!out.has(m[1]),'FUNCTION_BOUNDARY_'+m[1]);
  out.set(m[1],source.slice(m.index,end+2));
 }return out;
}
const {parent,candidate,manifest}=composeIssue860Gas9289PerfCandidate();
const approved9288=composeGas9288TradeV2From9287Preview();
assert.equal(parent,approved9288.candidate);
assert.equal(gasSourceBlobSha(parent),'9e8584032daf896c5cffedb02041b604ee82ed07');
assert.equal(manifest.parentSourceGitBlob,gasSourceBlobSha(parent));
assert.equal(manifest.candidateSourceGitBlob,gasSourceBlobSha(candidate));
assert.equal(extractExpectedGasVersion(parent),'9.288');
assert.equal(extractExpectedGasVersion(candidate),'9.289');
assert.equal(assertGasReleaseReady(parent),'9.288');
assert.equal(assertGasReleaseReady(candidate),'9.289',
 'Exact reviewed source hash is pinned; manual approval and migrated-ledger gate are still mandatory');
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.waitingOnTradeV2Release,true);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasDeployments,0);
new vm.Script(candidate,{filename:'undeployed-issue860-gas9289.gs'});
const base=funcs(parent),next=funcs(candidate);
assert.deepEqual([...next.keys()],[...base.keys()],
 'No public GAS functions may be introduced or removed');
const changes=[];
for(const [name,original] of base){
 const normalized=next.get(name).replaceAll("gasVersion: '9.289'","gasVersion: '9.288'");
 if(original!==normalized)changes.push(name);
}
assert.deepEqual(changes.sort(),manifest.proposedFunctionChanges.slice().sort(),
 'Only the five specifically tested Snapshot/diagnostic functions may change');
for(const name of [
 'runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
 'runDeferredFundAfterPortfolioCloseFailure','_refreshFundValuations',
 '_backupSheetBeforeWrite','_backupSnapshotBeforeWrite','writeSnapshotRows',
 '_writeSnapshotDateScoped_','_issue507GateInvoke_','_issue507GateEnter_',
 '_tradeV2MigrationManual_','runTradeV2MigrationPreflight',
 'runTradeV2MigrationApply','runTradeV2MigrationRestore',
 '_tradeV2ValidateMutation_','handleTradeSyncV2WithReceipt_'
]){
 assert(base.has(name),name+' missing');
 assert.equal(next.get(name),base.get(name),'Protected finance/trade code drift: '+name);
}
assert(candidate.includes("var ISSUE507_GATE_API_VERSION='9.289'"));
assert(candidate.includes('function runTradeV2MigrationRestore()'));
assert(candidate.includes("params.action === 'syncTradesV2'"));
assert(candidate.includes('[ISSUE860_CLOSE_STAGE]'));
assert(candidate.includes('[ISSUE860_FUND_STAGE]'));
assert(!candidate.includes("ISSUE507_GATE_API_VERSION='9.288'"));
const check=composeIssue860Gas9289PerfCandidate();
assert.equal(candidate,check.candidate,'Build must be byte-for-byte deterministic');
console.log(JSON.stringify({
 kind:'ISSUE860_GAS9289_REVIEW_CANDIDATE_PASS',
 parentVersion:manifest.parentVersion,
 version:manifest.candidateVersion,
 parentSourceGitBlob:manifest.parentSourceGitBlob,
 candidateSourceGitBlob:manifest.candidateSourceGitBlob,
 changedBusinessFunctions:changes,
 protectedBusinessFunctions:base.size-changes.length,
 migrationUnchanged:true,
 financeSourceProtected:true,sourceOnly:true,
 deployApproved:false,financialWrites:0
}));
