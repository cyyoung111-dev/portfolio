#!/usr/bin/env node
// Read-only operational proof for KRX K200 night. Never print KRX rows,
// prices, contract labels, access tokens, deployment URLs or responses.
import {parseDates, validateWebAppUrl} from './diagnose-krx-operational.mjs';

const STAT_KEYS=[
  'totalRows','nightMarketRows','exactDateRows','exactDateNightRows',
  'exactNightProductRows','exactProductLabelVariants','validExpiryRows',
  'unexpiredExpiryRows','positiveCloseRows','nearestExpiryRows'
];
const PARSE=new Set(['NOT_FETCHED','FETCH_FAILED','ALTERNATIVE_FETCH_FAILED',
  'HTTP_DENIED_OR_UNAVAILABLE','NON_JSON','UNEXPECTED_SCHEMA','EMPTY','ROWS']);
const SOURCES=new Set(['NONE','PRIMARY','ALTERNATIVE']);
function validHttp(v){return Number.isInteger(v)&&v>=0&&v<=599;}

async function readOnlyAction(url,action,date,token,fetchImpl){
  if(!['getSettings','getKrxK200NightDiagnostics','getKrxK200NightClose'].includes(action))
    throw new Error('NIGHT_DIAG_FORBIDDEN_ACTION');
  const body=new URLSearchParams({action,accessToken:token});
  if(date)body.set('date',date);
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(30000)});
  }catch{throw new Error('NIGHT_DIAG_GAS_FETCH_FAILED');}
  if(!response.ok)throw new Error('NIGHT_DIAG_GAS_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('NIGHT_DIAG_GAS_NON_JSON');}
}

export function summarizeK200Diagnostic(resp,date){
  const d=resp?.diagnostic;
  if(resp?.status!=='ok'||!d||d.requestedDate!==date||d.mode!=='READ_ONLY'||
    typeof d.keyConfigured!=='boolean'||typeof d.alternativeConfigured!=='boolean'||
    typeof d.beforeNightFinalCutoff!=='boolean'||
    !SOURCES.has(d.source)||!PARSE.has(d.parseStatus)||
    !validHttp(d.primaryHttpStatus)||!validHttp(d.alternativeHttpStatus))
    throw new Error('NIGHT_DIAG_INVALID_RESPONSE');
  const stats={};
  if(d.stats!=null){
    if(d.parseStatus!=='ROWS'&&d.parseStatus!=='EMPTY')throw new Error('NIGHT_DIAG_INVALID_STATS');
    for(const key of STAT_KEYS){
      if(!Number.isSafeInteger(d.stats[key])||d.stats[key]<0)
        throw new Error('NIGHT_DIAG_INVALID_STATS');
      stats[key]=d.stats[key];
    }
    if(typeof d.stats.wouldSelect!=='boolean'
       ||stats.exactDateNightRows>stats.exactDateRows
       ||stats.exactNightProductRows>stats.exactDateNightRows
       ||stats.validExpiryRows>stats.exactNightProductRows
       ||stats.unexpiredExpiryRows>stats.validExpiryRows
       ||stats.positiveCloseRows>stats.unexpiredExpiryRows
       ||stats.nearestExpiryRows>stats.positiveCloseRows)
       throw new Error('NIGHT_DIAG_INVALID_STATS');
    stats.wouldSelect=d.stats.wouldSelect;
  }else if(d.parseStatus==='ROWS'||d.parseStatus==='EMPTY'){
    throw new Error('NIGHT_DIAG_INVALID_STATS');
  }
  return {date,keyConfigured:d.keyConfigured,alternativeConfigured:d.alternativeConfigured,
    source:d.source,primaryHttpStatus:d.primaryHttpStatus,
    alternativeHttpStatus:d.alternativeHttpStatus,parseStatus:d.parseStatus,
    beforeNightFinalCutoff:d.beforeNightFinalCutoff,stats};
}
export function summarizeNightFinal(resp,date){
  const v=resp?.observation;
  if(resp?.status!=='ok'||(v!==null && (typeof v!=='object'||Array.isArray(v))))
    throw new Error('NIGHT_FINAL_INVALID_RESPONSE');
  return {date,officialNightFinal:!!v &&
    v.seriesId==='K200_NIGHT'&&v.tradingDate===date&&v.sourceDate===date
    &&v.source==='KRX_OFFICIAL'&&v.market==='KRX'&&v.session==='NIGHT'
    &&v.status==='FINAL'&&v.finality==='NIGHT_FINAL'&&v.fallback===false
    &&Number.isFinite(Number(v.value))&&Number(v.value)>0};
}
export async function runNightDiagnosis({url,token,dates,fetchImpl=fetch}){
  const validDates=parseDates(dates),endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('NIGHT_DIAG_AUTH_NOT_CONFIGURED');
  const settings=await readOnlyAction(endpoint,'getSettings','',token,fetchImpl);
  if(settings?.status!=='ok'||settings.gasVersion!=='9.221'
    ||settings.settings?.apiKeyStatus?.requestAuthenticationEnabled!==true)
    throw new Error('NIGHT_DIAG_GAS_VERSION_OR_AUTH_UNVERIFIED');
  const results=[];
  for(const date of validDates){
    try{
      const diag=summarizeK200Diagnostic(
        await readOnlyAction(endpoint,'getKrxK200NightDiagnostics',date,token,fetchImpl),date);
      const final=summarizeNightFinal(
        await readOnlyAction(endpoint,'getKrxK200NightClose',date,token,fetchImpl),date);
      results.push({...diag,...final});
    }catch(e){
      results.push({date,diagnosticError:'READ_ONLY_REQUEST_UNAVAILABLE',
        officialNightFinal:false});
    }
  }
  return {mode:'READ_ONLY',gasVersion:settings.gasVersion,results};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const pos=process.argv.indexOf('--dates');
    const dates=pos>=0?process.argv[pos+1]:'2026-10-13,2026-10-14';
    const report=await runNightDiagnosis({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,dates
    });
    console.log(JSON.stringify(report));
    if(report.results.some(r=>r.diagnosticError))process.exitCode=1;
  }catch(e){
    const allowed=new Set(['NIGHT_DIAG_AUTH_NOT_CONFIGURED',
      'NIGHT_DIAG_GAS_VERSION_OR_AUTH_UNVERIFIED']);
    console.error(allowed.has(e.message)?e.message:'NIGHT_DIAG_REQUEST_FAILED');
    process.exitCode=1;
  }
}
