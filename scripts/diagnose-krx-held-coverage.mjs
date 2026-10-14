#!/usr/bin/env node
// Read-only, aggregate-only official source inspection of every held KRX code.
import {parseDates,validateWebAppUrl} from './diagnose-krx-operational.mjs';
const PROBE='KRX_HELD_AUTH_PROBE_20261014';
async function read(endpoint,date,token,fetchImpl){
  const body=new URLSearchParams({
    action:'getKrxHeldCloseCoverage',date,accessToken:token
  });
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body,redirect:'follow',signal:AbortSignal.timeout(45000)});
  }catch{throw new Error('KRX_HELD_DIAG_NETWORK_FAILED');}
  if(!response.ok)throw new Error('KRX_HELD_DIAG_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('KRX_HELD_DIAG_JSON_FAILED');}
}
export function summarizeHeldCoverage(payload,date){
  const d=payload?.coverage;
  if(payload?.status!=='ok'||!d||d.requestedDate!==date||d.mode!=='READ_ONLY')
    throw new Error('KRX_HELD_DIAG_BAD_RESPONSE');
  const ints=['expectedHeldCodes','officialExactDateCodes','missingCodes',
    'staleCodes','duplicateMasterCodes','orphanLedgerCodes'];
  for(const field of ints)if(!Number.isSafeInteger(d[field])||d[field]<0)
    throw new Error('KRX_HELD_DIAG_BAD_COUNTS');
  const market={};
  for(const group of ['STOCK','ETF']){
    const m=d.market?.[group];
    if(!m||!Number.isSafeInteger(m.expected)||m.expected<0
      ||!Number.isSafeInteger(m.confirmed)||m.confirmed<0||m.confirmed>m.expected)
      throw new Error('KRX_HELD_DIAG_BAD_MARKETS');
    market[group]={expected:m.expected,confirmed:m.confirmed};
  }
  if(d.expectedHeldCodes!==market.STOCK.expected+market.ETF.expected
    ||d.officialExactDateCodes!==market.STOCK.confirmed+market.ETF.confirmed
    ||d.missingCodes!==d.expectedHeldCodes-d.officialExactDateCodes
    ||d.staleCodes>d.missingCodes||typeof d.ready!=='boolean')
    throw new Error('KRX_HELD_DIAG_INCONSISTENT');
  const ready=d.ready&&d.expectedHeldCodes===37
    &&d.missingCodes===0&&d.duplicateMasterCodes===0&&d.orphanLedgerCodes===0;
  return {date,expected:d.expectedHeldCodes,exact:d.officialExactDateCodes,
    missing:d.missingCodes,stale:d.staleCodes,duplicateMaster:d.duplicateMasterCodes,
    orphanLedger:d.orphanLedgerCodes,market,ready};
}
export async function runCoverage({url,token,dates,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url),requested=parseDates(dates);
  if(!token||typeof token!=='string')throw new Error('KRX_HELD_DIAG_TOKEN_MISSING');
  const wrong=token===PROBE?PROBE+'_ALT':PROBE;
  const denied=await read(endpoint,requested[0],wrong,fetchImpl);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw new Error('KRX_HELD_DIAG_AUTH_DISABLED');
  const results=[];
  for(const date of requested){
    try {results.push(summarizeHeldCoverage(await read(endpoint,date,token,fetchImpl),date));}
    catch {results.push({date,ready:false,errorCode:'KRX_HELD_DIAG_DATE_FAILED'}); }
  }
  return {mode:'READ_ONLY',coverageContract:'KRX_HELD_V1',
    results,ready:results.every(x=>x.ready)};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const p=process.argv.indexOf('--dates'),dates=p>=0?process.argv[p+1]:'2026-10-12,2026-10-13';
  const report=await runCoverage({
    url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,dates
  });
  console.log(JSON.stringify(report));
  if(!report.ready)process.exitCode=1;
 }catch(e){
  console.error(/^KRX_HELD_DIAG_[A-Z_]+$/.test(String(e?.message||''))
    ?e.message:'KRX_HELD_DIAG_UNEXPECTED');
  process.exitCode=1;
 }
}
