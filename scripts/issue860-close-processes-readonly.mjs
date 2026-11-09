#!/usr/bin/env node
// #860: ONE-SHOT, Google Apps Script processes.listScriptProcesses GET audit.
// No production script execution, deployment, Properties, Sheets or data writes.
// Only non-sensitive execution status/duration and KST time are emitted.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';

const PROCESS_URL='https://script.googleapis.com/v1/processes:listScriptProcesses';
const FROM='2026-11-09T10:25:00Z'; // 19:25 KST
const UNTIL='2026-11-09T12:15:00Z'; // 21:15 KST
const ACTIONS=new Map([
 ['runDailyPortfolioClose1900','REGULAR_CLOSE'],
 ['runPortfolioCloseWatchdog2030','WATCHDOG'],
 ['runDeferredFundAfterPortfolioCloseFailure','FUND_DEFERRED']
]);
const STATUSES=new Set(['RUNNING','PAUSED','COMPLETED','CANCELED','FAILED','TIMED_OUT','UNKNOWN','DELAYED','EXECUTION_DISABLED']);
const TYPES=new Set(['TIME_DRIVEN','TRIGGER','EDITOR','WEBAPP','EXECUTION_API','UNKNOWN']);
const SCRIPT_ID=/^[A-Za-z0-9_-]{16,160}$/;
function fail(reason){throw Error('ISSUE860_PROCESSES_'+reason);}
function normalizeTime(raw) {
 const ms=Date.parse(String(raw||''));
 if(!Number.isFinite(ms)||ms<Date.parse(FROM)||ms>Date.parse(UNTIL))fail('TIME_SCHEMA');
 return new Date(ms).toISOString().slice(11,19); // UTC, not personal data
}
function toKst(raw) {
 const time=new Date(raw).getTime()+9*3600000;
 return new Date(time).toISOString().slice(11,19);
}
function durationSeconds(raw) {
 const x=String(raw??'').match(/^(?:\d{1,6})(?:\.\d{1,9})?s$/);
 if(!x)fail('DURATION_SCHEMA');
 const n=Number(raw.slice(0,-1));
 if(!Number.isFinite(n)||n>86400)fail('DURATION_SCHEMA');
 return Math.round(n*1000)/1000;
}
export function summarizeProcessPage(payload) {
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
   fail('SCHEMA');
 // Google omits an empty repeated field in some JSON responses. Zero rows
 // is not evidence that a known trigger completed successfully.
 const processes=payload.processes===undefined?[]:payload.processes;
 if(!Array.isArray(processes)||processes.length>100)fail('SCHEMA');
 const out=[];
 for(const entry of processes) {
  if(!entry||typeof entry!=='object')fail('PROCESS_SCHEMA');
  const alias=ACTIONS.get(entry.functionName);
  if(!alias)continue;
  const start=normalizeTime(entry.startTime);
  const status=STATUSES.has(entry.processStatus)?entry.processStatus:'UNKNOWN';
  const type=TYPES.has(entry.processType)?entry.processType:'UNKNOWN';
  out.push({kind:alias,startKst:toKst(entry.startTime),durationSec:durationSeconds(entry.duration),
   status,type});
 }
 if(payload.nextPageToken!==undefined&&
   (typeof payload.nextPageToken!=='string'||payload.nextPageToken.length>512))
  fail('PAGE_TOKEN_SCHEMA');
 return {rows:out,nextToken:payload.nextPageToken||''};
}
export async function inspectProcesses({scriptId,token,fetchImpl=fetch}={}) {
 if(!SCRIPT_ID.test(String(scriptId||''))||typeof token!=='string'||token.length<20)
  fail('CREDENTIALS_REQUIRED');
 let next='',requestCount=0,found=[],complete=false;
 const seen=new Set();
 for(let page=0;page<3;page++){
  const url=new URL(PROCESS_URL);
  url.searchParams.set('scriptId',scriptId);
  url.searchParams.set('scriptProcessFilter.startTime',FROM);
  url.searchParams.set('scriptProcessFilter.endTime',UNTIL);
  url.searchParams.set('pageSize','100');
  if(next)url.searchParams.set('pageToken',next);
  let response;
  try{
   response=await fetchImpl(url.toString(),{
    method:'GET',headers:{Authorization:'Bearer '+token},
    redirect:'error',signal:AbortSignal.timeout(20000)
   });
  }catch(e){
   if(e?.name==='AbortError'||e?.name==='TimeoutError')fail('TIMEOUT');
   fail('NETWORK');
  }
  requestCount++;
  if(response?.status===401||response?.status===403)fail('SCOPE_OR_PERMISSION');
  if(!response?.ok)fail('HTTP');
  let raw;
  try{raw=await response.text();}catch{fail('BODY');}
  if(typeof raw!=='string'||raw.length>350000)fail('BODY');
  let payload;
  try{payload=JSON.parse(raw);}catch{fail('JSON');}
  const summary=summarizeProcessPage(payload);
  found.push(...summary.rows);
  next=summary.nextToken;
  if(!next){complete=true;break;}
  if(seen.has(next))fail('PAGINATION');
  seen.add(next);
 }
 if(!complete)fail('PAGINATION');
 found.sort((a,b)=>a.startKst.localeCompare(b.startKst)||a.kind.localeCompare(b.kind));
 const first=found.filter(p=>p.kind==='REGULAR_CLOSE'&&p.startKst>='19:25:00'&&p.startKst<='19:45:00');
 const watchdog=found.filter(p=>p.kind==='WATCHDOG'&&p.startKst>='20:20:00'&&p.startKst<='20:50:00');
 return {kind:'ISSUE860_NOV09_PROCESSES_GET_ONLY',dateKst:'2026-11-09',
  auditWindowKst:'19:25-21:15',completePagination:true,requestCount,
  firstCloseObserved:first.length>0,firstCloseStatuses:first.map(p=>p.status),
  watchdogObserved:watchdog.length>0,watchdogStatuses:watchdog.map(p=>p.status),
  resultCount:found.length,executions:found,
  // Process metadata cannot prove execution UID/stack, Script Properties lease
  // ownership, backup registration or business-data correctness.
  stackVerified:false,ownerUidVerified:false,backupOwnerVerified:false,
  productionWrites:0,gasDeployments:0,financeWrites:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  console.log(JSON.stringify(await inspectProcesses({scriptId:process.env.GAS_SCRIPT_ID,token})));
 }catch(e){
  const code=String(e?.message||'');
  console.error(/^ISSUE860_PROCESSES_[A-Z_]+$/.test(code)?code:'ISSUE860_PROCESSES_UNVERIFIED');
  process.exitCode=2;
 }
}
