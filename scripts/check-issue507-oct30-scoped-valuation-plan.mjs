import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {planIssue507Oct30ScopedRevaluation,TARGET_DATE}
  from './issue507-oct30-scoped-valuation-plan.mjs';

// Real production formulas and frozen GAS source, not made-up valuation math.
const b=fs.readFileSync('src/gas/apps_script.gs');
const sha=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
assert.equal(sha,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
const gas=b.toString('utf8'),i=gas.indexOf('function _buildSnapshotRowsFromTradeAndPriceHistory(');
const fn=gas.slice(i,gas.indexOf('\n}',i)+2);
assert.ok(i>=0);
assert.match(fn,/Math\.round\(price \* fxRate\)/);
assert.match(fn,/Math\.round\(priceKrw \* h\.qty\)/);
assert.match(fn,/parseFloat\(\(\(pnl \/ h\.costAmt\) \* 100\)\.toFixed\(2\)\)/);
assert.match(fn,/parseFloat\(\(evalAmt \/ h\.qty\)\.toFixed\(2\)\)/);
const names=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const held=names.map((code,i)=>{
 const qty=i%3===0?1.25:2,costAmt=qty*180;
 return {code,qty,costAmt};
});
const oldSource='KRX_CARRY@2026-10-29';
const rows=held.map((h,i)=>{
 const amount=Math.round(100*h.qty);
 const pnl=amount-h.costAmt,pct=Number((pnl/h.costAmt*100).toFixed(2));
 return [TARGET_DATE,h.code,'PRIVATE_STOCK',h.qty,Number((h.costAmt/h.qty).toFixed(2)),
  h.costAmt,Number((amount/h.qty).toFixed(2)),amount,pnl,pct,oldSource,''];
});
rows.push(...['F00001','F00002'].map((code,i)=>{
 const amt=1200+200*i, cost=1000,pnl=amt-cost;
 return [TARGET_DATE,code,'PRIVATE_FUND',1,1000,cost,amt,amt,pnl,pnl/10,'FUND_NAV',''];
}));
const history=['F00001','F00002'].map((code,i)=>[
 TARGET_DATE,code,'PRIVATE_FUND',1200+200*i,'','FUND_NAV'
]);
const quotes=Object.fromEntries(names.map((code,i)=>[code,{
 price:120.6+i,usedDate:TARGET_DATE,source:i%2?'KRX_OTP':'KRX'
}]));
const sourceEvidence={
 mode:'ISSUE507_OCT30_PRIVATE_KRX_QUOTE_PROOF',
 date:TARGET_DATE,status:'PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED',
 verifiedPrivateQuoteCount:37,individualQuoteValuesDisclosed:false,safeToWrite:false
};
const args={date:TARGET_DATE,snapshotRows:rows,historyRows:history,
 officialCloses:quotes,ledgerHoldings:held,sourceEvidence};
const beforeArgs=structuredClone(args);
const cloned=()=>structuredClone(args);
const p=planIssue507Oct30ScopedRevaluation(cloned());
assert.equal(p.summary.safeToApply,false);
assert.equal(p.summary.financialWrites,0);
assert.equal(p.summary.domesticRowRevaluations,37);
assert.equal(p.summary.priceHistoryInserts,37);
assert.equal(p.summary.unchangedFundRows,2);
assert.equal(p.privatePlan.domestic.length,37);
assert.equal(p.privatePlan.priceHistoryInserts.length,37);
const check=p.privatePlan.domestic[0];
const qty=held[0].qty,cost=held[0].costAmt,afterAmt=Math.round(Math.round(quotes['000001'].price)*qty);
assert.equal(check.after[6],Number((afterAmt/qty).toFixed(2)));
assert.equal(check.after[7],afterAmt);
assert.equal(check.after[8],afterAmt-cost);
assert.equal(check.after[9],Number(((afterAmt-cost)/cost*100).toFixed(2)));
assert.deepEqual(check.before.slice(0,6),check.after.slice(0,6));
assert.equal(check.after[10],'KRX');
assert.deepEqual(p.privatePlan.fundRows.get('F00001').row,rows[37]);
assert.deepEqual(p.privatePlan.fundRows.get('F00002').row,rows[38]);
assert.equal(p.privatePlan.priceHistoryInserts[0][0],TARGET_DATE);
assert.equal(p.privatePlan.priceHistoryInserts[0][3],quotes['000001'].price);
assert.ok(!JSON.stringify(p.summary).includes('PRIVATE_STOCK')
  &&!JSON.stringify(p.summary).includes('PRIVATE_FUND')
  &&!JSON.stringify(p.summary).includes('000001')
  &&!JSON.stringify(p.summary).includes('120.6'));
let failures=0;
function wrong(change,reason){
 const data=cloned();change(data);
 assert.throws(()=>planIssue507Oct30ScopedRevaluation(data),
   new RegExp('ISSUE507_SCOPE_PLAN_'+reason));
 failures++;
}
wrong(x=>x.date='2026-10-29','ATTESTATION');
wrong(x=>x.sourceEvidence.safeToWrite=true,'ATTESTATION');
wrong(x=>x.snapshotRows.pop(),'PHYSICAL_SCOPE');
wrong(x=>x.historyRows.pop(),'PHYSICAL_SCOPE');
wrong(x=>x.ledgerHoldings.pop(),'PHYSICAL_SCOPE');
wrong(x=>delete x.officialCloses['000001'],'OFFICIAL_SCOPE');
wrong(x=>x.ledgerHoldings[0].code=x.ledgerHoldings[1].code,'LEDGER_SCOPE');
wrong(x=>x.ledgerHoldings[0].qty=0,'LEDGER_SCOPE');
wrong(x=>x.officialCloses['000001'].usedDate='2026-10-29','OFFICIAL_NOT_EXACT');
wrong(x=>x.officialCloses['000001'].source='KRX_CARRY','OFFICIAL_NOT_EXACT');
wrong(x=>x.officialCloses['000001'].source='YAHOO','OFFICIAL_NOT_EXACT');
wrong(x=>x.officialCloses['000001'].price=0,'OFFICIAL_NOT_EXACT');
wrong(x=>x.officialCloses['000001'].price=Infinity,'OFFICIAL_NOT_EXACT');
wrong(x=>x.officialCloses['000002'].price='9'.repeat(308),'REVALUATION_OVERFLOW');
wrong(x=>x.snapshotRows[0][1]=x.snapshotRows[1][1],'SNAPSHOT_SCOPE');
wrong(x=>x.snapshotRows[0][10]='KRX','DOMESTIC_SCOPE');
wrong(x=>x.snapshotRows[0][3]=0,'DOMESTIC_SCOPE');
wrong(x=>x.snapshotRows[0][5]++,'SNAPSHOT_ACCOUNTING');
wrong(x=>x.snapshotRows[0][9]=0,'SNAPSHOT_ACCOUNTING');
wrong(x=>x.snapshotRows[37][10]='FUND_NAV_CARRY','FUND_PROTECTION');
wrong(x=>x.historyRows[0][3]=0,'HISTORY_MUST_BE_FUNDS_ONLY');
wrong(x=>x.historyRows[0][0]='2026-10-29','HISTORY_MUST_BE_FUNDS_ONLY');
wrong(x=>x.historyRows[0][1]='F00002','HISTORY_MUST_BE_FUNDS_ONLY');
wrong(x=>x.snapshotRows[0][3]=x.snapshotRows[0][3]+0.001,'DOMESTIC_SCOPE');
wrong(x=>x.ledgerHoldings[0].costAmt+=0.5,'DOMESTIC_SCOPE');
wrong(x=>x.officialCloses['999999']=x.officialCloses['000001'],'OFFICIAL_SCOPE');
assert.deepEqual(args,beforeArgs,'original input must never mutate');
assert.equal(p.summary.physicalBackupVerified,false);
assert.equal(p.summary.writerLockVerified,false);
console.log(JSON.stringify({mode:'ISSUE507_SCOPED_VALUATION_DRYRUN_TEST',
 result:'PASS',negativeCases:failures,
 domesticRevaluations:p.summary.domesticRowRevaluations,
 unchangedFundRows:p.summary.unchangedFundRows,
 productionSourceBlob:sha.slice(0,12),
 actualFinancialWrites:0,actualGASDeploy:false,nhTokenRequests:0}));
