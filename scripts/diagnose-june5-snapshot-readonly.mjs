#!/usr/bin/env node
// #507: authenticated, one-date, READ_ONLY operational Snapshot diagnosis.
// Never print raw GAS responses, financial rows, secret tokens or URLs.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const TARGET_DATE='2026-06-05';
const ACTION='diagnoseSnapshotIntegrityRange';
const STATUS=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
  'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const DUPLICATES=['groups','exactDuplicate','singleExpectedMatch',
  'manualProtected','unresolvedConflict','sourceIncomplete'];
const ARRAYS={
  missingCodeCount:'missingCodes',unexpectedCodeCount:'unexpectedCodes',
  duplicateKeyCount:'duplicateKeys',qtyMismatchCount:'qtyMismatches',
  costMismatchCount:'costAmtMismatches',
  evalUnitMismatchCount:'evalUnitMismatches',
  evalAmountMismatchCount:'evalAmtMismatches',
  sourceMismatchCount:'sourceMismatches',
  sourceDataErrorCount:'sourceDataErrors'
};
const boundedNumber=(value)=>{
  if(!Number.isSafeInteger(value)||value<0)throw new Error('JUNE5_INVALID_COUNTS');
  return value;
};
const count=(value)=>{
  if(!Array.isArray(value))throw new Error('JUNE5_INVALID_ARRAYS');
  return value.length;
};

export function summarizeJune5Proof(payload){
  if(payload?.status==='error'){
    const allowed=new Set(['RANGE_TOO_LARGE','SOURCE_DATA_ERROR','RUNTIME_ERROR']);
    return {mode:'READ_ONLY',date:TARGET_DATE,diagnosisComplete:false,
      errorCode:allowed.has(payload.errorCode)?payload.errorCode:'GAS_UNKNOWN_ERROR'};
  }
  if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)
    ||payload.checkedDates.length!==1||payload.checkedDates[0]!==TARGET_DATE
    ||!Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1)
    throw new Error('JUNE5_INVALID_RESPONSE');
  const x=payload.diagnostics[0];
  if(x?.date!==TARGET_DATE||!STATUS.has(x.status))
    throw new Error('JUNE5_INVALID_DATE_OR_STATUS');
  const expectedRows=boundedNumber(x.expectedRowCount);
  const storedRows=boundedNumber(x.storedRowCount);
  const duplicates={};
  for(const name of DUPLICATES)duplicates[name]=boundedNumber(x.duplicateSummary?.[name]);
  const issues={};
  for(const [name,raw] of Object.entries(ARRAYS))issues[name]=count(x[raw]);
  const fundNavStateCount=count(x.fundNavStates);
  // Do not assume September's 39-code / 2-fund shape also applies in June.
  const uniqueFundCodes=new Set(x.fundNavStates.map(s=>s?.code));
  const exactFundNav=fundNavStateCount>0&&uniqueFundCodes.size===fundNavStateCount
    &&x.fundNavStates.every(s=>typeof s?.code==='string'
      &&s.code.startsWith('F')&&s.source==='FUND_NAV'
      &&s.sourceDate===TARGET_DATE&&s.temporary===false);
  const healthy=x.status==='VALID'&&expectedRows>0&&storedRows===expectedRows
    &&duplicates.groups===0&&duplicates.manualProtected===0
    &&duplicates.unresolvedConflict===0&&duplicates.sourceIncomplete===0
    &&Object.values(issues).every(n=>n===0)&&exactFundNav;
  return {mode:'READ_ONLY',date:TARGET_DATE,diagnosisComplete:true,
    status:x.status,expectedRows,storedRows,duplicates,issues,
    fundNavStateCount,exactFundNav,healthy};
}

async function read(endpoint,token,fetchImpl){
  let response;
  try{
    response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:ACTION,dates:TARGET_DATE,accessToken:token}),
      redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw new Error('JUNE5_NETWORK_FAILED');}
  if(!response.ok)throw new Error('JUNE5_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('JUNE5_NON_JSON');}
}
export async function verifyJune5({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('JUNE5_TOKEN_MISSING');
  const invalid=token==='JUNE5_NEGATIVE_PROBE'
    ?'JUNE5_NEGATIVE_PROBE_ALT':'JUNE5_NEGATIVE_PROBE';
  const denied=await read(endpoint,invalid,fetchImpl);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw new Error('JUNE5_AUTH_NOT_ENFORCED');
  return summarizeJune5Proof(await read(endpoint,token,fetchImpl));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await verifyJune5({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(result));
    // A valid diagnosis of corrupted historical data is a successful READ operation.
    // Only transport, auth or response-contract failures make this job fail.
    if(!result.diagnosisComplete)process.exitCode=1;
  }catch(error){
    const code=String(error?.message||'');
    console.error(/^JUNE5_[A-Z_]+$/.test(code)?code:'JUNE5_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
