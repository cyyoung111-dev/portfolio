import assert from 'node:assert/strict';
import {runPreview} from './preview-krx-pending-reconcile.mjs';

const url='https://script.google.com/macros/s/Abcd/exec';
const token='SECRET_MUST_NOT_APPEAR';
const observed=[];
const good={
 status:'ok',mode:'DRY_RUN',cleared:0,
 checked:[
  {date:'2026-10-07',queued:true,ok:true,verifiedCodes:37,reason:''},
  {date:'2026-10-08',queued:true,ok:true,verifiedCodes:37,reason:''}
 ]
};
const createFetch=(result=good)=>async(_url,options)=>{
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('action'),'reconcileCompletedKrxPending');
  assert.equal(options.body.get('apply'),'0');
  assert.equal(options.body.get('dates'),'2026-10-07,2026-10-08');
  observed.push([...options.body.entries()]);
  return {ok:true,json:async()=>options.body.get('accessToken')===token
    ?result:{status:'error',message:'인증 실패'}};
};
const output=await runPreview({url,token,fetchImpl:createFetch()});
assert.equal(output.status,'READY');
assert.equal(output.mode,'READ_ONLY');
assert.equal(output.entries.length,2);
assert.equal(output.entries[0].verifiedCodes,37);
assert.equal(observed.length,2);
assert.doesNotMatch(JSON.stringify(output),/SECRET_MUST_NOT_APPEAR/);
const notReady=await runPreview({url,token,fetchImpl:createFetch({
 ...good,checked:[good.checked[0],{...good.checked[1],ok:false,
  reason:'MASTER_INCOMPLETE',verifiedCodes:0}]
})});
assert.equal(notReady.status,'BLOCKED');
assert.equal(notReady.entries[1].reason,'MASTER_INCOMPLETE');
const unexpected=await runPreview({url,token,fetchImpl:createFetch({
 ...good,checked:[good.checked[0],{...good.checked[1],queued:false}]
})});
assert.equal(unexpected.status,'BLOCKED');
const cleared=await runPreview({url,token,fetchImpl:createFetch({
 ...good,checked:good.checked.map(x=>({...x,queued:false}))
})});
assert.equal(cleared.status,'ALREADY_CLEAR','repeated workflow run after cleanup must succeed');
assert.equal(cleared.entries.every(x=>!x.queued&&x.verified),true);

await assert.rejects(()=>runPreview({url,token,fetchImpl:async()=>({
 ok:true,json:async()=>good})}),/AUTH_NOT_ENFORCED/);
await assert.rejects(()=>runPreview({url,token,fetchImpl:createFetch({
 ...good,mode:'APPLIED',cleared:2
})}),/INVALID_RESPONSE/);
console.log('KRX pending historical completion preview: read-only auth/contract/mismatch checks passed');
