import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export async function run({url,token,apply=false,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('MAINTENANCE_AUTH_MISSING');
  async function request(action,args={},credential=token) {
    let r;
    try {r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(300000)});}
    catch {throw Error('MAINTENANCE_NETWORK');}
    if(!r.ok)throw Error('MAINTENANCE_HTTP');
    try {return await r.json();}catch {throw Error('MAINTENANCE_JSON');}
  }
  const rejected=await request('getAutomationStatus',{},token==='ISSUE507_BAD_AUTH'?'ISSUE507_BAD_AUTH_ALT':'ISSUE507_BAD_AUTH');
  if(rejected.status!=='error'||rejected.message!=='인증 실패')throw Error('MAINTENANCE_AUTH_GUARD');
  const before=await request('getAutomationStatus');
  if(before.status!=='ok'||before.gasVersion!=='9.280')throw Error('MAINTENANCE_VERSION');
  const summaries=[];
  for(const mode of ['reconcile','yearendPrices']) {
    let r;
    try {r=await request('issue507Maintenance',{mode,apply:apply?'1':'0'});}
    catch {summaries.push({mode,status:'UNVERIFIED'});continue;}
    if(r.status==='error') {
      // Never forward raw GAS error text to public Actions logs.
      const safeCodes=new Set(['ISSUE507_AUTH_REQUIRED','ISSUE507_BAD_MAINTENANCE_REQUEST','ISSUE507_MAINTENANCE_BUSY','ISSUE507_LEDGER_UNVERIFIED','ISSUE507_MAINTENANCE_SOURCE_CHANGED','ISSUE507_QUEUE_WRITE_UNVERIFIED','ISSUE507_BACKUP_UNVERIFIED','ISSUE507_PRICE_APPEND_UNVERIFIED','ISSUE507_MAINTENANCE_FAILED']);
      summaries.push({mode,status:'BLOCKED',reason:safeCodes.has(r.message)?r.message:'UNCLASSIFIED'});continue;
    }
    if(r.status!=='ok'||r.mode!==mode||typeof r.applied!=='boolean')throw Error('MAINTENANCE_BAD_RESULT');
    const keys=mode==='reconcile'?['checked','verifiedValid','removed','before','remaining']:['needed','available','added'];
    if(keys.some(k=>!Number.isSafeInteger(r[k])||r[k]<0))throw Error('MAINTENANCE_BAD_COUNTS');
    if(mode==='reconcile'&&(r.before-r.removed!==r.remaining||r.removed>r.verifiedValid||r.originalDataWritten!==false))throw Error('MAINTENANCE_BAD_QUEUE_PROOF');
    if(mode==='yearendPrices'&&(r.added>r.available||r.available>r.needed))throw Error('MAINTENANCE_BAD_PRICE_PROOF');
    summaries.push({mode,status:'OK',applied:r.applied,...Object.fromEntries(keys.map(k=>[k,r[k]]))});
  }
  const after=await request('getAutomationStatus');
  if(after.status!=='ok'||after.gasVersion!=='9.280')throw Error('MAINTENANCE_POSTCHECK');
  const q=summaries.find(x=>x.mode==='reconcile');
  if(q.status==='OK'&&after.automation?.tradeSnapshotDeferredCount!==q.remaining)throw Error('MAINTENANCE_QUEUE_READBACK');
  const complete=summaries.every(r=>r.status==='OK' && (!apply || r.mode==='reconcile' || r.added===r.needed));
  return {mode:apply?'APPLY':'DRY_RUN',complete,summaries,deferredCount:after.automation?.tradeSnapshotDeferredCount};
}

export async function selfTest() {
  let count=0;
  const fixture=async(_url,opts)=>{const a=Object.fromEntries(opts.body);count++;let d;
    if(a.accessToken==='ISSUE507_BAD_AUTH')d={status:'error',message:'인증 실패'};
    else if(a.action==='getAutomationStatus')d={status:'ok',gasVersion:'9.280',automation:{tradeSnapshotDeferredCount:count<4?31:1}};
    else if(a.mode==='yearendPrices')d={status:'ok',mode:a.mode,applied:true,needed:3,available:3,added:3,private:'NOT_FOR_LOGS'};
    else d={status:'ok',mode:a.mode,applied:true,checked:31,verifiedValid:30,removed:30,before:31,remaining:1,originalDataWritten:false};
    return {ok:true,json:async()=>d};};
  const r=await run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl:fixture});
  assert.equal(r.summaries[0].mode,'reconcile');
  assert.equal(r.deferredCount,1);assert.ok(!JSON.stringify(r).includes('NOT_FOR_LOGS'));
  count=0;
  const partial=await run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl:async(u,o)=>{if(o.body.get('mode')==='yearendPrices'){count++;throw Error('PRIVATE');}return fixture(u,o);}});
  assert.equal(partial.complete,false);
  assert.equal(r.complete,true);
  assert.equal(partial.summaries[0].removed,30);assert.equal(partial.summaries[1].status,'UNVERIFIED');assert.equal(partial.deferredCount,1);
  const blocked=await run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',apply:true,fetchImpl:async(_u,o)=>({ok:true,json:async()=>o.body.get('accessToken')==='ISSUE507_BAD_AUTH'?{status:'error',message:'인증 실패'}:o.body.get('action')==='getAutomationStatus'?{status:'ok',gasVersion:'9.280',automation:{tradeSnapshotDeferredCount:31}}:{status:'error',message:'PRIVATE_BUSY'}})});
  assert.equal(blocked.complete,false);assert.equal(blocked.deferredCount,31);assert.ok(blocked.summaries.every(x=>x.status==='BLOCKED'));assert.ok(!JSON.stringify(blocked).includes('PRIVATE_BUSY'));assert.ok(blocked.summaries.every(x=>x.reason==='UNCLASSIFIED'));
  await assert.rejects(()=>run({url:'https://example.com',token:'TEST',fetchImpl:fixture}));
  await assert.rejects(()=>run({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',fetchImpl:async()=>{throw Error('PRIVATE');}}),/^Error: MAINTENANCE_NETWORK$/);
  console.log('✅ #507 유지보수 실행기: 인증·버전·집계 전용 출력·큐 재조회');
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) {
  if(process.argv.includes('--self-test'))await selfTest();
  else try {
    const r=await run({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.argv.includes('--apply')});
    console.log(JSON.stringify(r));
    if(!r.complete)process.exitCode=1;
  }
  catch (error) {
    const allowed=new Set(['MAINTENANCE_AUTH_MISSING','MAINTENANCE_NETWORK','MAINTENANCE_HTTP','MAINTENANCE_JSON','MAINTENANCE_AUTH_GUARD','MAINTENANCE_VERSION','MAINTENANCE_BAD_RESULT','MAINTENANCE_BAD_COUNTS','MAINTENANCE_BAD_QUEUE_PROOF','MAINTENANCE_BAD_PRICE_PROOF','MAINTENANCE_POSTCHECK','MAINTENANCE_QUEUE_READBACK']);
    console.error(allowed.has(error?.message)?error.message:'ISSUE507_MAINTENANCE_RUN_FAILED');process.exitCode=1;
  }
}
