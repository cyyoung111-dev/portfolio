#!/usr/bin/env node
// #734: one-date protected GAS Snapshot integrity inspection after the
// 2026-11-12 19:00 close remained INCOMPLETE at the 20:40 readback.
// Never submit a save, force-price, recovery, NAV, or writer action.
// Never emit private financial values, source errors, codes, IDs or tokens.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const DATE='2026-11-12';
const ACTION='diagnoseSnapshotIntegrityRange';
const ALLOWED=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const ARRAY_KEYS=['missingCodes','unexpectedCodes','duplicateKeys',
  'qtyMismatches','costAmtMismatches','evalUnitMismatches',
  'evalAmtMismatches','sourceMismatches','sourceDataErrors'];
const DUP_KEYS=['groups','exactDuplicate','singleExpectedMatch',
  'manualProtected','unresolvedConflict','sourceIncomplete'];
const int=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;
const arrayCount=(o,k)=>{
  if(!Array.isArray(o?.[k]))throw Error('CLOSE_DATE_BAD_ARRAY');
  return o[k].length;
};

export function summarizeSnapshotCloseReadback(payload){
  if(payload?.status!=='ok'
    ||!Array.isArray(payload.checkedDates)
    ||payload.checkedDates.length!==1||payload.checkedDates[0]!==DATE
    ||!Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1)
    throw Error('CLOSE_DATE_BAD_RESPONSE');
  const d=payload.diagnostics[0];
  if(d?.date!==DATE||!ALLOWED.has(d.status))throw Error('CLOSE_DATE_BAD_STATUS');
  const expected=int(d.expectedRowCount),stored=int(d.storedRowCount);
  if(expected===null||stored===null)throw Error('CLOSE_DATE_BAD_COUNTS');
  const arrays=Object.fromEntries(ARRAY_KEYS.map(k=>[k,arrayCount(d,k)]));
  const dup={};
  for(const k of DUP_KEYS){
    const n=int(d.duplicateSummary?.[k]);
    if(n===null)throw Error('CLOSE_DATE_BAD_DUPLICATES');
    dup[k]=n;
  }
  const funds=arrayCount(d,'fundNavStates');
  const sources=Array.isArray(d.priceIntegrity)
    ?Object.fromEntries(Object.entries(Object.groupBy(d.priceIntegrity,
      row=>['VALID','MANUAL_PROTECTED','MISSING','SOURCE_INCOMPLETE',
        'PRICE_SUSPICIOUS','UNVERIFIED'].includes(row?.status)
        ?row.status:'OTHER')).map(([k,v])=>[k,v.length]))
    :{};
  return {
    kind:'ISSUE734_NOV12_SNAPSHOT_PROOF_READONLY',
    observedDate:DATE,storeStatus:d.status,expectedRows:expected,
    storedRows:stored,issues:arrays,duplicateSummary:dup,
    verifiedFunds:funds,priceSourceStates:sources,
    closeNotAsserted:d.status!=='VALID'||expected!==stored
      ||Object.values(arrays).some(n=>n>0)||dup.groups>0,
    writes:0,requests:1,noRebuildAttempted:true
  };
}
export async function readNov12Snapshot({url,token,fetchImpl=fetch}={}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||token.length<12)
    throw Error('CLOSE_DATE_MISSING_AUTH');
  let response;
  try{
    response=await fetchImpl(endpoint,{
      method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:ACTION,dates:DATE,
        strictReadonly:'1',accessToken:token}),
      signal:AbortSignal.timeout(120000)
    });
  }catch(e){
    throw Error(e?.name==='TimeoutError'||e?.name==='AbortError'
      ?'CLOSE_DATE_TIMEOUT':'CLOSE_DATE_NETWORK');
  }
  if(response?.ok!==true)throw Error('CLOSE_DATE_HTTP');
  let payload;
  try{payload=await response.json();}catch{throw Error('CLOSE_DATE_JSON');}
  return summarizeSnapshotCloseReadback(payload);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    console.log(JSON.stringify(await readNov12Snapshot({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
    })));
  }catch(e){
    const code=String(e?.message||'CLOSE_DATE_UNKNOWN');
    console.error(/^CLOSE_DATE_[A-Z_]+$/.test(code)?code:'CLOSE_DATE_UNKNOWN');
    process.exitCode=1;
  }
}
