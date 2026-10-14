#!/usr/bin/env node
// A one-time, read-only preview of the existing GAS v9.220+ pending-date
// reconciliation. There is no apply=1 operation anywhere in this script.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DATES=Object.freeze(['2026-10-07','2026-10-08']);
async function request(url,token,fetchImpl){
  const body=new URLSearchParams({
    action:'reconcileCompletedKrxPending',
    dates:DATES.join(','),apply:'0',accessToken:token
  });
  let response;
  try {
    response=await fetchImpl(url,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(45000)
    });
  } catch {throw new Error('PENDING_PREVIEW_NETWORK_FAILED');}
  if(!response.ok)throw new Error('PENDING_PREVIEW_GAS_HTTP_FAILED');
  try {return await response.json();}
  catch{throw new Error('PENDING_PREVIEW_INVALID_JSON');}
}
export async function runPreview({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('PENDING_PREVIEW_MISSING_TOKEN');
  const invalidToken=token==='PENDING_PREVIEW_AUTH_PROBE'
    ? 'PENDING_PREVIEW_AUTH_PROBE_ALT':'PENDING_PREVIEW_AUTH_PROBE';
  const deny=await request(endpoint,invalidToken,fetchImpl);
  if(deny?.status!=='error'||deny?.message!=='인증 실패')
    throw new Error('PENDING_PREVIEW_AUTH_NOT_ENFORCED');
  const data=await request(endpoint,token,fetchImpl);
  if(data?.status!=='ok'||data.mode!=='DRY_RUN'||data.cleared!==0||
     !Array.isArray(data.checked)||data.checked.length!==DATES.length)
    throw new Error('PENDING_PREVIEW_INVALID_RESPONSE');
  const entries=DATES.map((date,i)=>{
    const item=data.checked[i];
    if(!item||item.date!==date||typeof item.queued!=='boolean'||
      typeof item.ok!=='boolean'||!Number.isSafeInteger(item.verifiedCodes)
      ||item.verifiedCodes<0||typeof item.reason!=='string')
      throw new Error('PENDING_PREVIEW_INVALID_RESPONSE');
    return {date,queued:item.queued,verified:item.ok,
      verifiedCodes:item.verifiedCodes,
      reason:item.ok?'':(
        ['MASTER_MISSING','NO_HOLDINGS','TRADE_LEDGER_MISSING','MASTER_INCOMPLETE',
        'SHEET_MISSING','PRICE_HISTORY_INVALID','SNAPSHOT_INVALID',
        'INCOMPLETE_COVERAGE'].includes(item.reason)?item.reason:'OTHER_CHECK_FAILED')};
  });
  const ready=entries.every(x=>x.queued&&x.verified&&x.verifiedCodes===37);
  return {mode:'READ_ONLY',status:ready?'READY':'BLOCKED',entries};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await runPreview({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
    });
    console.log(JSON.stringify(result));
    if(result.status!=='READY')process.exitCode=1;
  }catch(error){
    const code=String(error?.message||'');
    const allowed=/^PENDING_PREVIEW_[A-Z_]+$/;
    console.error(allowed.test(code)?code:'PENDING_PREVIEW_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
