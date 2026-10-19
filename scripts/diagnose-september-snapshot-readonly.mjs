#!/usr/bin/env node
// READ-ONLY operational proof restricted to 2026-09-15/16 Snapshot.
// No price, holdings, fund, queue or spreadsheet writes. Sanitized aggregates only.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {summarizeConflictDay} from './diagnose-holiday-snapshot-readonly.mjs';

export const SEPTEMBER_DATES=Object.freeze(['2026-09-15','2026-09-16']);
const ACTION='diagnoseSnapshotIntegrityRange';
const DATE_STRING=SEPTEMBER_DATES.join(',');
const ISSUE_KEYS=['duplicateGroups','manualProtectedGroups','unresolvedConflictGroups',
  'sourceIncompleteGroups','missingCodeCount','unexpectedCodeCount',
  'duplicateKeyCount','qtyMismatchCount','costMismatchCount',
  'evalUnitMismatchCount','evalAmountMismatchCount','sourceMismatchCount',
  'sourceDataErrorCount'];

export function summarizeSeptemberProof(payload) {
  if(payload?.status==='error'){
    const allowed=new Set(['RANGE_TOO_LARGE','SOURCE_DATA_ERROR','RUNTIME_ERROR']);
    return {mode:'READ_ONLY',dates:[...SEPTEMBER_DATES],healthy:false,
      errorCode:allowed.has(payload.errorCode)?payload.errorCode:'GAS_UNKNOWN_ERROR',
      phase:['sheet_read','index_build','snapshot_integrity','request_validation'].includes(payload.phase)
        ?payload.phase:'UNKNOWN'};
  }
  if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)
    ||payload.checkedDates.length!==2||!Array.isArray(payload.diagnostics)
    ||payload.diagnostics.length!==2||new Set(payload.checkedDates).size!==2
    ||SEPTEMBER_DATES.some(d=>!payload.checkedDates.includes(d)))
    throw new Error('SEPT_SNAPSHOT_INVALID_RESPONSE');
  const lookup=new Map(payload.diagnostics.map(item=>[item?.date,item]));
  if(lookup.size!==2||SEPTEMBER_DATES.some(d=>!lookup.has(d)))
    throw new Error('SEPT_SNAPSHOT_INVALID_DATES');
  const snapshots=SEPTEMBER_DATES.map(d=>summarizeConflictDay(lookup.get(d)));
  const healthy=snapshots.every(row=>row.status==='VALID'
    &&row.expectedRows===39&&row.storedRows===39
    &&row.fundNavStateCount===2
    &&ISSUE_KEYS.every(k=>row[k]===0));
  return {mode:'READ_ONLY',dates:[...SEPTEMBER_DATES],
    contract:'GAS_SNAPSHOT_EXACT_DATE_39_ROWS_V1',snapshots,healthy};
}

async function read(url,token,fetchImpl){
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:ACTION,dates:DATE_STRING,accessToken:token}),
      redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw new Error('SEPT_SNAPSHOT_NETWORK_FAILED');}
  if(!response.ok)throw new Error('SEPT_SNAPSHOT_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('SEPT_SNAPSHOT_NON_JSON');}
}

export async function verifySeptember({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())
    throw new Error('SEPT_SNAPSHOT_TOKEN_MISSING');
  const wrong=token==='SEPT_SNAPSHOT_NEGATIVE_PROBE'
    ?'SEPT_SNAPSHOT_NEGATIVE_PROBE_ALT':'SEPT_SNAPSHOT_NEGATIVE_PROBE';
  const denied=await read(endpoint,wrong,fetchImpl);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw new Error('SEPT_SNAPSHOT_AUTH_NOT_ENFORCED');
  return summarizeSeptemberProof(await read(endpoint,token,fetchImpl));
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await verifySeptember({url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(result));
    if(!result.healthy)process.exitCode=1;
  }catch(error){
    const msg=String(error?.message||'');
    console.error(/^SEPT_SNAPSHOT_[A-Z_]+$/.test(msg)
      ?msg:'SEPT_SNAPSHOT_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
