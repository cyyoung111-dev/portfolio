#!/usr/bin/env node
// Prevent trade-v2 operator guidance from going stale after a release-gate PR.
// No network calls, GAS execution, financial sheet mutations or secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady,assertIssue507ManualReleasePermission} from './deploy-gas.mjs';

const doc=fs.readFileSync('docs/TRADE_LEDGER_V2_MIGRATION_RUNBOOK_20261110.md','utf8');
const yml=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
const {candidate,manifest}=composeGas9288TradeV2From9287Preview();
assert.equal(manifest.candidateVersion,'9.288');
assert.equal(gasSourceBlobSha(candidate),'9e8584032daf896c5cffedb02041b604ee82ed07');
assert.equal(assertGasReleaseReady(candidate),'9.288');
assert.match(doc,/Watchdog 복구/);
assert.match(doc,/첫 실행 타임아웃/);
assert.match(doc,/19:33 첫 실행 타임아웃/);
assert.match(doc,/338건/);
assert.match(doc,/A:K/);
assert.match(doc,/L=외화단가, M=매입환율, N=거래ID/);
assert.match(doc,/9e8584032daf896c5cffedb02041b604ee82ed07/);
assert.match(doc,/use_9288_trade_v2/);
assert.match(doc,/approve_9288/);
assert.match(doc,/Apps Script 345/);
assert.match(doc,/42651714952/);
assert.match(doc,/42682944711/);
assert.match(doc,/실제 게시 완료/);
assert.match(doc,/338건 L:N 이관은 아직 미실행/);
assert.match(doc,/writerIsolationConfirmed/);
assert.match(doc,/trade_v2_migration_approval_v1/);
assert.match(doc,/runTradeV2MigrationPreflight/);
assert.match(doc,/runTradeV2MigrationApply/);
assert.match(doc,/runTradeV2MigrationRestore/);
assert.match(doc,/"approvedDate": "<실제 실행일 YYYY-MM-DD \(KST\)>"/);
assert.match(doc,/v9\.289/);
assert.doesNotMatch(doc,/현재 \`scripts\/deploy-gas\.mjs\`는 v9\.288 소스를 \*승인하지 않으며\*/);
assert.doesNotMatch(doc,/"approvedDate": "2026-11-10"/);
assert.match(yml,/use_9288_trade_v2:\s*\n[\s\S]*?default:\s*false/);
assert.match(yml,/approve_9288:\s*\n[\s\S]*?default:\s*false/);
for(const [name,flag] of [['unapproved',false],['approved',true]]){
 const args={version:'9.288',eventName:'workflow_dispatch',approved9288:flag};
 if(flag)assert.doesNotThrow(()=>assertIssue507ManualReleasePermission(args));
 else assert.throws(()=>assertIssue507ManualReleasePermission(args),
  /GAS_9288_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
}
assert.throws(()=>assertIssue507ManualReleasePermission({
 version:'9.288',eventName:'workflow_run',approved9288:true
}),/GAS_9288_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
console.log(JSON.stringify({status:'TRADE_V2_CUTOVER_RUNBOOK_CURRENT_PASS',
 docAlignedWithReviewedSource:true,approvedCandidateVersion:'9.288',
 manualDispatchOnly:true,explicitApprovalRequired:true,
 approvalDateDynamic:true,sourceWrites:0,gasDeployments:0}));
