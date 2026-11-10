#!/usr/bin/env node
// #734: Evidence-only audit for the 14 gate entries observed on 2026-11-10.
// No Script Properties, Sheets, GAS source, triggers, or deployments are changed.
// A process time/name match is NEVER a gate token's terminal receipt.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';

const ENDPOINT='https://script.googleapis.com/v1/processes:listScriptProcesses';
const FROM='2026-11-04T15:00:00Z';
const MAX_PAGES=20;
const TERMINAL=new Set(['COMPLETED','CANCELED','FAILED','TIMED_OUT','EXECUTION_DISABLED']);
const STATUSES=new Set([...TERMINAL,'RUNNING','PAUSED','DELAYED','UNKNOWN']);
const SCRIPT_ID=/^[A-Za-z0-9_-]{16,160}$/;
const TOLERANCE_MS=60000;

// Names and times only; intentionally no private receipt tokens or workbook IDs.
// Dates are the operator-observed gate snapshots, NOT proof of current execution.
export const TARGETS=Object.freeze([
 ['runPortfolioCloseWatchdog2030',1793878621446],
 ['runPortfolioHistoricalBackfill2240',1793887899970],
 ['runDeferredFundAfterPortfolioCloseFailure',1793962991701],
 ['runPortfolioCloseWatchdog2030',1793965021119],
 ['runDeferredFundAfterPortfolioCloseFailure',1794048066387],
 ['runDeferredFundAfterPortfolioCloseFailure',1794048668004],
 ['runDeferredFundAfterPortfolioCloseFailure',1794049281583],
 ['runPortfolioCloseWatchdog2030',1794051422193],
 ['runDeferredFundAfterPortfolioCloseFailure',1794138087299],
 ['runDailyPortfolioClose1900',1794220392853],
 ['runDeferredFundAfterPortfolioCloseFailure',1794224980455],
 ['_tradeV2MigrationManual_',1794273416321],
 ['_tradeV2MigrationManual_',1794273527135],
 ['_tradeV2MigrationManual_',1794275129121]
].map(([name,startedAt])=>Object.freeze({name,startedAt})));

const queryName=name=>name==='_tradeV2MigrationManual_'?'runTradeV2MigrationPreflight':name;
const kst=ms=>new Date(ms+9*3600000).toISOString().slice(0,19)+'+09:00';
function fail(code){throw Error('ISSUE734_WRITER_AUDIT_'+code);}

export function reconcileObservedProcesses(targets,processes) {
 if(!Array.isArray(targets)||!Array.isArray(processes))fail('INPUT');
 const results=[];
 for(const target of targets) {
  const expected=queryName(target.name);
  if(typeof expected!=='string'||!Number.isFinite(target.startedAt))fail('TARGET');
  const matches=processes.filter(p=>p.name===expected&&
    Math.abs(p.startedAt-target.startedAt)<=TOLERANCE_MS);
  // One observed matching process cannot provide a per-token completion receipt.
  const evidence=matches.length===1?
    (TERMINAL.has(matches[0].status)?'TERMINAL_PROCESS_CANDIDATE':'NONTERMINAL_PROCESS_CANDIDATE'):
    matches.length===0?'NOT_OBSERVED':'AMBIGUOUS';
  results.push({name:target.name,gateStartedKst:kst(target.startedAt),
   evidence,processStatus:matches.length===1?matches[0].status:null});
 }
 return {kind:'ISSUE734_WRITER_TERMINAL_EVIDENCE_ONLY',
  targetCount:results.length,
  terminalCandidates:results.filter(r=>r.evidence==='TERMINAL_PROCESS_CANDIDATE').length,
  unresolvedCount:results.filter(r=>r.evidence!=='TERMINAL_PROCESS_CANDIDATE').length,
  results,exactGateOwnerUidVerified:false,executionOwnerVerified:false,
  externalWriterExcludedVerified:false,activeCleanupAuthorized:false,
  migrationApproved:false,productionWrites:0,financeWrites:0,gasDeployments:0};
}

export async function inspectWriterProcesses({scriptId,token,fetchImpl=fetch,targets=TARGETS}={}) {
 if(!SCRIPT_ID.test(String(scriptId||''))||typeof token!=='string'||token.length<20)fail('CREDENTIALS');
 const names=[...new Set(targets.map(x=>queryName(x.name)))],processes=[];
 for(const name of names) {
  let next='',complete=false;
  const seen=new Set();
  for(let page=0;page<MAX_PAGES;page++) {
   const url=new URL(ENDPOINT);
   url.searchParams.set('scriptId',scriptId);
   url.searchParams.set('scriptProcessFilter.startTime',FROM);
   url.searchParams.set('scriptProcessFilter.functionName',name);
   url.searchParams.set('pageSize','100');
   if(next)url.searchParams.set('pageToken',next);
   let response;
   try{response=await fetchImpl(url.toString(),{
    method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)
   });}catch{fail('NETWORK_OR_TIMEOUT');}
   if(response?.status===401||response?.status===403)fail('SCOPE_OR_PERMISSION');
   if(response?.ok!==true)fail('HTTP');
   let payload;
   try{payload=await response.json();}catch{fail('JSON');}
   if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     (payload.processes!==undefined&&!Array.isArray(payload.processes))||
     (payload.processes||[]).length>100)fail('PAGE_SCHEMA');
   for(const p of payload.processes||[]) {
    if(!p||p.functionName!==name||typeof p.startTime!=='string')fail('PROCESS_SCHEMA');
    const at=Date.parse(p.startTime);
    if(!Number.isFinite(at)||at<Date.parse(FROM)||at>Date.now()+60000)fail('TIME');
    if(!STATUSES.has(p.processStatus))fail('STATUS');
    processes.push({name,startedAt:at,status:p.processStatus});
   }
   next=payload.nextPageToken||'';
   if(!next){complete=true;break;}
   if(typeof next!=='string'||next.length>512||seen.has(next))fail('PAGE_TOKEN');
   seen.add(next);
  }
  if(!complete)fail('PAGINATION_INCOMPLETE');
 }
 const result=reconcileObservedProcesses(targets,processes);
 return {...result,processApiPaginationComplete:true,readOnlyGetRequests:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try{
  const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  console.log(JSON.stringify(await inspectWriterProcesses({
   scriptId:process.env.GAS_SCRIPT_ID,token
  })));
 }catch(e){
  const msg=String(e?.message||'');
  console.error(/^ISSUE734_WRITER_AUDIT_[A-Z_]+$/.test(msg)?
   msg:'ISSUE734_WRITER_AUDIT_UNVERIFIED');
  process.exitCode=2;
 }
}
