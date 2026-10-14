import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run actual GAS production functions in an isolated, mutation-recording VM.
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
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
];
let snapshots=[
  sn('2026-10-07','005930',100),sn('2026-10-07','000660',200),
  sn('2026-10-08','005930',101),sn('2026-10-08','000660',201),
];
const sheet=rows=>({
  getLastRow:()=>rows.length+1,
  getRange:(_r,_c,_h,width)=>({getDisplayValues:()=>rows.map(x=>x.slice(0,width))}),
});
const catalog=[
 {code:'005930',market:'KOSPI',currency:'KRW',type:'주식'},
 {code:'000660',market:'KOSPI',currency:'KRW',type:'주식'},
];
const values=new Map([['portfolio_close_pending_krx_dates',JSON.stringify(initialDates)]]);
let writes=[];
const props={
  getProperty:k=>values.has(k)?values.get(k):null,
  setProperty:(k,v)=>{writes.push({key:k,value:v});values.set(k,v);},
  deleteProperty:k=>{writes.push({key:k,delete:true});values.delete(k);},
};
const ss={getSheetByName:n=>n==='가격이력'?sheet(history):n==='스냅샷'?sheet(snapshots):null};
const context=vm.createContext({
  CONFIG:{SHEET_PH:'가격이력',SHEET_SNAPSHOT:'스냅샷'},
  getss:()=>ss, getCodeItems:()=>catalog,
  _getDailyHeldCodeItems:()=>catalog,
  _isKrxDailyCloseTarget_:()=>true,
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
assert.equal(history.length,4);
assert.equal(snapshots.length,4);

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

values.set('backfill_lease',JSON.stringify({until:Date.now()+60000}));
assert.equal(invoke('2026-10-07','1').message,'KRX_PENDING_WRITER_ACTIVE');
assert.deepEqual(queue(),initialDates);
values.delete('backfill_lease');
assert.equal(invoke('2026-10-14','1').message,'KRX_PENDING_INVALID_DATES');
assert.equal(invoke('2026-10-12','1').result.mode,'BLOCKED',
  'no exact-date source/Snapshot must keep truly missing date queued');
assert.deepEqual(queue(),initialDates);
assert.equal(writes.length,0,'all failure modes are read only');

console.log('KRX pending cleanup VM: source/Snapshot/leases/all-or-none/idempotence passed');
