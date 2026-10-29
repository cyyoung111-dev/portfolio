import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export async function runBacklog({url,token,apply=false,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(!token?.trim())throw Error('BACKLOG_CLIENT_AUTH_MISSING');
  async function request(action,args={},credential=token){
    let response;try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(300000)});}catch{throw Error('BACKLOG_CLIENT_NETWORK');}
    if(!response.ok)throw Error('BACKLOG_CLIENT_HTTP');
    try{return await response.json();}catch{throw Error('BACKLOG_CLIENT_JSON');}
  }
  const bad=token==='BACKLOG_BAD_AUTH'?'BACKLOG_BAD_AUTH_ALT':'BACKLOG_BAD_AUTH';
  const rejected=await request('getAutomationStatus',{},bad);
  if(rejected.status!=='error'||rejected.message!=='인증 실패')throw Error('BACKLOG_CLIENT_AUTH_GUARD');
  const before=await request('getAutomationStatus');
  if(before.status!=='ok'||before.gasVersion!=='9.276')throw Error('BACKLOG_CLIENT_VERSION');
  const r=await request('reconcileTradeSnapshotBacklog',{apply:apply?'1':'0'});
  if(r.status!=='ok'){
    const safe=new Set(['BACKLOG_AUTH_REQUIRED','BACKLOG_BAD_APPLY','BACKLOG_BUSY','BACKLOG_LEDGER_UNVERIFIED','BACKLOG_BAD_PENDING','BACKLOG_FUTURE_DEFERRED','BACKLOG_SNAPSHOT_REQUIRED','BACKLOG_DATE_LIMIT','BACKLOG_DEFERRED_LIMIT','BACKLOG_SOURCE_CHANGED','BACKLOG_BACKUP_LIMIT','BACKLOG_QUEUE_UNVERIFIED','BACKLOG_PENDING_UNVERIFIED',...['VALIDATE','READ','DATES','DIAGNOSE','VERIFY','COMMIT'].map(p=>'BACKLOG_'+p+'_FAILED')]);
    throw Error(safe.has(r.message)?r.message:'BACKLOG_CLIENT_SERVER_ERROR');
  }
  const nums=['checkedDates','validDates','emptyVerifiedDates','manualDates','sourceIncompleteDates','forwardDates','deferredBefore','deferredAfter','projectedDeferred'];
  if(nums.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.originalDataWritten!==false||r.sourceStable!==true
      ||r.mode!==(apply?'APPLY':'DRY_RUN')||typeof r.pendingCleared!=='boolean'
      ||r.validDates>r.checkedDates||r.manualDates>r.checkedDates
      ||r.projectedDeferred!==r.checkedDates-r.validDates||(apply&&r.deferredAfter!==r.projectedDeferred))throw Error('BACKLOG_CLIENT_BAD_PROOF');
  const allowed=['VALID','PARTIAL','MISMATCH','CONFLICT','SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS'];
  if(!r.counts||Object.keys(r.counts).some(k=>!allowed.includes(k))||Object.values(r.counts).some(n=>!Number.isSafeInteger(n)||n<0)
      ||Object.values(r.counts).reduce((a,b)=>a+b,0)!==r.checkedDates)throw Error('BACKLOG_CLIENT_BAD_COUNTS');
  const after=await request('getAutomationStatus');
  if(after.status!=='ok'||after.gasVersion!=='9.276'||after.automation?.tradeSnapshotDeferredCount!==r.deferredAfter
      ||(r.pendingCleared&&after.automation?.pendingTradeSnapshotRebuildFrom))throw Error('BACKLOG_CLIENT_READBACK');
  return {mode:r.mode,...Object.fromEntries(nums.map(k=>[k,r[k]])),counts:r.counts,pendingCleared:r.pendingCleared,originalDataWritten:false,sourceStable:true};
}
export async function selfTest(){
  await assert.rejects(()=>runBacklog({url:'https://example.com',token:'TEST'}));
  await assert.rejects(()=>runBacklog({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',fetchImpl:async()=>{throw Error('PRIVATE');}}),/^Error: BACKLOG_CLIENT_NETWORK$/);
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  if(process.argv.includes('--self-test'))await selfTest();
  else try{console.log(JSON.stringify(await runBacklog({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.argv.includes('--apply')})));}
  catch(error){console.error(/^(?:BACKLOG_CLIENT_[A-Z_]+|BACKLOG_(?:AUTH_REQUIRED|BAD_APPLY|BUSY|LEDGER_UNVERIFIED|BAD_PENDING|FUTURE_DEFERRED|SNAPSHOT_REQUIRED|DATE_LIMIT|DEFERRED_LIMIT|SOURCE_CHANGED|BACKUP_LIMIT|QUEUE_UNVERIFIED|PENDING_UNVERIFIED|(?:VALIDATE|READ|DATES|DIAGNOSE|VERIFY|COMMIT)_FAILED))$/.test(error?.message||'')?error.message:'BACKLOG_CLIENT_UNKNOWN');process.exitCode=1;}
}
