#!/usr/bin/env node
// Authenticated READ_ONLY production diagnostics for 9/15-16 snapshot conflict
// and 10/09-11 holiday backlog. No GAS write actions, account details, or raw
// API response bodies are ever logged. Permanent output: aggregates only.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const TARGETS=['2026-09-15','2026-09-16','2026-10-08'];
const HOLIDAYS=['2026-10-09','2026-10-10','2026-10-11'];
// Check expected-vs-persisted Snapshot for the holiday dates as well as
// source coverage. No Snapshot/PRICE writing is permitted here.
// Historical comparison plus all eleven 10/06–10/16 pending candidates;
// KRX source probes remain limited to the three known market-closed dates.
const OTHER_PENDING_DATES=['2026-10-06','2026-10-07','2026-10-12',
  '2026-10-13','2026-10-14','2026-10-15','2026-10-16'];
const SNAPSHOT_TARGETS=TARGETS.concat(HOLIDAYS,OTHER_PENDING_DATES);
const ACTIONS=new Set(['getAutomationStatus','diagnoseSnapshotIntegrityRange','getKrxSourceDiagnostics']);
const count=v=>Array.isArray(v)?v.length:0;

export function summarizeConflictDay(item){
  if(!item||typeof item!=='object'||!SNAPSHOT_TARGETS.includes(item.date))
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_DATE');
  const classes=item.duplicateSummary||{};
  const nums=['groups','exactDuplicate','singleExpectedMatch',
    'manualProtected','unresolvedConflict','sourceIncomplete'];
  if(nums.some(k=>!Number.isSafeInteger(classes[k])||classes[k]<0))
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_CLASSES');
  const allowedStatuses=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
    'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
  if(!allowedStatuses.has(item.status))throw new Error('HOLIDAY_SNAPSHOT_INVALID_STATUS');
  const expected=Number(item.expectedRowCount),stored=Number(item.storedRowCount);
  if(!Number.isSafeInteger(expected)||expected<0||!Number.isSafeInteger(stored)||stored<0)
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_COUNTS');
  return {date:item.date,status:item.status,expectedRows:expected,storedRows:stored,
    duplicateGroups:classes.groups,
    exactDuplicateGroups:classes.exactDuplicate,
    uniqueExpectedMatchGroups:classes.singleExpectedMatch,
    manualProtectedGroups:classes.manualProtected,
    unresolvedConflictGroups:classes.unresolvedConflict,
    sourceIncompleteGroups:classes.sourceIncomplete,
    missingCodeCount:count(item.missingCodes),
    unexpectedCodeCount:count(item.unexpectedCodes),
    duplicateKeyCount:count(item.duplicateKeys),
    qtyMismatchCount:count(item.qtyMismatches),
    costMismatchCount:count(item.costAmtMismatches),
    evalUnitMismatchCount:count(item.evalUnitMismatches),
    evalAmountMismatchCount:count(item.evalAmtMismatches),
    sourceMismatchCount:count(item.sourceMismatches),
    sourceDataErrorCount:count(item.sourceDataErrors),
    fundNavStateCount:count(item.fundNavStates)};
}
export function summarizeHolidaySnapshotRange(payload){
  if(payload?.status!=='ok'||!Array.isArray(payload.diagnostics)
      || payload.diagnostics.length!==SNAPSHOT_TARGETS.length)
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_RESPONSE');
  const byDate=new Map(payload.diagnostics.map(x=>[x.date,x]));
  if(byDate.size!==SNAPSHOT_TARGETS.length||SNAPSHOT_TARGETS.some(d=>!byDate.has(d)))
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_RESPONSE');
  return SNAPSHOT_TARGETS.map(date=>summarizeConflictDay(byDate.get(date)));
}
export function summarizePendingStatus(payload){
  const a=payload?.automation;
  if(payload?.status!=='ok'||!a||!Array.isArray(a.pendingKrxCloseDates)
      ||typeof a.gasVersion!=='string')
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_STATUS_RESPONSE');
  const pending=a.pendingKrxCloseDates;
  if(pending.some(x=>typeof x!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x)))
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_QUEUE');
  return {gasVersion:a.gasVersion,overallStatus:String(a.overallStatus||''),
    holidayPendingDates:HOLIDAYS.filter(x=>pending.includes(x)),
    otherPendingDates:pending.filter(x=>!HOLIDAYS.includes(x)),
    pendingCount:pending.length,
    lastOfficialKrxPriceDate:String(a.officialKrxPriceHistoryLastDate||''),
    lastSnapshotDate:String(a.snapshotLastDate||'')};
}
export function summarizeHolidayProbe(payload,date){
  if(payload?.status!=='ok'||payload.requestedDate!==date)
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_PROBE');
  const coverage=payload.storedCoverage||{};
  const parseStatuses=new Set(['ROWS','EMPTY','NON_JSON','UNEXPECTED_SCHEMA','NOT_PARSED']);
  const compactMarket=x=>{
    const parseStatus=String(x?.parseStatus||'');
    if(!['KOSPI','KOSDAQ','ETF'].includes(String(x?.market||''))||
        !parseStatuses.has(parseStatus))
      throw new Error('HOLIDAY_SNAPSHOT_INVALID_MARKET');
    const validParsed=parseStatus==='ROWS'||parseStatus==='EMPTY';
    const exactDateRows=Number(x.exactDateRows||0);
    if(!Number.isSafeInteger(exactDateRows)||exactDateRows<0)
      throw new Error('HOLIDAY_SNAPSHOT_INVALID_MARKET');
    return {market:String(x.market),parseStatus,
      exactDateRows,httpOk:x.httpStatus===200,
      parsedOk:validParsed&&x.httpStatus===200};
  };
  const markets=Array.isArray(payload.markets)?payload.markets.map(compactMarket):[];
  const alternateProbes=Array.isArray(payload.alternateProbes)
    ?payload.alternateProbes.map(compactMarket):[];
  return {date,networkStatus:String(payload.networkStatus||''),
    keyConfigured:payload.keyConfigured===true,
    storedCoverageStatus:String(coverage.status||'UNAVAILABLE'),
    officialExactDateCodes:Number(coverage.officialExactDateCodes||0),
    snapshotRows:Number(coverage.snapshotRows||0),
    heldCodes:Number(coverage.expectedHeldCodes||0),
    queuedForBackfill:coverage.queuedForBackfill===true,
    markets,alternateProbes,
    providerSchemaFailure:markets.concat(alternateProbes).some(x=>
      x.httpOk&&!x.parsedOk)};
}
// A closed KRX session is not proof that a mixed foreign-market portfolio
// requires no historical valuation. Diagnostic classification NEVER authorizes
// removal of a pending date without separate foreign-session and NAV proof.
export function classifyHolidayPending({status,snapshot,holidays}) {
  if(!status||!Array.isArray(status.holidayPendingDates)
      ||!Array.isArray(snapshot)||!Array.isArray(holidays))
    throw new Error('HOLIDAY_SNAPSHOT_INVALID_DISPOSITION');
  return HOLIDAYS.map(date=>{
    const row=snapshot.find(x=>x.date===date);
    const probe=holidays.find(x=>x.date===date);
    if(!row||!probe||!Number.isSafeInteger(row.expectedRows)
        ||!Number.isSafeInteger(row.storedRows))
      throw new Error('HOLIDAY_SNAPSHOT_INVALID_DISPOSITION');
    const queued=status.holidayPendingDates.includes(date);
    let reason='NOT_QUEUED';
    if(queued) {
      if(probe.officialExactDateCodes>0)
        reason='BLOCKED_UNEXPECTED_CLOSED_KRX_DATE';
      else if(row.status==='NO_SNAPSHOT'||row.storedRows===0)
        reason='BLOCKED_SNAPSHOT_MISSING';
      else if(row.status!=='VALID')
        reason='BLOCKED_SNAPSHOT_INTEGRITY';
      else
        reason='BLOCKED_FOREIGN_SESSION_AND_NAV_PROOF_REQUIRED';
    }
    return {date,queued,snapshotStatus:row.status,
      expectedRows:row.expectedRows,storedRows:row.storedRows,
      reason,autoClearAuthorized:false};
  });
}
async function request(endpoint,token,action,fields={},fetchImpl=fetch){
  if(!ACTIONS.has(action))throw new Error('HOLIDAY_SNAPSHOT_FORBIDDEN_ACTION');
  const body=new URLSearchParams({action,accessToken:token,...fields});
  let response;try{
    response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw new Error('HOLIDAY_SNAPSHOT_NETWORK_FAILED');}
  if(!response.ok)throw new Error('HOLIDAY_SNAPSHOT_HTTP_FAILED');
  try{return await response.json();}catch{throw new Error('HOLIDAY_SNAPSHOT_NON_JSON');}
}
export async function runDiagnosis({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('HOLIDAY_SNAPSHOT_TOKEN_MISSING');
  const denied=await request(endpoint,'HOLIDAY_SNAPSHOT_AUTH_PROBE','getAutomationStatus',{},fetchImpl);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw new Error('HOLIDAY_SNAPSHOT_AUTH_NOT_ENFORCED');
  const status=summarizePendingStatus(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  const snapshot=summarizeHolidaySnapshotRange(await request(
    endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:SNAPSHOT_TARGETS.join(',')},fetchImpl));
  const holidays=[];
  for(const date of HOLIDAYS){
    const probe=await request(endpoint,token,'getKrxSourceDiagnostics',{date},fetchImpl);
    holidays.push(summarizeHolidayProbe(probe,date));
  }
  return {mode:'READ_ONLY',status,snapshot,holidays,
    queueDisposition:classifyHolidayPending({status,snapshot,holidays})};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    console.log(JSON.stringify(await runDiagnosis({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(error){
    const code=String(error?.message||'');
    console.error(/^HOLIDAY_SNAPSHOT_[A-Z_]+$/.test(code)?
      code:'HOLIDAY_SNAPSHOT_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
