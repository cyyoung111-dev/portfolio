#!/usr/bin/env node
// ONE-TIME, exact-date KRX pending marker cleanup. No price / Snapshot writes.
// Production GAS rechecks official KRX, the complete domestic/foreign Snapshot,
// ledger and ScriptLock inside each apply. Never trust preview alone.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runPreview} from './preview-krx-pending-reconcile.mjs';

export const APPROVED_DATES=Object.freeze([
  '2026-10-12','2026-10-13','2026-10-14'
]);
function checkedProof(entries) {
  if (!Array.isArray(entries) || entries.length!==APPROVED_DATES.length
      || entries.some((x,i)=>x.date!==APPROVED_DATES[i]
        || x.verified!==true || x.verifiedCodes!==37
        || typeof x.queued!=='boolean')) {
    throw new Error('KRX_FINALIZE_DRY_RUN_NOT_VERIFIED');
  }
}
function assertApplyResponse(data,date) {
  if (data?.status!=='ok'||data.mode!=='APPLIED'
      || !Number.isSafeInteger(data.cleared)
      || !Array.isArray(data.checked)||data.checked.length!==1) {
    throw new Error('KRX_FINALIZE_INVALID_APPLY_RESPONSE');
  }
  const x=data.checked[0];
  if(x?.date!==date||x.ok!==true||x.verifiedCodes!==37
      || typeof x.queued!=='boolean'
      || data.cleared!==(x.queued?1:0)) {
    throw new Error('KRX_FINALIZE_INVALID_APPLY_RESPONSE');
  }
  return data.cleared;
}
async function postApply(endpoint,token,date,fetchImpl) {
  let response;
  try{
    response=await fetchImpl(endpoint,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({
        action:'reconcileCompletedKrxPending',dates:date,apply:'1',accessToken:token
      }),
      redirect:'follow',signal:AbortSignal.timeout(120000)
    });
  }catch{throw new Error('KRX_FINALIZE_APPLY_NETWORK_FAILED');}
  if(!response.ok)throw new Error('KRX_FINALIZE_APPLY_HTTP_FAILED');
  let data;
  try{data=await response.json();}catch{throw new Error('KRX_FINALIZE_APPLY_INVALID_JSON');}
  return assertApplyResponse(data,date);
}
export async function runVerifiedPendingCleanup({url,token,apply=false,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('KRX_FINALIZE_MISSING_TOKEN');
  const before=await runPreview({
    url:endpoint,token,dates:APPROVED_DATES.join(','),fetchImpl
  });
  checkedProof(before.entries);
  const queued=before.entries.filter(x=>x.queued).map(x=>x.date);
  if(!apply)return {mode:'DRY_RUN',verifiedCodes:37,queuedDates:queued,cleared:0};
  let cleared=0;
  // Single-date POST per verified date, independently revalidated by GAS.
  // Never retry an uncertain network response blindly: rerun begins with an
  // authenticated read-only preview and sees the already-cleared state.
  for(const date of queued)cleared+=await postApply(endpoint,token,date,fetchImpl);
  const after=await runPreview({
    url:endpoint,token,dates:APPROVED_DATES.join(','),fetchImpl
  });
  checkedProof(after.entries);
  if(after.entries.some(x=>x.queued))throw new Error('KRX_FINALIZE_QUEUE_REMAINS');
  return {mode:'APPLIED',verifiedCodes:37,initialQueued:queued.length,
    cleared,remainingApprovedDates:0};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await runVerifiedPendingCleanup({
      url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,
      apply:process.env.KRX_FINALIZE_APPLY==='1'
    });
    console.log(JSON.stringify(result));
  }catch(error){
    const code=String(error?.message||'');
    console.error(/^KRX_FINALIZE_[A-Z_]+$/.test(code)
      ?code:'KRX_FINALIZE_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
