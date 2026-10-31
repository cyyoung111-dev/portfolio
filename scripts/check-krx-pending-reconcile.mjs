import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run actual GAS production functions in an isolated, mutation-recording VM.
const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function extract(name) {
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name+' exists');
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,name+' closing brace');
  return source.slice(start,end+2);
}
assert.match(source,/params\.action === 'reconcileCompletedKrxPending'\) return jsonError\('POST_ONLY'\)/,
  'GET must never mutate pending dates');
assert.match(source,/params\.action === 'reconcileCompletedKrxPending'\) return handleReconcileCompletedKrxPending/,
  'POST explicit reconciliation route required');

const initialDates=['2026-10-07','2026-10-08','2026-10-12','2026-10-13'];
const mk=(d,c,price)=>[d,c,c,String(price),'','KRX'];
const sn=(d,c,price)=>[d,c,c,'2','900','1800',String(price),String(price*2),'0','0','KRX'];
let history=[
  mk('2026-10-07','005930',100),mk('2026-10-07','000660',200),
  mk('2026-10-08','005930',101),mk('2026-10-08','000660',201),
  ['2026-10-07','AAPL','Apple','190','','YAHOO'],
  ['2026-10-08','AAPL','Apple','195','','YAHOO'],
];
let snapshots=[
  sn('2026-10-07','005930',100),sn('2026-10-07','000660',200),
  sn('2026-10-08','005930',101),sn('2026-10-08','000660',201),
  ['2026-10-07','AAPL','Apple','1','150','150','190','190','40','26','YAHOO'],
  ['2026-10-08','AAPL','Apple','1','150','150','195','195','45','30','YAHOO'],
];
const sheet=rows=>({
  getLastRow:()=>rows.length+1,
  getRange:(_r,_c,_h,width)=>({getDisplayValues:()=>rows.map(x=>x.slice(0,width))}),
});
const catalog=[
 {code:'005930',market:'KOSPI',currency:'KRW',type:'주식'},
 {code:'000660',market:'KOSPI',currency:'KRW',type:'주식'},
 {code:'AAPL',market:'US',currency:'USD',type:'주식'},
];
const values=new Map([['portfolio_close_pending_krx_dates',JSON.stringify(initialDates)]]);
let writes=[];
const props={
  getProperty:k=>values.has(k)?values.get(k):null,
  setProperty:(k,v)=>{writes.push({key:k,value:v});values.set(k,v);},
  deleteProperty:k=>{writes.push({key:k,delete:true});values.delete(k);},
};
const trades=[
 ['2026-10-07','buy','','삼성전자','005930',2,100,'주식'],
 ['2026-10-07','buy','','하이닉스','000660',2,200,'주식'],
 ['2026-10-07','buy','','애플','AAPL',1,190,'주식'],
];
const ledgerSheet={
 getLastRow:()=>trades.length+1,getLastColumn:()=>11,
 getRange:()=>({getValues:()=>trades}),
};
const ss={getSheetByName:n=>n==='가격이력'?sheet(history)
 :n==='스냅샷'?sheet(snapshots):n==='거래이력'?ledgerSheet:null};
let ledgerQtyOverride=2;
const context=vm.createContext({
  CONFIG:{SHEET_PH:'가격이력',SHEET_SNAPSHOT:'스냅샷',SHEET_TRADES:'거래이력'},
  PORTFOLIO_CLOSE_BACKFILL_PRUNE_CURSOR_KEY:'portfolio_close_backfill_prune_cursor_v1',
  _calcCodeHoldingsAtDate:()=>({'005930':{code:'005930',qty:ledgerQtyOverride},'000660':{code:'000660',qty:2},'AAPL':{code:'AAPL',qty:1}}),
  _isFundCode:code=>/^F\d{5}$/.test(code),
  getss:()=>ss, getCodeItems:()=>catalog,
  _getDailyHeldCodeItems:()=>catalog,
  _isKrxDailyCloseTarget_:item=>item.currency==='KRW' && item.market==='KOSPI',
  _krxCalendarStatus_:date=>date==='2026-10-09'?'CLOSED':'OPEN',
  diagnoseSnapshotIntegrity:(_ss,date)=>{
    // Independent full-portfolio oracle: the two KRX rows can remain valid
    // while a foreign row is absent, stale or sourced incorrectly.
    const rows=snapshots.filter(row=>row[0]===date);
    const foreign=rows.find(row=>row[1]==='AAPL');
    const foreignValid=!!foreign && Number(foreign[3])===1 && foreign[10]==='YAHOO';
    return {status:foreignValid?'VALID':'MISMATCH',
      expectedRowCount:3,storedRowCount:rows.length};
  },
  _normalizeDate:s=>String(s||'').slice(0,10),
  _cleanCode:s=>String(s||'').trim(),
  _portfolioFundAtomic_:fn=>fn(props),
  _portfolioFundState_:(p,k)=>{try{return JSON.parse(p.getProperty(k)||'null')}catch{return null}},
  PORTFOLIO_FUND_LEASE_KEY:'fund_lease',
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'backfill_lease',
  PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
  today:()=> '2026-10-14',
  jsonOk:result=>({status:'ok',result}),
  jsonError:message=>({status:'error',message}),
});
for(const name of ['_verifyCompletedKrxPendingDate_','_readPendingKrxCloseDates_',
    'handleReconcileCompletedKrxPending'])
  vm.runInContext(extract(name),context);
