#!/usr/bin/env node
// #734/#860 — GAS 9.295 versioned read-only release checks.
// No price requests, triggers, NAV imports, Snapshot rebuilds or mutations.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';

const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
const HASH=/^[0-9a-f]{64}$/;
const fail=code=>{throw Error('GAS9295_READONLY_'+code)};
const goodInt=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;

// Only explicit, sanitized fields from the already-fetched automation status.
export function summarizeReleaseAutomationBlocker(status,expectedVersion) {
 const c=status?.close||{};
 const pick=(value,allowed)=>allowed.includes(value)?value:'UNKNOWN';
 const bool=v=>typeof v==='boolean'?v:null;
 const count=v=>goodInt(v,100000)?v:null;
 const date=v=>{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return '-';
  const d=new Date(v+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?v:'-';
 };
 const checkpoint=v=>v&&typeof v==='object'?{
  runDate:date(v.runDate),targetDate:date(v.targetDate),attempted:bool(v.attempted),
  ok:bool(v.ok),deferred:bool(v.deferred),remaining:count(v.remaining),
  failureClass:pick(v.failureClass,['DETAIL_NOT_EXPOSED','SAVED_SNAPSHOT_DATE_INVALID','SAVED_SNAPSHOT_INTEGRITY_FAILED','SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED','CLOSE_RECONCILIATION_FAILED','BACKUP_SAFETY_FAILED','PRICE_WRITE_NOT_CONFIRMED','KRX_PRICE_SOURCE_OR_COVERAGE','SNAPSHOT_SAVE_OR_PROOF','LEASE_OR_WRITER_CONFLICT','FUND_OR_NAV_PRECONDITION','OTHER_UNCLASSIFIED'])
 }:null;
 return {kind:'GAS_RELEASE_AUTOMATION_BLOCKER_READONLY',version:pick(expectedVersion,['9.294','9.295','9.296','9.297','9.298','9.300','9.301','9.302','9.303','9.304','9.305']),
  overallStatus:pick(status?.overallStatus,['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN']),
  closeState:pick(c.state,['COMPLETE','INCOMPLETE','ERROR','NEVER_RUN']),
  closeStage:pick(c.stage,['PRICE','FUND','FUND_PENDING','COMPLETE','ERROR']),
  closeRunDate:date(c.runDate),expectedRunDate:date(c.expectedRunDate),
  summaryRunDate:date(c.summaryRunDate),expectedSnapshotDate:date(c.expectedSnapshotDate),
  snapshotLastDate:date(status?.snapshotLastDate),priceHistoryLastDate:date(status?.priceHistoryLastDate),
  officialKrxPriceHistoryLastDate:date(status?.officialKrxPriceHistoryLastDate),
  priceOk:bool(c.priceOk),fundOk:bool(c.fundOk),closeErrorCount:count(c.closeErrorCount),
  closeErrorPresent:bool(c.closeErrorPresent),runStale:bool(c.runStale),snapshotStale:bool(c.snapshotStale),
  fundDate:date(c.fundDate),fundAttemptDate:date(c.fundAttemptDate),
  fundState:pick(c.fundState,['DONE','ERROR','UNKNOWN_LEGACY','TIMEOUT_SUSPECTED','IN_PROGRESS']),
  fundErrorPresent:bool(c.fundErrorPresent),
  fundErrorCode:pick(c.fundErrorCode,['NONE','CONTINUATION','BUSY','PRICE_WRITE_VERIFICATION','NAV_CONFLICT','PROPERTY_LIMIT','SHEET_CAPACITY','TIMEOUT','BACKUP_FAILURE','SNAPSHOT_PROTECTED','WRITE_VERIFICATION','INTERNAL_RUNTIME','NAV_PROCESSING','UNCLASSIFIED']),
  fundWarningPresent:bool(c.fundWarningPresent),
  fundWarningClass:pick(status?.fundWarningClass,['NONE','SNAPSHOT_PROTECTED','NAV_PUBLICATION_OR_INPUT_PENDING','PARTIAL_FUND_VALUATION','UNCLASSIFIED']),
  krxPublicationWaiting:bool(c.krxPublicationWaiting),krxPublicationTradeDate:date(c.krxPublicationTradeDate),
  triggerReady:bool(status?.triggerReady),pendingCount:count(status?.pendingCount),
  tradeSnapshotDeferredCount:count(status?.tradeSnapshotDeferredCount),
  latestBackfill:checkpoint(status?.latestBackfill),latestHistoricalBackfill:checkpoint(status?.latestHistoricalBackfill),
  financeWrites:0,gasDeployments:0,releaseAuthorized:false};
}
export function assessGas9295ReleaseState({ledger,gate,status,
 expectedVersion='9.294',requireIdle=true,reportBlockedAutomation=()=>{}}={}){
 if(!['9.294','9.295','9.296','9.297','9.298','9.300','9.301','9.302','9.303','9.304','9.305'].includes(expectedVersion))fail('EXPECTED_VERSION_INVALID');
 if(gate?.status!=='ok'||gate.gasVersion!==expectedVersion
  ||status?.gasVersion!==expectedVersion)fail('VERSION_MISMATCH');
 if(ledger?.status!=='ok'||ledger.tradeLedgerProtocolVersion!==2
  ||!Array.isArray(ledger.trades)||ledger.trades.length>50000
  ||!HASH.test(String(ledger.ledgerRevision||'')))fail('LEDGER_UNVERIFIED');
 const ids=new Set();
 for(const item of ledger.trades){
  if(!item||!ID.test(item.id)||ids.has(item.id))fail('LEDGER_IDS_UNVERIFIED');
  ids.add(item.id);
 }
 const g=gate.writerGate;
 if(!g||g.mode!=='OPEN'||g.repairAuthorized!==false
  ||!goodInt(g.activeCount,24)||!Array.isArray(g.activeOwners)
  ||g.activeOwners.length!==g.activeCount
  ||!goodInt(g.expiredUnconfirmedCount,100000)
  ||!goodInt(g.timeoutRetirementCandidates,g.activeCount))
   fail('WRITER_GATE_UNVERIFIED');
 // Do not emit owners, trade rows, financial data or the raw revision.
 if(JSON.stringify(g).includes('"token"'))fail('GATE_SECRET_EXPOSED');
 if(requireIdle&&g.activeCount!==0)fail('WRITER_ACTIVE');
 if(requireIdle&&g.timeoutRetirementCandidates!==0)fail('WRITER_RECONCILIATION_PENDING');
 if(status?.mode!=='READ_ONLY'||status.gasVersionReady!==true
  ||status.triggerReady!==true
  ||status.tradeLedgerWriteUnverified!==false
  ||status.pendingTradeSnapshotRebuildFrom!=='-'
  ||!goodInt(status.tradeSnapshotDeferredCount,600)
  ||!goodInt(status.pendingCount,600)
  ||!status.close||typeof status.close!=='object')
   fail('AUTOMATION_STATUS_UNVERIFIED');
 if(requireIdle&&(status.tradeSnapshotDeferredCount!==0
    ||status.pendingCount!==0))fail('PENDING_FINANCIAL_RECOVERY');
 if(requireIdle&&(status.close.stage==='PRICE'
    ||status.close.stage==='FUND'
    ||status.close.stage==='FUND_PENDING'
    ||status.close.fundState==='IN_PROGRESS'
    ||['RUNNING_RECENT_UNCONFIRMED','RUNNING_START_UNAVAILABLE',
        'FUTURE_START_UNVERIFIED'].includes(status.tradeSnapshotWorkerRuntimeAssessment)))
   fail('CLOSE_OR_WORKER_ACTIVE');
 if(!['NORMAL','WARNING'].includes(status.overallStatus)){
   reportBlockedAutomation(summarizeReleaseAutomationBlocker(status,expectedVersion));
   fail('AUTOMATION_NOT_STABLE');
 }
 return {
  kind:'GAS9295_READONLY_RELEASE_STATE',status:'VERIFIED',
  version:expectedVersion,tradeLedgerProtocolVersion:2,
  tradeRows:ids.size,writerGateMode:'OPEN',activeCount:g.activeCount,
  tradeSnapshotDeferredCount:status.tradeSnapshotDeferredCount,
  pendingCount:status.pendingCount,
  snapshotIndependentRowProof:false,
  // Revision remains private in the caller; never print it.
  financeWrites:0,propertyWrites:0,gasDeployments:0
 };
}

async function request(url,token,action,fetchImpl) {
 const urlObj=new URL(url);
 const isGet=action==='getWriterGateStatus';
 const options={method:isGet?'GET':'POST',
  redirect:'follow',signal:AbortSignal.timeout(isGet?30000:60000)};
 if(isGet) {
  urlObj.searchParams.set('action',action);
  urlObj.searchParams.set('accessToken',token);
 } else {
  options.headers={'content-type':'application/x-www-form-urlencoded;charset=UTF-8'};
  options.body=new URLSearchParams({action,accessToken:token});
 }
 let response;
 try{response=await fetchImpl(isGet?urlObj.toString():url,options)}
 catch{fail('NETWORK_UNVERIFIED')}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 try{return await response.json()}catch{fail('JSON_UNVERIFIED')}
}

export async function verifyGas9295ReleaseReadOnly({url,token,
 expectedVersion='9.294',fetchImpl=fetch,reportBlockedAutomation=()=>{}}={}) {
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 // getSettings is deliberately excluded: it may settle a pending code
 // deletion under ScriptLock even though the HTTP action looks like a read.
 const ledger=await request(endpoint,token,'getTrades',fetchImpl);
 const gate=await request(endpoint,token,'getWriterGateStatus',fetchImpl);
 const status=await runBackfillStatus({url:endpoint,token,fetchImpl});
 const summary=assessGas9295ReleaseState({
  ledger,gate,status,expectedVersion,reportBlockedAutomation
 });
 // Recheck immediately before publication: an intervening trade or writer
 // must not be confused with the static same-moment proof.
 if(expectedVersion==='9.294') {
  const verifyLedger=await request(endpoint,token,'getTrades',fetchImpl);
  const verifyGate=await request(endpoint,token,'getWriterGateStatus',fetchImpl);
  if(verifyLedger?.status!=='ok'
    ||verifyLedger.tradeLedgerProtocolVersion!==2
    ||verifyLedger.ledgerRevision!==ledger.ledgerRevision
    ||!Array.isArray(verifyLedger.trades)
    ||verifyLedger.trades.length!==ledger.trades.length
    ||verifyGate?.status!=='ok'
    ||verifyGate.gasVersion!==expectedVersion
    ||verifyGate.writerGate?.mode!=='OPEN'
    ||verifyGate.writerGate?.activeCount!==0)
   fail('PREFLIGHT_STATE_MOVED');
 }
 return summary;
}
export async function verifyGas9295PostdeployWithRetry({verify,
 delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxAttempts=3}={}){
 if(typeof verify!=='function'||typeof delay!=='function'
  ||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)
   fail('RETRY_CONTRACT_INVALID');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  try{
   const result=await verify();
   if(result?.status!=='VERIFIED'||result.version!=='9.295'
      ||result.financeWrites!==0)fail('POSTDEPLOY_PROOF_INVALID');
   return {...result,readbackAttempts:attempt};
  }catch(e){
   if(e?.message!=='GAS9295_READONLY_VERSION_MISMATCH'||attempt===maxAttempts)
    throw e;
   await delay(3000*attempt);
  }
 }
 fail('POSTDEPLOY_RETRY_EXHAUSTED');
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invoked) {
 const mode=process.argv[2];
 if(!['pre','post'].includes(mode))fail('CLI_MODE_INVALID');
 try {
  const verify=()=>verifyGas9295ReleaseReadOnly({
   url:process.env.GAS_WEB_APP_URL,
   token:process.env.GAS_ACCESS_TOKEN,
   expectedVersion:mode==='pre'?'9.294':'9.295'
  });
  const result=mode==='pre'?await verify()
    :await verifyGas9295PostdeployWithRetry({verify});
  console.log(JSON.stringify(result));
  if(mode==='pre'&&process.env.GITHUB_OUTPUT)
   appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(e){
  const message=String(e?.message||'');
  console.error(/^GAS9295_READONLY_[A-Z_]+$/.test(message)
   ?message:'GAS9295_READONLY_UNVERIFIED');
  process.exitCode=1;
 }
}
