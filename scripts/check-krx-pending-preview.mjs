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
let attempts=0;
const recovered=await runPreview({url,token,dates:dates[0],fetchImpl:async(...args)=>{
  attempts++; if(attempts===2)throw Error('secret'); return createFetch()(...args);
}});
assert.equal(recovered.status,'READY');assert.equal(attempts,3,'retry only failed read request');
let failures=0;
await assert.rejects(()=>runPreview({url,token,dates:dates[0],fetchImpl:async()=>{failures++;let e=new Error('private');e.name='TimeoutError';throw e;}}),/PENDING_PREVIEW_TIMEOUT/);
assert.equal(failures,2,'stop after one retry');
let httpFailures=0;
await assert.rejects(()=>runPreview({url,token,dates:dates[0],fetchImpl:async()=>{httpFailures++;return {ok:false};}}),/PENDING_PREVIEW_GAS_HTTP_FAILED/);
assert.equal(httpFailures,1,'HTTP or validation failures must not be retried');
// P2: --allow-blocked cannot turn malformed GAS response contracts into
// successful observation. The real runPreview parser must fail closed.
for(const reason of ['', 'UNRECOGNIZED_GAS_REASON', 'FULL_SNAPSHOT_NEW_UNKNOWN', 'FULL_SNAPSHOT_INVALID']) {
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

// Production returns explicit error envelopes for auth, active writers and
// failed reconciliation. Preserve the safe enum without exposing raw messages.
for (const [message, code] of [
  ['인증 실패','PENDING_PREVIEW_GAS_ACCESS_DENIED'],
  ['KRX_PENDING_INVALID_DATES','PENDING_PREVIEW_GAS_INVALID_DATES'],
  ['KRX_PENDING_WRITER_ACTIVE','PENDING_PREVIEW_GAS_WRITER_ACTIVE'],
  ['KRX_PENDING_RECONCILE_FAILED','PENDING_PREVIEW_GAS_RECONCILE_FAILED'],
]) {
  await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(()=>
    ({status:'error',message}))}),error=>error.message===code);
}
for (const response of [
  {status:'error',message:'client_secret=SECRET_MUST_NOT_APPEAR'},
  {status:'ok',message:'KRX_PENDING_WRITER_ACTIVE'},
]) {
  await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch(()=>response)}),
    error=>error.message==='PENDING_PREVIEW_INVALID_RESPONSE');
}

console.log('KRX pending proof preview: one-date read-only auth/timeout/integrity/partial/retry PASS');
