#!/usr/bin/env node
// Offline full-source boundary: no Apps Script, Sheet or Telegram calls.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {composeIssue860CloseStageTimingPreview} from './compose-issue860-close-stage-timing-preview.mjs';
import {gasSourceBlobSha,assertGasReleaseReady} from './deploy-gas.mjs';

function functions(source){
 const found=new Map();
 for(const match of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)){
  const end=source.indexOf('\n}',match.index);
  assert(end>match.index,'unclosed '+match[1]);
  assert(!found.has(match[1]),'duplicate '+match[1]);
  found.set(match[1],source.slice(match.index,end+2));
 }
 return found;
}
const original9287=composeFundSnapshot9287SourcePreview().candidate;
const original9288=composeGas9288TradeV2From9287Preview().candidate;
assert.equal(gasSourceBlobSha(original9287),'e2f5239746598754305eb603bc33651f5c36d914');
assert.equal(gasSourceBlobSha(original9288),'9e8584032daf896c5cffedb02041b604ee82ed07');
assert.equal(assertGasReleaseReady(original9287),'9.287');
assert.equal(assertGasReleaseReady(original9288),'9.288');

for(const original of [original9287,original9288]){
 const version=original===original9287?'9.287':'9.288';
 const preview=composeIssue860CloseStageTimingPreview(original);
 assert.equal(preview.label,'SOURCE_ONLY_NOT_REVIEWED_FOR_DEPLOY');
 assert.equal(preview.financeWrites,0);
 assert.equal(preview.gasDeployments,0);
 assert.equal(preview.telegramSends,0);
 assert.notEqual(gasSourceBlobSha(preview.source),gasSourceBlobSha(original));
 assert.throws(()=>assertGasReleaseReady(preview.source),/GAS_RELEASE_SOURCE_NOT_APPROVED/,
  'new GAS contents must NOT be deployable without a separate exact-reviewed release');
 assert.throws(()=>composeIssue860CloseStageTimingPreview(preview.source),
  /ISSUE860_DOUBLE_INSTRUMENT_CLOSE/,
  'double-instrumentation must be rejected');
 new vm.Script(preview.source,{filename:'issue860-undeployed-stage-'+version+'.gs'});
 const before=functions(original),after=functions(preview.source);
 assert.deepEqual([...after.keys()],[...before.keys()],'No new public GAS entrypoints');
 const changed=[...before.keys()].filter(name=>after.get(name)!==before.get(name));
 assert.deepEqual(changed.sort(),['runDailyFundValuations','saveDailyPriceHistory'].sort(),
  'Only timing statements inside two existing functions may differ');
 for(const protectedName of [
  '_backupSheetBeforeWrite','writeSnapshotRows','_refreshFundValuations',
  '_writeSnapshotDateScoped_','_issue507GateInvoke_','_issue507GateEnter_',
  'runDailyPortfolioClose1900','runDeferredFundAfterPortfolioCloseFailure',
  '_tradeV2MigrationManual_'
 ]){
  if(before.has(protectedName))
   assert.equal(after.get(protectedName),before.get(protectedName),
    'No finance writer/rollback/approval/lease behavior changed: '+protectedName);
 }
 for(const [name,prefix,stages] of [
  ['saveDailyPriceHistory','[ISSUE860_CLOSE_STAGE]',preview.closeStages],
  ['runDailyFundValuations','[ISSUE860_FUND_STAGE]',preview.fundStages]
 ]){
  const functionSource=after.get(name);
  assert(functionSource.includes(prefix));
  assert.equal((functionSource.match(/var issue860(?:Close|Fund)Mark = function\(stage\)/g)||[]).length,1);
  for(const stage of stages)assert(functionSource.includes("Mark('"+stage+"')"),stage);
  assert(functionSource.includes('Logger.log('));
  assert(!functionSource.includes('accessToken'));
  assert(!functionSource.includes('Logger.log(JSON.stringify('));
 }
 const close=after.get('saveDailyPriceHistory');
 const at=tag=>close.indexOf(tag);
 assert(at("Mark('BUILD_START')")<at('var expected = _buildSnapshotRowsFromTradeAndPriceHistory'));
 assert(at('var expected = _buildSnapshotRowsFromTradeAndPriceHistory')<at("Mark('BUILD_DONE')"));
 assert(at("Mark('PLAN_START')")<at('var dailyRewritePlan = _snapshotRewritePlan'));
 assert(at('var dailyRewritePlan = _snapshotRewritePlan')<at("Mark('PLAN_DONE')"));
 assert(at("Mark('WRITE_START')")<at('writeSnapshotRows(ss, snapshotDate, expected, true)'));
 assert(at('writeSnapshotRows(ss, snapshotDate, expected, true)')<at("Mark('WRITE_DONE')"));
 assert(at("Mark('INTEGRITY_START')")<at('var savedIntegrity = diagnoseSnapshotIntegrity'));
 assert(at('var savedIntegrity = diagnoseSnapshotIntegrity')<at("Mark('INTEGRITY_DONE')"));
 // Invocation count of writes/readbacks must remain unchanged.
 for(const fn of ['writeSnapshotRows(ss, snapshotDate, expected, true)',
   '_snapshotRewritePlan(ss, snapshotDate, expected)',
   'diagnoseSnapshotIntegrity(ss, snapshotDate)',
   '_refreshFundValuations(getss(), _fundDateOffset(runDate, -31)']){
  const a=(original.split(fn).length-1),b=(preview.source.split(fn).length-1);
  assert.equal(b,a,'Instrumentation cannot add or remove actual read/write calls');
 }
 console.log(JSON.stringify({kind:'ISSUE860_STAGE_SOURCE_ONLY_CHECK_PASS',parentVersion:version,
  changedFunctions:changed,closeStages:preview.closeStages.length,
  fundStages:preview.fundStages.length,
  functionsUnchanged:before.size-changed.length,
  sourceModifiedNotDeployable:true,financialWrites:0,productionDeploys:0}));
}