function queue(){return JSON.parse(props.getProperty('portfolio_close_pending_krx_dates'))}
function reset(){values.set('portfolio_close_pending_krx_dates',JSON.stringify(initialDates));writes=[];}
const invoke=(dates,flag)=>JSON.parse(JSON.stringify(
 context.handleReconcileCompletedKrxPending(dates,flag)));
const preview=invoke('2026-10-07,2026-10-08','');
assert.equal(preview.status,'ok');
assert.equal(preview.result.mode,'DRY_RUN');
assert.equal(preview.result.checked.every(x=>x.ok && x.verifiedCodes===2),true);
assert.deepEqual(queue(),initialDates);
assert.equal(writes.length,0,'dry run never writes');

const apply=invoke('2026-10-07,2026-10-08','1');
assert.equal(apply.status,'ok');
assert.equal(apply.result.cleared,2);
assert.deepEqual(queue(),['2026-10-12','2026-10-13']);
assert.equal(writes.length,1,'only one atomic queue property write');
assert.equal(writes[0].key,'portfolio_close_pending_krx_dates');
const again=invoke('2026-10-07','1');
assert.equal(again.result.cleared,0,'retry idempotent');
assert.equal(writes.length,1);
assert.equal(history.length,6);
assert.equal(snapshots.length,6);

reset();
history.push(mk('2026-10-08','005930',101));
assert.equal(invoke('2026-10-07,2026-10-08','1').result.mode,'BLOCKED',
  'any duplicate history blocks the whole batch');
assert.deepEqual(queue(),initialDates);
history.pop();
snapshots[3][6]='202';
assert.equal(invoke('2026-10-07,2026-10-08','1').result.mode,'BLOCKED',
  'a wrong snapshot price blocks all queue mutation');
assert.deepEqual(queue(),initialDates);
snapshots[3][6]='201';
snapshots[3][10]='YAHOO';
assert.equal(invoke('2026-10-08','1').result.checked[0].reason,'SNAPSHOT_INVALID',
  'non-KRX valuation source blocks queue cleanup');
snapshots[3][10]='KRX';
history[3][5]='KRX_CARRY';
assert.equal(invoke('2026-10-08','1').result.checked[0].reason,'PRICE_HISTORY_INVALID',
  'carry prices cannot be promoted to official closes');
history[3][5]='KRX';
catalog.pop();
assert.equal(invoke('2026-10-08','1').result.checked[0].reason,'MASTER_INCOMPLETE',
  'a partial catalog must not silently exclude a held ledger code');
catalog.push({code:'AAPL',market:'US',currency:'USD',type:'주식'});
snapshots[2][3]='1.5'; snapshots[2][6]='101.33'; snapshots[2][7]='152';
assert.equal(invoke('2026-10-08','').result.checked[0].reason,'SNAPSHOT_INVALID',
  'self-consistent stale snapshot must be rejected if the ledger qty changed');
ledgerQtyOverride=1.5;
assert.equal(invoke('2026-10-08','').result.checked[0].ok,true,
  'exact ledger fractional quantity uses rounded total then derived unit');
ledgerQtyOverride=2;
snapshots[2]=sn('2026-10-08','005930',101);

// Domestic KRX rows and official close are unchanged, but a stale US
// Snapshot must prevent clearing the queued date in this manual path.
reset();
snapshots[5][3]='3';
const mixedInvalid=invoke('2026-10-08','1');
assert.equal(mixedInvalid.result.mode,'BLOCKED');
assert.equal(mixedInvalid.result.checked[0].reason,'FULL_SNAPSHOT_MISMATCH');
assert.deepEqual(queue(),initialDates);
assert.equal(writes.length,0,'foreign Snapshot conflict must remain read-only');
snapshots[5][3]='1';

values.set('backfill_lease',JSON.stringify({until:Date.now()+60000}));
assert.equal(invoke('2026-10-07','1').message,'KRX_PENDING_WRITER_ACTIVE');
assert.deepEqual(queue(),initialDates);
values.delete('backfill_lease');
assert.equal(invoke('2026-10-14','1').message,'KRX_PENDING_INVALID_DATES');
assert.equal(invoke('2026-10-12','1').result.mode,'BLOCKED',
  'no exact-date source/Snapshot must keep truly missing date queued');
assert.deepEqual(queue(),initialDates);
assert.equal(writes.length,0,'all failure modes are read only');

// The nightly pre-prune path must consume the SAME actual complete-proof
// implementation as the authenticated manual path. An invalid US Snapshot
// may not vanish when the domestic KRX price/quantity is fully verified.
vm.runInContext(extract('_pruneVerifiedHistoricalKrxPending_'),context);
values.set('portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08']));
values.set('backfill_lease',JSON.stringify({token:'proof-lease',until:Date.now()+60000}));
snapshots[5][3]='4';
const rejectedPrune=context._pruneVerifiedHistoricalKrxPending_('proof-lease','2026-10-14');
assert.equal(rejectedPrune.cleared,0,'nightly pre-prune must also reject foreign Snapshot mismatch');
assert.deepEqual(queue(),['2026-10-08'],'invalid mixed holding must remain queued');
snapshots[5][3]='1';
const acceptedPrune=context._pruneVerifiedHistoricalKrxPending_('proof-lease','2026-10-14');
assert.equal(acceptedPrune.cleared,1,'valid domestic and foreign Snapshot may be pruned');
assert.deepEqual(queue(),[],'only fully verified date is pruned');
values.delete('backfill_lease');

console.log('KRX pending cleanup VM: source/Snapshot/leases/all-or-none/idempotence passed');
