// Source-only integration proof; no Apps Script, Sheets or network writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
import {composeSnapshotBackupReadPreview} from './snapshot-backup-read-optimization-preview.mjs';
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
// Protect main's staged GAS 9.285 web compatibility while trade v2 is
// reviewed separately. The 9.286 preview is not an approved live endpoint.
const webFetch=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
assert.ok(webFetch.includes("const EXPECTED_GAS_VERSION = '9.285';"),
 'web must retain main staged GAS 9.285 compatibility');
assert.ok(webFetch.includes("const COMPATIBLE_GAS_VERSIONS = Object.freeze(['9.281', '9.282', '9.283', '9.284', EXPECTED_GAS_VERSION, '9.286']);"),
 'web must accept existing 9.284/9.285 and candidate 9.286 during controlled rollout');
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
 'handleTradeSyncV2WithReceipt_',
 'handleTradeV2ReceiptReadOnly_'])
 assert.equal(exactFunction(candidate,name),exactFunction(v2,name),
  'integrated GAS function drift: '+name);
// Confirm the separately tested backup RPC reduction is included in the
// nondeployable integrated 9.286 preview, not in approved v9.285.
const optimizedSnapshotPreview=composeSnapshotBackupReadPreview(stagedFundSource);
assert.equal(exactFunction(candidate,'_backupSheetBeforeWrite'),
 exactFunction(optimizedSnapshotPreview.source,'_backupSheetBeforeWrite'),
 'Integrated backup function must match tested source-only optimization');
assert.ok(manifest.integratedFeatures.includes('backup-read-optimization'));
assert.ok(!exactFunction(candidate,'_backupSheetBeforeWrite')
 .includes('var values = rowCount > 0 && colCount > 0 ? sheet.getRange('));
assert.ok(exactFunction(candidate,'_backupSheetBeforeWrite')
 .includes('else backupRange.setValues(sourceRange.getValues());'));
// Fund valuation behavior must match the staged main source byte-for-byte.
assert.equal(exactFunction(candidate,'_refreshFundValuations'),
 exactFunction(stagedFundSource,'_refreshFundValuations'),
 'GAS 9.286 fund function must match staged main 9.285');
new vm.Script(candidate,{filename:'gas-9286-integrated-preview.gs'});
console.log('GAS9286_INTEGRATED_PREVIEW_PASS '+JSON.stringify(manifest));


// Exercise the actual migration planner in an isolated VM: no GAS/Sheets writes.
const migrationSandbox={
  _normalizeDate:value=>String(value||''),
  _portfolioTradeFxMetadata_:()=>[],
  _portfolioSyncDigest_:value=>createHash('sha256').update(value).digest('hex'),
  _tradeV2CanonicalRow_:row=>row.slice(0,13),
  _tradeV2Revision_:rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  TRADE_V2_ID_RE:/^(?:srv_|tr_)[a-zA-Z0-9_-]{8,64}$/,
};
const migrationSource=candidate.slice(
 candidate.indexOf('function _tradeV2MigrationPlan_('),
 candidate.indexOf('function handlePreviewTradeLedgerV2Migration_('));
assert.ok(migrationSource.startsWith('function _tradeV2MigrationPlan_('));
vm.runInNewContext(migrationSource,migrationSandbox);
const plan=migrationSandbox._tradeV2MigrationPlan_;
const row=(id='',price='',rate='')=>[
 '2026-11-06','매수','ISA','TEST','000001',1,100,'주식','', '', '',price,rate,id];
const legacy=[row(),row()];
const first=plan(legacy),second=plan(legacy);
assert.equal(first.count,2);
assert.equal(first.assigned,2);
assert.equal(first.preserved,0);
assert.notEqual(first.rows[0][13],first.rows[1][13],
 'physically duplicated legacy rows require distinct permanent IDs');
assert.equal(first.proposedRevision,second.proposedRevision,
 'same input must yield stable migration revision');
assert.equal(plan(first.rows).assigned,0,
 're-running a migrated ledger must not assign new IDs');
assert.equal(plan(first.rows).preserved,2);
assert.throws(()=>plan([row('tr_12345678'),row('tr_12345678')]),
 /TRADE_MIGRATION_DUPLICATE_ID/);
assert.throws(()=>plan([row('',1200,'')]),/TRADE_MIGRATION_FX_INCOMPLETE/);
assert.throws(()=>plan([['2026-11-06']]),/TRADE_MIGRATION_ROW_WIDTH_INVALID/);
assert.throws(()=>plan([row('bad id')]),/TRADE_MIGRATION_ID_INVALID/);
assert.throws(()=>plan([row().slice(0,12)]),/TRADE_MIGRATION_ROW_WIDTH_INVALID/);
assert.ok(candidate.includes("if([11,13,14].indexOf(width)===-1)throw Error('TRADE_MIGRATION_SHEET_WIDTH_INVALID')"));
console.log('GAS9286_MIGRATION_INVARIANTS_PASS');

assert.ok(candidate.includes("throw Error('TRADE_MIGRATION_HEADER_MISMATCH')"),
 'migration must fail closed when a same-width sheet has different columns');
assert.ok(candidate.includes("var actualHeaders=sh.getRange(1,1,1,width).getValues()[0]"),
 'migration must read the actual header before planning');
