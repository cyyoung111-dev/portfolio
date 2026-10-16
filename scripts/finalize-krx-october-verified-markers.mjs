#!/usr/bin/env node
// One-time, explicitly whitelisted KRX pending MARKER cleanup.
// No PRICE / Snapshot / NAV / ledger writes. GAS re-proves each date under
// ScriptLock on apply=1; an uncertain network result is NEVER blindly retried.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runPreview} from './preview-krx-pending-reconcile.mjs';

export const APPROVED_DATES=Object.freeze([
  '2026-10-06','2026-10-07','2026-10-08',
  '2026-10-12','2026-10-13','2026-10-14','2026-10-15'
]);
const GROUPS=Object.freeze([
  APPROVED_DATES.slice(0,3),
  APPROVED_DATES.slice(3,6),
  APPROVED_DATES.slice(6)
]);
async function post(endpoint,token,fields,timeoutMs,fetchImpl){
  let response;
  try{
    response=await fetchImpl(endpoint,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({...fields,accessToken:token}),
      redirect:'follow',signal:AbortSignal.timeout(timeoutMs)
    });
  }catch{throw new Error('KRX_OCTOBER_NETWORK_FAILED');}
  if(!response.ok)throw new Error('KRX_OCTOBER_HTTP_FAILED');
  try{return await response.json();}catch{throw new Error('KRX_OCTOBER_INVALID_JSON');}
}
async function readStatus(endpoint,token,fetchImpl) {
  const d=await post(endpoint,token,{action:'getAutomationStatus'},90000,fetchImpl);
  if(d?.status!=='ok'||d.automation?.gasVersion!=='9.233')
    throw new Error('KRX_OCTOBER_VERSION_UNVERIFIED');
}
async function proveAll(endpoint,token,fetchImpl,onProgress,phase){
  const entries=[];
  for(let groupIndex=0;groupIndex<GROUPS.length;groupIndex++){
    const group=GROUPS[groupIndex];
    onProgress(phase+'_GROUP_'+(groupIndex+1)+'_START');
    const preview=await runPreview({url:endpoint,token,dates:group.join(','),fetchImpl});
    if(preview.mode!=='READ_ONLY'||preview.entries.length!==group.length)
      throw new Error('KRX_OCTOBER_PROOF_INVALID');
    for(let i=0;i<group.length;i++){
      const v=preview.entries[i];
      if(v.date!==group[i]||v.verified!==true||v.verifiedCodes!==37||
          typeof v.queued!=='boolean'||v.reason!=='')
        throw new Error('KRX_OCTOBER_PROOF_NOT_VERIFIED');
      entries.push(v);
    }
    onProgress(phase+'_GROUP_'+(groupIndex+1)+'_PASS');
  }
  if(entries.length!==APPROVED_DATES.length)
    throw new Error('KRX_OCTOBER_PROOF_NOT_VERIFIED');
  return entries;
}
async function applyOne(endpoint,token,date,fetchImpl) {
  const data=await post(endpoint,token,{
    action:'reconcileCompletedKrxPending',dates:date,apply:'1'
  },120000,fetchImpl);
  const x=data?.checked?.[0];
  if(data?.status!=='ok'||data.mode!=='APPLIED'||data.cleared!==1||
      data.checked.length!==1||x?.date!==date||x.queued!==true||
      x.ok!==true||x.verifiedCodes!==37||x.reason!=='')
    throw new Error('KRX_OCTOBER_APPLY_NOT_VERIFIED');
}
export async function finalizeOctoberMarkers({url,token,apply=false,fetchImpl=fetch,onProgress=()=>{}}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())
    throw new Error('KRX_OCTOBER_MISSING_TOKEN');
  onProgress('STATUS_START');
  await readStatus(endpoint,token,fetchImpl);
  onProgress('STATUS_OK');
  // All-or-none initial preflight: no marker write unless all seven
  // official KRX + trade ledger + entire Snapshot proofs pass at this time.
  const before=await proveAll(endpoint,token,fetchImpl,onProgress,'PRECHECK');
  const queued=before.filter(x=>x.queued).map(x=>x.date);
  if(!apply)return {mode:'DRY_RUN',verifiedDates:APPROVED_DATES.length,
    initiallyQueued:queued,cleared:0};
  let cleared=0;
  for(let i=0;i<queued.length;i++){
    const date=queued[i];
    onProgress('APPLY_'+(i+1)+'_START');
    await applyOne(endpoint,token,date,fetchImpl);
    cleared++;
    onProgress('APPLY_'+(i+1)+'_PASS');
  }
  const after=await proveAll(endpoint,token,fetchImpl,onProgress,'POSTCHECK');
  if(after.some(x=>x.queued))throw new Error('KRX_OCTOBER_QUEUE_REMAINS');
  return {mode:'APPLIED',verifiedDates:APPROVED_DATES.length,
    initiallyQueued:queued.length,cleared,remainingApprovedDates:0};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await finalizeOctoberMarkers({
      url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,
      apply:process.env.KRX_OCTOBER_APPLY==='1',
      onProgress:stage=>console.log('KRX_OCTOBER_STAGE_'+stage)
    });
    console.log(JSON.stringify(result));
  }catch(err){
    const code=String(err?.message||'');
    console.error(/^(?:KRX_OCTOBER|PENDING_PREVIEW|KRX_DIAG)_[A-Z_]+$/.test(code)
      ?code:'KRX_OCTOBER_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
