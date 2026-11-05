import assert from 'node:assert/strict';
import vm from 'node:vm';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9283BackfillQueueSelfSeedPreview} from './compose-gas9283-backfill-queue-selfseed-preview.mjs';

const {candidate,baseCandidate,manifest}=composeGas9283BackfillQueueSelfSeedPreview();
const name='_runPendingKrxBackfillWithLease_';
const getFn=(src,n)=>{
 const i=src.indexOf('function '+n+'('),end=src.indexOf(String.fromCharCode(10)+'}',i);
 assert.ok(i>=0&&end>i,n);
 return src.slice(i,end+2);
};
assert.equal(gasSourceBlobSha(candidate),manifest.candidateBlob);
assert.equal(gasSourceBlobSha(baseCandidate),manifest.baseCandidateBlob);
assert.equal(candidate.replace(getFn(candidate,name),getFn(baseCandidate,name)),baseCandidate);
assert.equal(getFn(candidate,'saveDailyPriceHistory'),getFn(baseCandidate,'saveDailyPriceHistory'));
assert.equal(manifest.deploymentApproved,false);
new vm.Script(candidate);

function simulate(src,{runDate='2026-11-05',last='2026-11-03',foreignOnly=false,fromClose=false,target=null,twice=false}={}){
 const pending='portfolio_close_pending_krx_dates',storage=new Map([
  [pending,'[]'],['snapshot_last_success_date',last]
 ]);
 const writes=[],props={
  getProperty:k=>storage.get(k)||null,
  setProperty:(k,v)=>{storage.set(k,String(v));if(k===pending)writes.push(String(v));},
  deleteProperty:k=>storage.delete(k)
 };
 const c=vm.createContext({
  Date,JSON,Number,String,Logger:{log(){}},
  PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:pending,
  PORTFOLIO_FUND_LEASE_KEY:'fund',
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'lease',
  Utilities:{getUuid:()=> 'local-lease'},
  getss:()=>({}),getCodeItems:()=>[{code:'001234',currency:'KRW',market:'KRX'}],
  _hasKrxHoldingsForCloseDate_:()=>!foreignOnly,
  _normalizeDate:x=>String(x||''),
  _fundDateOffset:(d,n)=>{
   const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);
   return x.toISOString().slice(0,10);
  },
  _krxCalendarStatus_:d=>[0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())?'CLOSED':'OPEN',
  _portfolioFundAtomic_:fn=>fn(props),
  _portfolioFundState_:(p,k)=>p.getProperty(k)?JSON.parse(p.getProperty(k)):null,
  _pruneVerifiedHistoricalKrxPending_:()=>({cleared:0}),
  _retryOnePendingKrxClose_:()=>({attempted:false,remaining:JSON.parse(props.getProperty(pending)||'[]').length}),
  _targetedKrxRecoveryPreflight_:()=>({ready:false,reason:'SYNTHETIC_DENIAL'})
 });
 for(const n of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
  '_seedMissingKrxCloseDates_',name])vm.runInContext(getFn(src,n),c);
 const call=()=>c._runPendingKrxBackfillWithLease_(props,runDate,fromClose,false,target);
 call();if(twice)call();
 return {queue:JSON.parse(props.getProperty(pending)),writes:writes.length,lease:props.getProperty('lease')};
}
assert.deepEqual(simulate(baseCandidate).queue,[]);
assert.deepEqual(simulate(candidate).queue,['2026-11-04']);
assert.equal(simulate(candidate,{twice:true}).writes,1);
assert.deepEqual(simulate(candidate,{runDate:'2026-11-09',last:'2026-11-05'}).queue,['2026-11-06']);
assert.deepEqual(simulate(candidate,{foreignOnly:true}).queue,[]);
assert.deepEqual(simulate(candidate,{fromClose:true}).queue,[]);
assert.deepEqual(simulate(candidate,{target:'2026-11-04'}).queue,[]);
assert.equal(simulate(candidate).lease,null);
console.log('GAS_9283_QUEUE_SELFSEED_PASS: source-only; missed day queued once; no deploy');
