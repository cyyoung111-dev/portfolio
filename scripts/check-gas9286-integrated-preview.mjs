// Source-only integration proof; no Apps Script, Sheets or network writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
const {base,candidate,manifest}=composeGas9286IntegratedPreview();
assert.equal(blob(base),'b5b1c7fd5a27454419ddd6d12ecb20751c207c63');
assert.equal(blob(candidate),manifest.candidateSourceGitBlob);
assert.equal(manifest.proposedVersion,'9.286');
assert.equal(manifest.columns,14);
assert.equal(manifest.tradeLedgerProtocolVersion,2);
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(candidate.split("gasVersion: '9.286'").length-1,9);
assert.ok(candidate.includes("var ISSUE507_GATE_API_VERSION='9.286'"));
assert.ok(candidate.includes('function _tradeV2ValidateMutation_('));
assert.ok(candidate.includes('function handleSyncTrades('));
assert.ok(candidate.includes('if (values.length === 0)'));
assert.ok(candidate.includes('intendedRows.length, 14)'));
// No legacy writer can be accepted as a v2 writer; the live release must
// remain unchanged until migration and authenticated E2E evidence exist.
assert.ok(candidate.includes("params.action === 'syncTradesV2'"));
assert.ok(candidate.includes('handleTradeSyncV2WithReceipt_'));
assert.ok(candidate.includes('handleTradeV2ReceiptReadOnly_'));
assert.ok(candidate.includes('previewTradeLedgerV2Migration'));
assert.ok(candidate.includes('_tradeV2CheckpointVerified_'));
assert.ok(candidate.includes('tradeLedgerProtocolVersion'));
assert.equal(manifest.requiresProductionMigration,true);
assert.equal(manifest.requiresReleaseReview,true);
// Never treat a source-only candidate as a deployable release, even when
// the complete integration suite is green.
assert.equal(manifest.requiresProductionMigration,true);
assert.equal(manifest.productionDeploymentApproved,false);
assert.ok(!candidate.includes('GAS9286_RELEASE_APPROVED'));

for(const unsafe of ['previousFxGroups','oldOrdinaryCounts','TRADE_FX_GROUP_'])
 assert.ok(!candidate.includes(unsafe),'unsafe legacy group heuristic: '+unsafe);
// Compare the exact executable business functions with the independently
// regression-tested 14-column v2 source. A release version bump must not
// silently alter FX account transfers, ID/CAS, receipts or fund no-op.
const v2=composeGas9285TradeV2Preview().candidate;
// main already staged the fund-only 9.285 full source. Verify that the
// 9.286 candidate preserves the staged fund writer exactly, rather than
// merely matching a stale v2 branch fixture.
const stagedFundBlob='954fd4aeae767ddac0cb161d3a81003b5b699d1c';
let stagedFundSource;
try {stagedFundSource=execFileSync('git',['cat-file','blob',stagedFundBlob],
 {encoding:'utf8',maxBuffer:32*1024*1024});}
catch {throw Error('GAS9286_STAGED_9285_SOURCE_UNAVAILABLE');}
assert.equal(blob(stagedFundSource),stagedFundBlob);

const exactFunction=(src,name)=>{
 const start=src.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing function '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'unterminated function '+name);
 return src.slice(start,end+2);
};
for(const name of ['handleSyncTrades','handleGetTrades',
 '_tradeV2ValidateMutation_','_tradeV2CheckpointVerified_',
 '_refreshFundValuations','handleTradeSyncV2WithReceipt_',
 'handleTradeV2ReceiptReadOnly_'])
 assert.equal(exactFunction(candidate,name),exactFunction(v2,name),
  'integrated GAS function drift: '+name);
assert.equal(exactFunction(candidate,'_refreshFundValuations'),
 exactFunction(stagedFundSource,'_refreshFundValuations'),
 'GAS 9.286 fund function must match the staged main 9.285 source');
new vm.Script(candidate,{filename:'gas-9286-integrated-preview.gs'});
console.log('GAS9286_INTEGRATED_PREVIEW_PASS '+JSON.stringify(manifest));
