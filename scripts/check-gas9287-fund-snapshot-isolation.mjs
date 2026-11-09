#!/usr/bin/env node
// Independent, read-only release boundary proof. No GAS / Sheets API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
import {extractExpectedGasVersion,assertGasReleaseReady,assertIssue507ManualReleasePermission} from './deploy-gas.mjs';

const sha=s=>{
  const b=Buffer.from(s,'utf8');
  return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
};
const {parent,candidate,manifest}=composeFundSnapshot9287SourcePreview();
assert.equal(manifest.parentSourceGitBlob,'954fd4aeae767ddac0cb161d3a81003b5b699d1c');
assert.equal(sha(parent),manifest.parentSourceGitBlob);
assert.equal(sha(candidate),manifest.candidateSourceGitBlob);
assert.equal(parent,fs.readFileSync('reference/gas-v9.285.gs','utf8'),
  'Reviewed fund-only parent must match exact reference source');
assert.equal(parent,fs.readFileSync('src/gas/apps_script.gs','utf8'),
  'Current staged GAS candidate must remain pinned and untouched');
assert.equal(extractExpectedGasVersion(parent),'9.285');
assert.equal(extractExpectedGasVersion(candidate),'9.287');
assert.equal(manifest.purpose,'FUND_SNAPSHOT_HOTFIX_NO_TRADE_V2');
assert.equal(manifest.releaseMode,'SOURCE_PREVIEW_ONLY');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.approvedForGasDeploy,false);
assert.equal(manifest.webVersionCompatible,true);
assert.equal(manifest.tradeLedgerV2Included,false);
assert.equal(manifest.tradeLedgerMigrationRequired,false);
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(manifest.telegramSends,0);
assert.equal(assertGasReleaseReady(candidate),'9.287',
  'Reviewed exact source must be pinned without authorizing automatic production writes');
assert.throws(()=>assertIssue507ManualReleasePermission({
  version:'9.287',eventName:'workflow_run',approved9287:true
}),/GAS_9287_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.throws(()=>assertIssue507ManualReleasePermission({
  version:'9.287',eventName:'workflow_dispatch',approved9287:false
}),/GAS_9287_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert(fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8')
  .includes("'9.287'"),'The unchanged 9.285 web API must allow 9.287 source version');
const deployWorkflow=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
assert.match(deployWorkflow,/approve_9287:[\s\S]*?default: false/,
  'Production approval must be explicit and false by default');
assert.match(deployWorkflow,/use_9287_fund_hotfix:[\s\S]*?default: false/,
  'Fund-only source selection must also be opt-in');
new vm.Script(candidate,{filename:'gas9287-fund-snapshot-source-only.gs'});
assert.equal((candidate.match(/gasVersion: '9\.287'/g)||[]).length,9);
assert.equal((candidate.match(/var ISSUE507_GATE_API_VERSION='9\.287'/g)||[]).length,1);

const func=(source,name)=>{
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'Missing function '+name);
  const end=source.indexOf('\n}',start);
  assert(end>start,'Unterminated function '+name);
  return source.slice(start,end+2);
};
// Exact 9.285 fund and writer-admission behavior, no extra public entrypoints.
for(const name of [
  '_refreshFundValuations','_fundNavExpectedPublicationDate',
  '_fundDailyValues','_fundValueNeedsProcessing',
  '_writeSnapshotDateScoped_','_sheetContentSignature',
  '_issue507GateEnter_','handleSyncTrades'
])assert.equal(func(candidate,name),func(parent,name),'Unexpected function change '+name);
assert(!candidate.includes('function _tradeV2ValidateMutation_('));
assert(!candidate.includes("params.action === 'syncTradesV2'"));
const funcs=source=>[...source.matchAll(/^function [A-Za-z_$][\w$]*\s*\(/gm)].length;
assert.equal(funcs(candidate),funcs(parent),'No new GAS entrypoints allowed');

// The separate integrated preview has the SAME optimized/profiler body,
// proving we didn't alter financial restore behavior in the fund-only track.
const integrated=composeGas9286IntegratedPreview().candidate;
for(const name of ['_backupSheetBeforeWrite','writeSnapshotRows'])
  assert.equal(func(candidate,name),func(integrated,name),
    'Backup / scoped writer must equal tested integrated profile '+name);

// Reverse exactly the authorized changes. All remaining source bytes must
// equal reviewed fund-only v9.285. This rejects hidden trade/schema changes.
let restored=candidate;
for(const name of ['_backupSheetBeforeWrite','writeSnapshotRows']){
  const revised=func(restored,name);
  assert.equal(restored.split(revised).length,2);
  restored=restored.replace(revised,func(parent,name));
}
restored=restored.replace(
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.287',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.285');
restored=restored.replaceAll("gasVersion: '9.287'","gasVersion: '9.285'");
restored=restored.replace(
  "var ISSUE507_GATE_API_VERSION='9.287'",
  "var ISSUE507_GATE_API_VERSION='9.285'");
const changelog=[
  '//  v9.287 펀드·스냅샷 단독 검증 후보 (2026.11.09):',
  '//  • 펀드 no-op 유지, Snapshot 백업 중복 전체 읽기 제거',
  '//  • 단계별 시간 측정(민감정보 제외), 백업·복구·잠금 유지',
  '//  • 거래원장 v2 마이그레이션 제외, 별도 검토·승인 전 배포 금지',
  '//',
].join('\n')+'\n';
assert.equal(restored.split(changelog).length,2,'New release changelog must be exact');
restored=restored.replace(changelog,'');
assert.equal(restored,parent,
  'Fund-only source must differ ONLY in version, changelog, backup and writer profiling');

console.log('GAS9287_FUND_SNAPSHOT_ISOLATION_PASS '+JSON.stringify({
  parent:manifest.parentVersion||'9.285',candidate:manifest.candidateVersion,
  tradeLedgerV2Included:false,
  permittedChangedFunctions:['_backupSheetBeforeWrite','writeSnapshotRows'],
  entrypointCount:funcs(candidate),
  sourceReversibleToPinned9285:true,
  exactBackupProfileParityWith9286:true,
  reviewedSourcePinned:true,manualProductionApprovalRequired:true,
  backendLiveVerified:false,financialWrites:0,gasDeployments:0
}));
