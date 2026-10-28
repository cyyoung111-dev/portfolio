#!/usr/bin/env node
// Authenticated, read-only one-date-at-a-time proof. Never sends apply=1.
// Keep exact-date validation cheap enough for GAS ScriptLock and HTTP timeout.
import {parseDates,validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DEFAULT_DATES='2026-10-12,2026-10-13,2026-10-14';
const REASONS=new Set([
  'MASTER_MISSING','NO_HOLDINGS','TRADE_LEDGER_MISSING','MASTER_INCOMPLETE',
  'SHEET_MISSING','PRICE_HISTORY_INVALID','SNAPSHOT_INVALID',
  'INCOMPLETE_COVERAGE','FULL_SNAPSHOT_MISMATCH',
  'FULL_SNAPSHOT_CONFLICT','FULL_SNAPSHOT_PARTIAL',
  'FULL_SNAPSHOT_NO_SNAPSHOT','FULL_SNAPSHOT_SOURCE_INCOMPLETE',
  'FULL_SNAPSHOT_PRICE_SUSPICIOUS','FULL_SNAPSHOT_COUNT_MISMATCH'
]);
async function request(url,token,date,fetchImpl){
  const body=new URLSearchParams({
    action:'reconcileCompletedKrxPending',dates:date,apply:'0',accessToken:token
  });
  let response, failure;
  // This endpoint is apply=0 only. Repeat one transport failure; never repeat
  // a server response, an invalid proof or a financial write.
  for (let attempt=0;attempt<2;attempt++) {
    try {
      response=await fetchImpl(url,{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body,redirect:'follow',signal:AbortSignal.timeout(90000)
      });
      break;
    } catch (error) {
      failure=error;
      if(attempt===0)console.warn(error?.name==='TimeoutError'?'PENDING_PREVIEW_RETRY_TIMEOUT':'PENDING_PREVIEW_RETRY_NETWORK');
    }
  }
  if(!response)throw new Error(failure?.name==='TimeoutError'?'PENDING_PREVIEW_TIMEOUT':'PENDING_PREVIEW_NETWORK_FAILED');
  if(!response.ok)throw new Error('PENDING_PREVIEW_GAS_HTTP_FAILED');
  try {return await response.json();}
  catch{throw new Error('PENDING_PREVIEW_INVALID_JSON');}
}
export async function runPreview({url,token,dates=DEFAULT_DATES,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('PENDING_PREVIEW_MISSING_TOKEN');
  const targets=parseDates(dates);
  if(targets.length>3)throw new Error('PENDING_PREVIEW_INVALID_DATES');
  const invalidToken=token==='PENDING_PREVIEW_AUTH_PROBE'
    ? 'PENDING_PREVIEW_AUTH_PROBE_ALT':'PENDING_PREVIEW_AUTH_PROBE';
  const deny=await request(endpoint,invalidToken,targets[0],fetchImpl);
  if(deny?.status!=='error'||deny?.message!=='인증 실패')
    throw new Error('PENDING_PREVIEW_AUTH_NOT_ENFORCED');
  const entries=[];
  for(const date of targets){
    // One target per request: the actual server proof scans price, trade
    // ledger and the full Snapshot under ScriptLock, not a cheap API ping.
    const data=await request(endpoint,token,date,fetchImpl);
    // Only fixed production error enums may leave the authenticated boundary.
    // These remain fatal even with --allow-blocked; no proof or queue change
    // can be inferred from a server error. Never print the original message.
    if(data?.status==='error') {
      const failures=new Map([
        ['인증 실패','PENDING_PREVIEW_GAS_ACCESS_DENIED'],
        ['KRX_PENDING_INVALID_DATES','PENDING_PREVIEW_GAS_INVALID_DATES'],
        ['KRX_PENDING_WRITER_ACTIVE','PENDING_PREVIEW_GAS_WRITER_ACTIVE'],
        ['KRX_PENDING_RECONCILE_FAILED','PENDING_PREVIEW_GAS_RECONCILE_FAILED'],
      ]);
      throw new Error(failures.get(data.message)||'PENDING_PREVIEW_INVALID_RESPONSE');
    }
    if(data?.status!=='ok'||data.mode!=='DRY_RUN'||data.cleared!==0||
       !Array.isArray(data.checked)||data.checked.length!==1)
      throw new Error('PENDING_PREVIEW_INVALID_RESPONSE');
    const item=data.checked[0];
    if(!item||item.date!==date||typeof item.queued!=='boolean'||
      typeof item.ok!=='boolean'||!Number.isSafeInteger(item.verifiedCodes)||
      item.verifiedCodes<0||typeof item.reason!=='string')
      throw new Error('PENDING_PREVIEW_INVALID_RESPONSE');
    // A legitimate incomplete date has one documented proof reason and zero
    // verified codes. Unknown/missing reasons are response-contract failures,
    // NOT business-as-usual BLOCKED results that --allow-blocked may mask.
    if(item.ok
        ? item.verifiedCodes<=0||item.reason!==''
        : item.verifiedCodes!==0||!REASONS.has(item.reason))
      throw new Error('PENDING_PREVIEW_INVALID_RESPONSE');
    entries.push({date,queued:item.queued,verified:item.ok,
      verifiedCodes:item.verifiedCodes,reason:item.reason});
  }
  const valid=entries.every(x=>x.verified&&x.verifiedCodes>0);
  const ready=valid&&entries.every(x=>x.queued);
  const alreadyClear=valid&&entries.every(x=>!x.queued);
  return {mode:'READ_ONLY',status:ready?'READY':alreadyClear?'ALREADY_CLEAR':'BLOCKED',entries};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const argIndex=process.argv.indexOf('--dates');
    const dates=argIndex>=0?process.argv[argIndex+1]:DEFAULT_DATES;
    const result=await runPreview({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,dates
    });
    console.log(JSON.stringify(result));
    // Diagnostics may legitimately be BLOCKED; the opt-in flag keeps that
    // as data while auth/network/response failures remain fatal.
    if(result.status==='BLOCKED'&&!process.argv.includes('--allow-blocked'))process.exitCode=1;
  }catch(error){
    const code=String(error?.message||'');
    const allowed=/^PENDING_PREVIEW_[A-Z_]+$/;
    console.error(allowed.test(code)?code:'PENDING_PREVIEW_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
