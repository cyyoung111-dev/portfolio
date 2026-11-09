#!/usr/bin/env node
// #734: bounded, authenticated read-only preflight BEFORE any manual 9.288
// production publish. It is not a lease, writer exclusion proof or release
// approval. Exactly one status and one trade read; no raw finance data logging.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {summarizeCloseStatus} from './diagnose-backfill-status.mjs';

function fail(reason){throw Error('ISSUE734_9288_PREFLIGHT_'+reason);}
async function read(url,token,action,fetchImpl) {
 let response;
 try{
  response=await fetchImpl(url,{
   method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token}),
   signal:AbortSignal.timeout(90000)
  });
 }catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 let obj;
 try{obj=await response.json();}catch{fail('JSON_UNVERIFIED');}
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||obj.status!=='ok')
  fail('STATUS_UNVERIFIED');
 return obj;
}
export async function inspectIssue734V9288LiveReadiness({
 url,token,fetchImpl=fetch,expectedRows=338
}={}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 if(expectedRows!==338)fail('EXPECTED_COUNT_DRIFT');
 const res=await read(endpoint,token,'getAutomationStatus',fetchImpl);
 const a=res.automation;
 if(res.gasVersion!=='9.287'||a?.gasVersion!==res.gasVersion)
  fail('PUBLISHED_VERSION_NOT_9287');
 if(a.overallStatus!=='NORMAL')fail('OVERALL_STATUS_NOT_NORMAL');
 let close;
 try{close=summarizeCloseStatus(a);}catch{fail('CLOSE_SCHEMA_UNVERIFIED');}
 // Do not pass a completed status if its prices, NAV or expected trade date
 // are unresolved. A Watchdog recovery can satisfy this only AFTER completion.
 if(close.state!=='COMPLETE'||close.priceOk!==true||close.fundOk!==true
   ||close.runStale!==false||close.snapshotStale!==false
   ||close.closeErrorCount!==0||close.closeErrorPresent
   ||close.fundErrorPresent||close.fundWarningPresent
   ||close.fundState!=='DONE')fail('CLOSE_NOT_SETTLED');
 if(['PRICE','FUND','FUND_PENDING','ERROR'].includes(close.stage))
  fail('CLOSE_WORK_ACTIVE');
 if(!Array.isArray(a.pendingKrxCloseDates)||a.pendingKrxCloseDates.length!==0
   ||a.pendingTradeSnapshotRebuildFrom
   ||a.tradeLedgerWriteUnverified!==false
   ||a.tradeSnapshotDeferredCount!==0)
  fail('PENDING_FINANCIAL_WRITES');
 const t=a.trigger;
 if(!t||t.hasClose!==true||t.hasWatchdog!==true
  ||t.hasLegacySplitTriggers!==false||t.hasDuplicateCloseTriggers!==false
  ||t.hasDuplicateWatchdogTriggers!==false)fail('TRIGGERS_UNVERIFIED');
 // Legacy 9.287 must present existing read-only A:K transactions, never
 // silently accept an already migrated/partially migrated v2 response.
 const ledger=await read(endpoint,token,'getTrades',fetchImpl);
 if(ledger.tradeLedgerProtocolVersion===2||!Array.isArray(ledger.trades)
   ||ledger.trades.length!==expectedRows)fail('LEGACY_LEDGER_NOT_EXACT');
 for(const trade of ledger.trades){
  if(!trade||typeof trade!=='object'||Array.isArray(trade)
   ||typeof trade.date!=='string'
   ||!/^20\d{2}-\d{2}-\d{2}$/.test(trade.date)
   ||typeof trade.code!=='string'
   ||('id' in trade))fail('LEGACY_ROW_SCHEMA_DRIFT');
 }
 return {kind:'ISSUE734_9288_LIVE_PREFLIGHT',status:'READONLY_PASS',
  observedGasVersion:res.gasVersion,closedRunSettled:true,
  persistedWritersIdle:true,legacyTradeRows:expectedRows,
  duplicateOldTriggerDetected:false,liveExternalWriterExcludedVerified:false,
  editorSessionExcludedVerified:false,concurrentProcessExcludedVerified:false,
  permissionToDeploy:false,permissionToMigrate:false,
  readRequests:2,financeWrites:0,gasDeployments:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  console.log(JSON.stringify(await inspectIssue734V9288LiveReadiness({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  })));
 }catch(error){
  const m=String(error?.message||'');
  console.error(/^ISSUE734_9288_PREFLIGHT_[A-Z0-9_]+$/.test(m)
   ?m:'ISSUE734_9288_PREFLIGHT_UNVERIFIED');
  process.exitCode=1;
 }
}
