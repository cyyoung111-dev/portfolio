import assert from 'node:assert/strict';
import {DATE,auditCloseGap,diagnoseCloseGap} from './issue507-oct30-domestic-close-readonly.mjs';
const domestic=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const funds=['F00001','F00002'],codes=[...domestic,...funds];
const history={status:'ok',date:DATE,items:codes.map(code=>({
 code,name:'PRIVATE_NAME',source:code.startsWith('F')?'FUND_NAV':'KRX_CARRY@2026-10-29',
 evalAmt:99999999}))};
const prices={status:'ok',prices:Object.fromEntries(funds.map(code=>[
 code,[{date:DATE,price:99999999,source:'FUND_NAV'}]]))};
const nh={status:'ok',provider:'NH',enabled:true,tokenCached:false,tokenIssued:false};
const report=auditCloseGap(history,prices,nh);
assert.equal(report.status,'DOMESTIC_CLOSE_INCOMPLETE');
assert.equal(report.snapshotCodes,39);
assert.equal(report.domesticHeldCodes,37);
assert.equal(report.domesticCarriedSnapshotCodes,37);
assert.equal(report.domesticMissingExactHistory,37);
assert.equal(report.domesticExactClosePrices,0);
assert.equal(report.fundExactHistory,2);
assert.equal(report.financialWrites,0);
assert.equal(report.allHeldSameDayStoredSourcesPresent,false);
for(const raw of ['PRIVATE_NAME','99999999','F00001','KRX_CARRY@2026-10-29'])
 assert.ok(!JSON.stringify(report).includes(raw));
const complete={...history,items:history.items.map(x=>({...x,source:x.code.startsWith('F')?'FUND_NAV':'NH_REGULAR_CLOSE'}))};
const fullPrices={status:'ok',prices:{...prices.prices,...Object.fromEntries(domestic.map(code=>[
 code,[{date:DATE,price:99999999,source:'NH_REGULAR_CLOSE'}]]))}};
const completeReport=auditCloseGap(complete,fullPrices,nh);
assert.equal(completeReport.status,'EXACT_DAY_DOMESTIC_HISTORY_PRESENT');
assert.equal(completeReport.allHeldSameDayStoredSourcesPresent,true);
assert.equal(completeReport.domesticExactClosePrices,37);
assert.equal(completeReport.officialFinalityIndependentlyVerified,false);
const copy=x=>structuredClone(x);
for(const bad of [
 {...history,items:[...history.items,history.items[0]]},
 {...history,items:history.items.map(x=>({...x,code:'NOT VALID !'}))},
 {...history,date:'2026-10-29'},
 {...history,items:[]},
])assert.throws(()=>auditCloseGap(bad,prices,nh),/ISSUE507_CLOSE_/);
const duplicate=copy(prices);
duplicate.prices.F00001.push({...duplicate.prices.F00001[0]});
assert.throws(()=>auditCloseGap(history,duplicate,nh),/DUPLICATE_PRICE_UNVERIFIED/);
const unexpected=copy(prices);unexpected.prices.OUTSIDE=[{date:DATE,price:3,source:'MANUAL'}];
assert.throws(()=>auditCloseGap(history,unexpected,nh),/UNREQUESTED_PRICE_ROWS/);
const future=copy(prices);future.prices.F00001[0].date='2026-10-29';
assert.throws(()=>auditCloseGap(history,future,nh),/PRICE_SCOPE_UNVERIFIED/);
const gasStatus={status:'ok',gasVersion:'9.281',automation:{gasVersion:'9.281'}};
const strict={status:'ok',checkedDates:[DATE],diagnostics:[{date:DATE}],
 strictSourceDigest:'a'.repeat(64),integritySourceRevision:'100'};
function fixture(mode='OK'){
 const calls=[],emitted=[];let statusCount=0,sourceCount=0;
 async function fetchImpl(_url,opts){
  const params=opts.body;
  const action=params.get('action');
  calls.push(action);
  assert.equal(opts.method,'POST');
  assert.equal(params.get('accessToken'),'PRIVATE_TOKEN');
  assert.ok(['getAutomationStatus','diagnoseSnapshotIntegrityRange',
   'getHistoryDetail','getPriceHistory','getNhAuthStatusProxy'].includes(action));
  if(action==='diagnoseSnapshotIntegrityRange'){
   assert.equal(params.get('dates'),DATE);
   assert.equal(params.get('strictReadonly'),'1');
  }
  if(action==='getPriceHistory'){
   assert.equal(params.get('codes'),codes.join(','));
   assert.equal(params.get('from'),DATE);
   assert.equal(params.get('to'),DATE);
  }
  const result=action==='getAutomationStatus'?
    {...gasStatus,...(mode==='VERSION_DRIFT'&&++statusCount===2?
      {gasVersion:'9.282',automation:{gasVersion:'9.282'}}:{})}:
    action==='diagnoseSnapshotIntegrityRange'?
      {...strict,...(mode==='SOURCE_DRIFT'&&++sourceCount===2?
        {strictSourceDigest:'b'.repeat(64)}:{})}:
    action==='getHistoryDetail'?history:
    action==='getPriceHistory'?prices:nh;
  return {ok:true,json:async()=>result};
 }
 return {calls,emitted,run:()=>diagnoseCloseGap({
   url:'https://script.google.com/macros/s/TEST/exec',
   token:'PRIVATE_TOKEN',fetchImpl,emit:x=>emitted.push(x)
 })};
}
const f=fixture(),actual=await f.run();
assert.equal(actual.status,'DOMESTIC_CLOSE_INCOMPLETE');
assert.equal(actual.gasVersionVerified,'9.281');
assert.equal(actual.sourceStableWithinRun,true);
assert.equal(actual.nhTokenIssuanceRequested,false);
assert.equal(actual.nhAuthCurrent.tokenIssuedByStatusCall,false);
assert.deepEqual(f.calls,['getAutomationStatus','diagnoseSnapshotIntegrityRange',
 'getHistoryDetail','getPriceHistory','getNhAuthStatusProxy',
 'diagnoseSnapshotIntegrityRange','getAutomationStatus']);
assert.equal(f.emitted.length,1);
assert.ok(!JSON.stringify(f.emitted).includes('PRIVATE_TOKEN'));
for(const scenario of ['SOURCE_DRIFT','VERSION_DRIFT']){
 const f=fixture(scenario);
 await assert.rejects(()=>f.run(),/FUND_SNAPSHOT_(?:SOURCE_CHANGED|RUNTIME_VERSION_CHANGED)/);
 assert.equal(f.emitted.length,0);
}
console.log(JSON.stringify({test:'ISSUE507_OCT30_CLOSE_COVERAGE',status:'PASS',
 scenarios:10,financialWrites:0,nhTokenRequests:0}));
