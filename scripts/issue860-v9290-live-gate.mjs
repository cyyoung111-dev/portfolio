#!/usr/bin/env node
// #860 / v9.290: pre-publication *read-only* proof using the deployed 9.289
// web-app, never cached GitHub status, never financial- or GAS-writes.
// Authenticated close status, independent trade-v2 ledger, RAW Snapshot
// integrity when needed, and writer-idle read LAST. Incomplete daily-close
// metadata is not financial corruption and is never promoted to COMPLETE.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {summarizeCloseStatus} from './diagnose-backfill-status.mjs';
import {assertReleaseSnapshotProof} from './issue860-release-snapshot-proof.mjs';

const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const fail=code=>{throw Error('ISSUE860_9290_GATE_'+code);};
async function post(url,token,action,fetchImpl,args={}) {
 let response;
 try{response=await fetchImpl(url,{method:'POST',redirect:'follow',
  headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
  body:new URLSearchParams({action,...args,accessToken:token}),
  signal:AbortSignal.timeout(action==='diagnoseSnapshotIntegrity'?240000:45000)});}catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 try{const body=await response.json();if(body?.status!=='ok')fail('RESPONSE_UNVERIFIED');return body;}
 catch(e){if(/^ISSUE860_9290_GATE_/.test(String(e?.message||'')))throw e;fail('JSON_UNVERIFIED');}
}
async function getGate(url,token,fetchImpl) {
 let endpoint;
 try{endpoint=new URL(url);endpoint.searchParams.set('action','getWriterGateStatus');
 endpoint.searchParams.set('accessToken',token);}catch{fail('ENDPOINT_UNVERIFIED');}
 let r;
 try{r=await fetchImpl(endpoint.toString(),{method:'GET',redirect:'follow',
  signal:AbortSignal.timeout(30000)});}catch{fail('GATE_NETWORK_OR_TIMEOUT');}
 if(r?.ok!==true)fail('GATE_HTTP_UNVERIFIED');
 try{let p=await r.json();if(p?.status!=='ok')fail('GATE_RESPONSE_UNVERIFIED');return p;}
 catch(e){if(/^ISSUE860_9290_GATE_/.test(String(e?.message||'')))throw e;fail('GATE_JSON_UNVERIFIED');}
}
export async function verifyIssue8609290LiveGate({
 url,token,fetchImpl=fetch,now=new Date()
}={}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const status=await post(endpoint,token,'getAutomationStatus',fetchImpl);
 const a=status.automation;
 if(status.gasVersion!=='9.289'||a?.gasVersion!=='9.289')fail('PUBLISHED_9289_UNVERIFIED');
 const close=summarizeCloseStatus(a);
 const settled=close.state==='COMPLETE'&&close.stage==='COMPLETE'&&
   close.priceOk===true&&close.fundOk===true&&
   close.fundState==='DONE'&&close.runDate===close.fundAttemptDate;
 // A timed-out PRICE producer may already have persisted valid raw prices
 // and Snapshot. This is never COMPLETE; only allow repair-release after
 // independently re-deriving exact-date Snapshot and source integrity.
 const recoverable=close.state==='INCOMPLETE'&&close.stage==='PRICE'&&
   a.overallStatus==='INCOMPLETE'&&close.fundErrorPresent===false&&
   close.fundWarningPresent===false&&
   DATE.test(close.fundAttemptDate)&&close.fundAttemptDate<close.runDate;
 if(!settled&&!recoverable)fail('CLOSE_NOT_SETTLED');
 const date=close.runDate;
 const liveNow=now instanceof Date?now:new Date(now);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(liveNow);
 if(!DATE.test(date)||!DATE.test(today)||
   Math.abs((Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000)>4)
  fail('CLOSE_DATE_STALE');
 // A successful close may coexist with later transaction edits that have
 // queued a recomputation. Such status must never promote a stale Snapshot.
 // Revision/queue/Writer protections apply to BOTH complete and repair paths.
 // The repair path does not trust the previous day's portfolioClose summary.
 if(a.snapshotLastDate!==date||a.priceHistoryLastDate!==date||
  a.snapshotStale!==false||a.tradeLedgerWriteUnverified!==false||
  a.pendingTradeSnapshotRebuildFrom!==''||
  a.tradeSnapshotDeferredCount!==0||
  !Array.isArray(a.pendingKrxCloseDates)||a.pendingKrxCloseDates.length!==0)
  fail('DATA_NOT_SETTLED');
 if(settled&&(a.overallStatus!=='NORMAL'||close.summaryRunDate!==date||
    close.closeErrorCount!==0||close.closeErrorPresent||
    close.runStale!==false||a.portfolioClose?.priceDate!==date))
  fail('DATA_NOT_SETTLED');
 if(recoverable&&a.expectedSnapshotDate!==date)
  fail('DATA_NOT_SETTLED');
 const data=await post(endpoint,token,'getTrades',fetchImpl);
 if(data.tradeLedgerProtocolVersion!==2||
   typeof data.ledgerRevision!=='string'||!/^[a-f0-9]{64}$/.test(data.ledgerRevision)||
   !Array.isArray(data.trades)||data.trades.length<1||data.trades.length>5000)
  fail('TRADE_LEDGER_UNVERIFIED');
 const ids=new Set();
 for(const r of data.trades) {
  if(!r||typeof r!=='object'||Array.isArray(r)||
    typeof r.id!=='string'||!ID.test(r.id)||ids.has(r.id))
   fail('TRADE_ID_UNVERIFIED');
  ids.add(r.id);
 }
 let proof=null;
 if(recoverable) {
  // Slow full RAW duplicate/ledger/NAV/FX audit only on incomplete CLOSE.
  // A network/timeout or source-data issue blocks the deployment. This
  // read-only request cannot create the missing PRICE_DONE receipt.
  const raw=await post(endpoint,token,'diagnoseSnapshotIntegrity',fetchImpl,{date});
  try{proof=assertReleaseSnapshotProof(raw,date);}
  catch{fail('SNAPSHOT_NOT_VERIFIED');}
 }
 const gate=await getGate(endpoint,token,fetchImpl);
 if(gate.gasVersion!=='9.289'||gate.writerGate?.mode!=='OPEN'||
   gate.writerGate.activeCount!==0||gate.writerGate.repairAuthorized!==false)
  fail('WRITER_GATE_NOT_IDLE');
 return {kind:'ISSUE860_9290_LIVE_PREDEPLOY_GATE',status:'VERIFIED',
   publishedVersion:'9.289',closeRunDate:date,closeState:close.state,
   releaseSafety:settled?'SETTLED':'REPAIR_WITH_INDEPENDENT_RAW_SNAPSHOT_PROOF',
   closeFinality:settled?'COMPLETE':'INCOMPLETE',
   fundFinality:settled?'COMPLETE':'PENDING_UNVERIFIED',
   snapshotAudit:proof?{date:proof.auditedDate,storedRows:proof.storedRows,
     priceIntegrityRows:proof.priceIntegrityRows,carryRows:proof.fundCarryRows}:null,
   writerGate:'OPEN',recordedActive:0,tradeProtocol:2,tradeRows:ids.size,
   callCount:proof?4:3,executionOwnerProof:false,
   financialWrites:0,gasDeployments:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const r=await verifyIssue8609290LiveGate({url:process.env.GAS_WEB_APP_URL,
    token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(r));
  if(process.env.GITHUB_OUTPUT) {
   const fs=await import('node:fs');
   fs.appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
  }
 }catch(e){
  const m=String(e?.message||'');
  console.error(/^ISSUE860_9290_GATE_[A-Z0-9_]+$/.test(m)?m:'ISSUE860_9290_GATE_UNVERIFIED');
  process.exitCode=1;
 }
}
