import assert from 'node:assert/strict';
import {runPreview} from './preview-krx-pending-reconcile.mjs';

const url='https://script.google.com/macros/s/Abcd/exec';
const token='SECRET_MUST_NOT_APPEAR';
const dates=['2026-10-12','2026-10-13','2026-10-14'];
const observed=[];
const good=date=>({status:'ok',mode:'DRY_RUN',cleared:0,checked:[
  {date,queued:true,ok:true,verifiedCodes:37,reason:''}
]});
const createFetch=(override=()=>null)=>async (_url,options)=>{
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('action'),'reconcileCompletedKrxPending');
  assert.equal(options.body.get('apply'),'0');
  const date=options.body.get('dates');
  assert.ok(dates.includes(date),'must request only one target date');
  assert.equal(date.includes(','),false,'one date per full Snapshot proof');
  observed.push([...options.body.entries()]);
  if(options.body.get('accessToken')!==token)
    return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  return {ok:true,json:async()=>(override(date)||good(date))};
};
const output=await runPreview({url,token,fetchImpl:createFetch()});
assert.equal(output.status,'READY');
assert.equal(output.mode,'READ_ONLY');
assert.deepEqual(output.entries.map(e=>e.date),dates);
assert.equal(output.entries.every(e=>e.verifiedCodes===37),true);
assert.equal(observed.length,4,'one auth probe and three independent date proofs');
assert.doesNotMatch(JSON.stringify(output),/SECRET_MUST_NOT_APPEAR/);
const notReady=await runPreview({url,token,fetchImpl:createFetch(date=>
  date===dates[1]?{...good(date),checked:[{...good(date).checked[0],
    ok:false,reason:'FULL_SNAPSHOT_MISMATCH',verifiedCodes:0}]}:null
)});
assert.equal(notReady.status,'BLOCKED');
assert.equal(notReady.entries[1].reason,'FULL_SNAPSHOT_MISMATCH');
const unexpected=await runPreview({url,token,fetchImpl:createFetch(date=>
  date===dates[2]?{...good(date),checked:[{...good(date).checked[0],queued:false}]}:null
)});
assert.equal(unexpected.status,'BLOCKED');
const cleared=await runPreview({url,token,fetchImpl:createFetch(date=>({
  ...good(date),checked:[{...good(date).checked[0],queued:false}]
}))});
assert.equal(cleared.status,'ALREADY_CLEAR','repeated proof after cleanup must succeed');
assert.equal(cleared.entries.every(x=>!x.queued&&x.verified),true);
const custom=await runPreview({url,token,dates:'2026-10-12',fetchImpl:createFetch()});
assert.equal(custom.entries.length,1,'single-day diagnostic should be supported');
await assert.rejects(()=>runPreview({url,token,dates:'2026-10-12,2026-10-12',
  fetchImpl:createFetch()}),/KRX_DIAG_INVALID_DATES/);
await assert.rejects(()=>runPreview({url,token,dates:'2026-10-12,2026-10-13,2026-10-14,2026-10-15',
  fetchImpl:createFetch()}),/PENDING_PREVIEW_INVALID_DATES/);
await assert.rejects(()=>runPreview({url,token,fetchImpl:async()=>({
  ok:true,json:async()=>good(dates[0])})}),/AUTH_NOT_ENFORCED/);
await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(date=>({
  ...good(date),mode:'APPLIED',cleared:1
}))}),/INVALID_RESPONSE/);
await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(date=>({
  ...good(date),checked:[{...good(date).checked[0],date:'2026-10-07'}]
}))}),/INVALID_RESPONSE/);
await assert.rejects(()=>runPreview({url,token,fetchImpl:async()=>{throw Error('secret');}}),
  /PENDING_PREVIEW_NETWORK_FAILED/);
// P2: --allow-blocked cannot turn malformed GAS response contracts into
// successful observation. The real runPreview parser must fail closed.
for(const reason of ['', 'UNRECOGNIZED_GAS_REASON', 'FULL_SNAPSHOT_NEW_UNKNOWN']) {
  await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(date=>
    date===dates[0]?{...good(date),checked:[{date,queued:true,ok:false,
      verifiedCodes:0,reason}]}:null
  )}),/PENDING_PREVIEW_INVALID_RESPONSE/);
}
await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(date=>
  date===dates[1]?{...good(date),checked:[{date,queued:true,ok:false,
    verifiedCodes:37,reason:'PRICE_HISTORY_INVALID'}]}:null
)}),/PENDING_PREVIEW_INVALID_RESPONSE/,
  'a failed proof cannot declare any codes verified');
await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(date=>
  date===dates[2]?{...good(date),checked:[{date,queued:true,ok:true,
    verifiedCodes:37,reason:'SNAPSHOT_INVALID'}]}:null
)}),/PENDING_PREVIEW_INVALID_RESPONSE/,
  'a successful proof cannot carry a contradictory failure reason');
const knownIncomplete=await runPreview({url,token,fetchImpl:createFetch(date=>
  date===dates[0]?{...good(date),checked:[{date,queued:true,ok:false,
    verifiedCodes:0,reason:'FULL_SNAPSHOT_CONFLICT'}]}:null
)});
assert.equal(knownIncomplete.status,'BLOCKED');
assert.equal(knownIncomplete.entries[0].reason,'FULL_SNAPSHOT_CONFLICT');

console.log('KRX pending proof preview: one-date read-only auth/timeout/integrity/partial/retry PASS');
