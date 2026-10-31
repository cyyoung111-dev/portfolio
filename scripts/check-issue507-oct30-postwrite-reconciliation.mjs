import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyIssue507Oct30PostState,DAY}
 from './issue507-oct30-postwrite-reconciliation.mjs';

// Existing GAS stays exactly pinned. No production write functions are called.
const bytes=fs.readFileSync('src/gas/apps_script.gs');
const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(hash,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
const gas=bytes.toString('utf8');
for(const fn of ['_verifyCompletedKrxPendingDate_','batchUpsertPriceHistory',
 'writeSnapshotRows','_writeSnapshotDateScoped_','_backupSheetBeforeWrite']){
 assert.ok(gas.includes('function '+fn+'('),'must refer to actual protected production functions');
}
const stocks=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const fundCodes=['F00001','F00002'];
const beforeSnapshot=stocks.map((c,i)=>{
 const qty=i%2?2:1.25,cost=qty*200;
 const amount=Math.round(qty*100),pnl=amount-cost;
 return [DAY,c,'PRIVATE_STOCK',qty,200,cost,
  Number((amount/qty).toFixed(2)),amount,pnl,
  Number((pnl/cost*100).toFixed(2)),'KRX_CARRY@2026-10-29',''];
});
beforeSnapshot.push(...fundCodes.map((c,i)=>{
 const price=1400+i*200,cost=1000;
 return [DAY,c,'PRIVATE_FUND',1,1000,cost,price,price,price-cost,
  Number(((price-cost)/cost*100).toFixed(2)),'FUND_NAV',''];
}));
const beforeHistory=fundCodes.map((c,i)=>
 [DAY,c,'PRIVATE_FUND',1400+i*200,'','FUND_NAV']);
const domestic=stocks.map((c,i)=>{
 const before=beforeSnapshot[i].slice(),px=120.6+i,qty=before[3],cost=before[5];
 const amount=Math.round(Math.round(px)*qty),pnl=amount-cost;
 const after=before.slice();
 after[6]=Number((amount/qty).toFixed(2));
 after[7]=amount;after[8]=pnl;
 after[9]=Number((pnl/cost*100).toFixed(2));
 after[10]=i%2?'KRX_OTP':'KRX';
 return {rowIndex:i,code:c,before,after};
});
const insert=stocks.map((c,i)=>
 [DAY,c,'PRIVATE_STOCK',120.6+i,'',i%2?'KRX_OTP':'KRX']);
const plan={summary:{
 mode:'ISSUE507_OCT30_SCOPED_VALUATION_PLAN',
 status:'PRIVATE_DRY_RUN_ONLY',safeToApply:false,
 domesticRowRevaluations:37,priceHistoryInserts:37,
 unchangedFundRows:2,sourceScope:'KRX_OR_KRX_OTP_EXACT_DATE'
 },privatePlan:{domestic,priceHistoryInserts:insert}};
const afterSnapshot=domestic.map(x=>x.after.slice()).concat(beforeSnapshot.slice(37).map(x=>x.slice()));
const afterHistory=beforeHistory.map(x=>x.slice()).concat(insert.map(x=>x.slice()));
const args={date:DAY,beforeSnapshot,afterSnapshot,beforeHistory,afterHistory,plan};
const immutable=structuredClone(args), clone=()=>structuredClone(args);
const result=verifyIssue507Oct30PostState(clone());
assert.equal(result.status,'SYNTHETIC_OR_PROTECTED_READBACK_MATCH');
assert.equal(result.verifiedDomesticSnapshotRows,37);
assert.equal(result.verifiedExactPriceHistoryRows,37);
assert.equal(result.unchangedFundSnapshots,2);
assert.equal(result.unchangedFundPriceHistory,2);
assert.equal(result.safeToFinalize,false);
assert.equal(result.otherDatesVerified,false);
assert.equal(result.physicalBackupSignatureVerified,false);
assert.equal(result.gateAndLockVerified,false);
assert.equal(result.financialWrites,0);
assert.deepEqual(args,immutable,'read-only checker must not mutate input');
for(const privatePart of ['PRIVATE_STOCK','PRIVATE_FUND','000001','120.6','F00001','KRX_CARRY'])
 assert.ok(!JSON.stringify(result).includes(privatePart),'no code or quote in safe summary');
// Physical order changes without row/value changes are harmless.
const reordered=clone();
reordered.afterSnapshot.reverse();reordered.afterHistory.reverse();
assert.equal(verifyIssue507Oct30PostState(reordered).verifiedDomesticSnapshotRows,37);
let cases=0;
function rejected(change,reason){
 const a=clone();change(a);
 assert.throws(()=>verifyIssue507Oct30PostState(a),new RegExp('ISSUE507_OCT30_POSTSTATE_'+reason));
 cases++;
}
rejected(x=>x.date='2026-10-29','PLAN_ATTESTATION');
rejected(x=>x.plan.summary.safeToApply=true,'PLAN_ATTESTATION');
rejected(x=>x.plan.summary.priceHistoryInserts=36,'PLAN_ATTESTATION');
rejected(x=>x.afterSnapshot.pop(),'ROW_SCOPE');
rejected(x=>x.afterHistory.pop(),'ROW_SCOPE');
rejected(x=>x.beforeHistory.pop(),'ROW_SCOPE');
rejected(x=>x.afterSnapshot[0][0]='2026-10-29','AFTER_SNAPSHOT_SHAPE');
rejected(x=>x.beforeSnapshot[0][0]='2026-10-29','BEFORE_SNAPSHOT_SHAPE');
rejected(x=>x.afterHistory[2][0]='2026-10-29','AFTER_HISTORY_SHAPE');
rejected(x=>x.afterSnapshot[0][1]=x.afterSnapshot[1][1],'AFTER_SNAPSHOT_DUPLICATE');
rejected(x=>x.afterHistory[2][1]=x.afterHistory[3][1],'AFTER_HISTORY_DUPLICATE');
rejected(x=>x.afterSnapshot[37][7]++,'FUND_PROTECTION');
rejected(x=>x.afterHistory[0][3]++,'FUND_PROTECTION');
rejected(x=>x.beforeSnapshot[37][10]='FUND_NAV_CARRY','FUND_PROTECTION');
rejected(x=>x.beforeHistory[0][5]='MANUAL','FUND_PROTECTION');
rejected(x=>x.afterSnapshot[0][7]++,'PATCH_READBACK_MISMATCH');
rejected(x=>x.afterSnapshot[0]=x.beforeSnapshot[0].slice(),'PATCH_READBACK_MISMATCH');
rejected(x=>x.plan.privatePlan.domestic[0].before[7]++,'PATCH_READBACK_MISMATCH');
rejected(x=>{x.plan.privatePlan.domestic[1].code=x.plan.privatePlan.domestic[0].code; x.plan.privatePlan.domestic[1].rowIndex=0},'PATCH_PLAN_SCOPE');
rejected(x=>x.plan.privatePlan.priceHistoryInserts[0][5]='YAHOO','HISTORY_PLAN_SCOPE');
rejected(x=>x.plan.privatePlan.priceHistoryInserts[0][0]='2026-10-29','HISTORY_PLAN_SCOPE');
rejected(x=>x.plan.privatePlan.priceHistoryInserts[0][3]=0.49,'NONFINITE_SOURCE_OR_POSITION');
rejected(x=>x.plan.privatePlan.priceHistoryInserts[0][3]=Infinity,'HISTORY_PLAN_SCOPE');
// A malicious plan might adjust BOTH the expected row and observed row.
// Preserve A:F/L rather than trusting the expected writer's new row.
rejected(x=>{x.plan.privatePlan.domestic[0].after[5]++;
 x.afterSnapshot[0][5]++},'COST_QTY_OR_METADATA_CHANGED');
rejected(x=>{x.plan.privatePlan.domestic[0].after[3]++;
 x.afterSnapshot[0][3]++},'COST_QTY_OR_METADATA_CHANGED');
rejected(x=>{x.plan.privatePlan.domestic[0].after[10]='YAHOO';
 x.afterSnapshot[0][10]='YAHOO'},'SOURCE_DRIFT');
rejected(x=>{x.plan.privatePlan.domestic[0].after[7]++;
 x.afterSnapshot[0][7]++},'VALUATION_NOT_PRODUCTION_EQUIVALENT');
rejected(x=>x.afterHistory[2][3]++,'EXACT_PRICE_HISTORY_MISMATCH');
rejected(x=>x.plan.privatePlan.domestic[0].rowIndex=-1,'PATCH_PLAN_SCOPE');
rejected(x=>x.plan.privatePlan.domestic[0].rowIndex=1,'PATCH_INDEX_DRIFT');
rejected(x=>{x.plan.privatePlan.domestic[0].before[4]=null; x.beforeSnapshot[0][4]=null; x.plan.privatePlan.domestic[0].after[4]=null; x.afterSnapshot[0][4]=null},'NONFINITE_SOURCE_OR_POSITION');
rejected(x=>x.plan.privatePlan.priceHistoryInserts[0][1]='999999','PATCH_READBACK_MISMATCH');
// This verifier is a fail-closed audit only; it never sets a recovery marker.
assert.equal(result.safeToFinalize,false);
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_POSTSTATE_READONLY_CONTRACT',
 result:'PASS',negativeCases:cases,
 targetSnapshotRows:39,targetHistoryRowsAfter:39,
 verifiedDomestic:37,unchangedFunds:2,
 financialWrites:0,gasDeployed:false,nhTokens:0,
 pinnedProductionBlob:hash.slice(0,12)
}));
