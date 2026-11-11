#!/usr/bin/env node
// #860: exactly one authenticated production GAS status read.
// Reviewed published releases include 9.291; unreviewed 9.290/9.292 remain blocked.
// No workbook inventory, retry, finance write, deployment or raw response logging.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {summarizeCloseStatus,safeFundResumeCheckpoint} from './diagnose-backfill-status.mjs';

export async function readIssue860Once({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)
  throw Error('ISSUE860_STATUS_AUTH_MISSING');
 let response;
 try{
  response=await fetchImpl(endpoint,{
   method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action:'getAutomationStatus',accessToken:token}),
   signal:AbortSignal.timeout(90000)
  });
 }catch(error){
  const kind=error?.name==='AbortError'||error?.name==='TimeoutError'
   ?'TIMEOUT':'NETWORK';
  throw Error('ISSUE860_STATUS_'+kind);
 }
 if(!response||response.ok!==true)throw Error('ISSUE860_STATUS_HTTP');
 let payload;
 try{payload=await response.json();}
 catch{throw Error('ISSUE860_STATUS_JSON');}
 const a=payload?.automation;
 if(payload?.status!=='ok'||!a||typeof a!=='object'
    ||!['9.284','9.287','9.288','9.289','9.291'].includes(payload.gasVersion)
    ||a.gasVersion!==payload.gasVersion)
  throw Error('ISSUE860_STATUS_VERSION_OR_SCHEMA');
 let close,checkpoint;
 try{
  close=summarizeCloseStatus(a);
  checkpoint=safeFundResumeCheckpoint(a.fundResumeCheckpoint);
 }catch{throw Error('ISSUE860_STATUS_SCHEMA');}
 const cleanDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))
  ?String(value):'UNVERIFIED';
 const rows=Number(a.portfolioClose?.priceRows);
 const priceRows=Number.isSafeInteger(rows)&&rows>=0&&rows<=500?rows:null;
 const cleanOverall=['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN']
  .includes(a.overallStatus)?a.overallStatus:'UNVERIFIED';
 return {
  kind:'ISSUE860_SINGLE_GAS_STATUS_READONLY',
  gasVersion:payload.gasVersion,
  observedKstDate:cleanDate(a.checkedAt?.slice(0,10)),
  overallStatus:cleanOverall,
  storedPriceRows:priceRows,
  storedPriceDate:cleanDate(a.portfolioClose?.priceDate),
  snapshotLastDate:cleanDate(a.snapshotLastDate),
  priceHistoryLastDate:cleanDate(a.priceHistoryLastDate),
  expectedSnapshotDate:cleanDate(a.expectedSnapshotDate),
  snapshotStale:a.snapshotStale===true?true:a.snapshotStale===false?false:null,
  fundErrorPresent:!!a.fundLastError,
  fundWarningPresent:!!a.fundLastWarning,
  pendingKrxDatesCount:Array.isArray(a.pendingKrxCloseDates)
    ?a.pendingKrxCloseDates.length:null,
  closeState:close.state,closeStage:close.stage,closeRunDate:close.runDate,
  priceOk:close.priceOk,fundOk:close.fundOk,
  fundAttemptState:close.fundState,fundAttemptDate:close.fundAttemptDate,
  fundFailureClass:close.fundErrorCode,
  fundWorkStage:checkpoint?.lastWorkStage||'UNVERIFIED',
  fundResumeCheckpointPresent:Boolean(checkpoint),
  closeComplete:close.state==='COMPLETE'&&close.priceOk===true&&close.fundOk===true,
  processExecutionOwnerVerified:false,
  backupRegistryOwnerVerified:false,
  observedFrom:'PERSISTED_GAS_STATUS_NOT_EXECUTION_LOG',
  productionGasDeployed:false,financialWrites:0,
  backupDeletes:0,telegramSends:0,requestCount:1
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  console.log(JSON.stringify(await readIssue860Once({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  })));
 }catch(e){
  const c=String(e?.message||'ISSUE860_STATUS_UNVERIFIED');
  console.error(/^ISSUE860_STATUS_[A-Z_]+$/.test(c)?c:'ISSUE860_STATUS_UNVERIFIED');
  process.exitCode=1;
 }
}
