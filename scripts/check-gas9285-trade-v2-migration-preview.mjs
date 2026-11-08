// Execute the production candidate's read-only trade migration planner.
// Never invoke an Apps Script project or touch a real financial sheet.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const {candidate,manifest}=composeGas9285TradeV2Preview();
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.requiresLegacyMigration,true);
assert.match(candidate,/previewTradeLedgerV2Migration.*handlePreviewTradeLedgerV2Migration_/);
const extract=name=>{
 const i=candidate.indexOf('function '+name+'('),j=candidate.indexOf('\n}',i);
 assert(i>=0&&j>i,name+' absent from generated production source');
 return candidate.slice(i,j+2);
};
const names=['_cleanCode','_portfolioTradeFxMetadata_','_tradeV2CanonicalRow_',
 '_tradeV2Revision_','_tradeV2MigrationPlan_','handlePreviewTradeLedgerV2Migration_'];
const ctx=vm.createContext({JSON,Date,String,Number,Array,isFinite,
 _issue507GateInside_:true,
 _normalizeDate:x=>String(x||'').slice(0,10),
 _portfolioSyncDigest_:x=>createHash('sha256').update(x).digest('hex'),
 jsonOk:x=>({status:'ok',...x}),
 jsonError:(msg,x)=>({status:'error',message:msg,...x})
});
vm.runInContext('var TRADE_V2_ID_RE=/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/;\n'
 +names.map(extract).join('\n'),ctx);
const row=['2026-11-06','buy','US','US_TEST','005930',
  10,209925,'주식','', '', ''];
const doubled=[row.slice(),row.slice()];
assert.throws(()=>ctx._tradeV2MigrationPlan_([[...row,'','','','unexpected-finance-column']]),
 /TRADE_MIGRATION_ROW_WIDTH_INVALID/,
 '15-column source rows must not be silently truncated');
const initial=ctx._tradeV2MigrationPlan_(doubled);
assert.equal(initial.count,2);
assert.equal(initial.assigned,2);
assert.equal(initial.rows[0].length,14);
assert.notEqual(initial.rows[0][13],initial.rows[1][13],
 'identical legacy rows receive stable, distinct physical identities');
assert.ok(initial.rows.every(r=>r.slice(0,11).join('|')===row.join('|')),
 'existing 11 financial fields must remain exactly unchanged');
assert.deepEqual(
 Array.from(ctx._tradeV2MigrationPlan_(doubled).rows,r=>r[13]),
 Array.from(initial.rows,r=>r[13]),'read-only preview IDs must be stable');
const fx=[...row,155.5,1350];
const plannedFx=ctx._tradeV2MigrationPlan_([fx]);
assert.equal(plannedFx.fxEvidence,1);
assert.equal(plannedFx.rows[0][11],155.5);
assert.equal(plannedFx.rows[0][12],1350);
const existing=[...fx,'tr_fx00001'];
const ready=ctx._tradeV2MigrationPlan_([existing]);
assert.equal(ready.preserved,1);
assert.equal(ready.assigned,0);
assert.equal(ready.rows[0][13],'tr_fx00001');
assert.throws(()=>ctx._tradeV2MigrationPlan_([[...row,155.5,'']]),
 /TRADE_MIGRATION_FX_INCOMPLETE/);
assert.throws(()=>ctx._tradeV2MigrationPlan_([existing,existing]),
 /TRADE_MIGRATION_DUPLICATE_ID/);
let locked=false,writes=0,rows=doubled,invalidHeader=false;
ctx.getss=()=>({getSheetByName:()=>({
 getLastRow:()=>rows.length+1,getLastColumn:()=>rows[0].length,
 getRange:(r,c,n,w)=>({getValues:()=>r===1?[['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산','외화단가','매입환율','거래ID'].slice(0,w).map((v,i)=>invalidHeader&&i===3?'WRONG_HEADER':v)]:rows.map(r=>[...r]),
   setValues:()=>{writes++;throw Error('unexpected mutation')}})
})});
ctx.CONFIG={SHEET_TRADES:'거래이력'};
ctx.LockService={getScriptLock:()=>({
 tryLock:()=>{locked=true;return true;},
 releaseLock:()=>{locked=false;}
})};
const response=ctx.handlePreviewTradeLedgerV2Migration_();
assert.equal(response.status,'ok');
assert.equal(response.migrationStatus,'REQUIRES_APPROVED_MIGRATION');
assert.equal(response.sourceRows,2);
assert.equal(response.assignedIdsNeeded,2);
assert.equal(response.financeWrites,0);
assert.equal(response.migrationApplied,false);
assert.equal(writes,0);
assert.equal(locked,false);
invalidHeader=true;
const rejected=ctx.handlePreviewTradeLedgerV2Migration_();
assert.equal(rejected.status,'error');
assert.equal(rejected.errorCode,'TRADE_MIGRATION_HEADER_MISMATCH');
assert.equal(writes,0);
assert.equal(locked,false);
invalidHeader=false;
rows=[existing];
const upToDate=ctx.handlePreviewTradeLedgerV2Migration_();
assert.equal(upToDate.migrationStatus,'READY');
assert.equal(upToDate.existingIdsPreserved,1);
assert.equal(writes,0);
// Empty but correctly headed ledgers are valid: no migration and no writes.
rows=[];
const empty=ctx.handlePreviewTradeLedgerV2Migration_();
assert.equal(empty.status,'ok');
assert.equal(empty.sourceRows,0);
assert.equal(empty.assignedIdsNeeded,0);
assert.equal(empty.migrationStatus,'READY');
assert.equal(writes,0);
assert.equal(locked,false);
// A malformed width must fail closed, without leaking a lock or writing.
rows=[row.slice(0,10)];
const badWidth=ctx.handlePreviewTradeLedgerV2Migration_();
assert.equal(badWidth.status,'error');
assert.equal(badWidth.errorCode,'TRADE_MIGRATION_SHEET_WIDTH_INVALID');
assert.equal(writes,0);
assert.equal(locked,false);
console.log('GAS9285_TRADE_V2_MIGRATION_PREVIEW_PASS '+JSON.stringify({
 sourceRowsPreviewed:2,stableDuplicateIds:true,sourcePreserved:true,
 publicationApproval:false,productionGasDeployed:false,financeWrites:0
}));
