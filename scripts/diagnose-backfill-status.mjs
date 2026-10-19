#!/usr/bin/env node
// Read-only, authenticated GAS automation/queue checkpoint. Output is aggregate
// status only; never print raw GAS responses, run errors, tokens or URLs.
import { validateWebAppUrl } from './diagnose-krx-operational.mjs';

const REQUIRED = ['hasClose','hasWatchdog','hasBackfill','hasHistoricalBackfill',
  'hasMidnightBackfill','hasIntegrityChange','hasClean','hasMortgage'];
const COUNTS = ['closeCount','watchdogCount','backfillCount',
  'historicalBackfillCount','midnightBackfillCount'];
const DUPLICATES = ['hasDuplicateCloseTriggers','hasDuplicateWatchdogTriggers',
  'hasDuplicateBackfillTriggers','hasDuplicateHistoricalBackfillTriggers',
  'hasDuplicateMidnightBackfillTriggers'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function safeDate(value) {
  if (value === '-' || value === '' || value == null) return '-';
  if (typeof value !== 'string' || !DATE.test(value)) throw new Error('AUTOMATION_DIAG_BAD_DATE');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value)
    throw new Error('AUTOMATION_DIAG_BAD_DATE');
  return value;
}
// Fixed enum only. Never emit the underlying GAS error: it can contain
// account identifiers, security details, or the text of a holding/trade.
export function classifyBackfillFailure(result) {
  if (!result || result.attempted !== true || result.ok !== false) return null;
  const raw=typeof result.error==='string'?result.error:'';
  if (!raw) return 'DETAIL_NOT_EXPOSED';
  if (raw.startsWith('BACKFILL_PERSISTED_VERIFICATION_FAILED:SNAPSHOT_DATE_INVALID'))
    return 'SAVED_SNAPSHOT_DATE_INVALID';
  if (raw.startsWith('BACKFILL_PERSISTED_VERIFICATION_FAILED:SNAPSHOT_'))
    return 'SAVED_SNAPSHOT_INTEGRITY_FAILED';
  if (raw.startsWith('BACKFILL_PERSISTED_VERIFICATION_FAILED:'))
    return 'SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED';
  if (raw.includes('BACKFILL_RECONCILIATION_FAILED'))
    return 'CLOSE_RECONCILIATION_FAILED';
  if (raw.includes('TARGET_BACKUP_FAILED') || /backup|백업/i.test(raw))
    return 'BACKUP_SAFETY_FAILED';
  if (raw.includes('백필 PRICE 저장 성공을 확인하지 못해'))
    return 'PRICE_WRITE_NOT_CONFIRMED';
  if (/KRX|공식 종가|KOSPI|KOSDAQ|ETF/i.test(raw))
    return 'KRX_PRICE_SOURCE_OR_COVERAGE';
  if (/SNAPSHOT|스냅샷/i.test(raw))
    return 'SNAPSHOT_SAVE_OR_PROOF';
  if (/LEASE|LOCK|동시|잠금|락을/i.test(raw))
    return 'LEASE_OR_WRITER_CONFLICT';
  if (/FUND|NAV|펀드/i.test(raw))
    return 'FUND_OR_NAV_PRECONDITION';
  return 'OTHER_UNCLASSIFIED';
}
function checkpoint(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.runDate !== 'string'
      || !Number.isSafeInteger(raw.checkedAt) || raw.checkedAt < 0
      || !raw.result || typeof raw.result !== 'object'
      || typeof raw.result.attempted !== 'boolean')
    throw new Error('AUTOMATION_DIAG_BAD_CHECKPOINT');
  const r = raw.result;
  if (r.ok !== undefined && typeof r.ok !== 'boolean')
    throw new Error('AUTOMATION_DIAG_BAD_CHECKPOINT');
  if (r.remaining !== undefined && (!Number.isSafeInteger(r.remaining) || r.remaining < 0))
    throw new Error('AUTOMATION_DIAG_BAD_CHECKPOINT');
  return { runDate:safeDate(raw.runDate), checkedAt:raw.checkedAt,
    attempted:r.attempted, ok:r.ok === undefined ? null : r.ok,
    targetDate:r.date === undefined ? '-' : safeDate(r.date),
    remaining:r.remaining ?? null,
    // The original GAS error/reason may embed account details; omit it.
    deferred:r.deferred === true,
    failureClass:classifyBackfillFailure(r) };
}
const WORKER_STATES=new Set(['IDLE','LEDGER_WRITE_UNVERIFIED','SOURCE_UNSTABLE',
  'DEFERRED_RETRY','DEFERRED_RESOLVED','BLOCKED','NO_EXISTING_SNAPSHOT',
  'DEFERRED_OUTSTANDING','COMPLETED','PENDING','ERROR']);
const WORKER_SOURCES=new Set(['','UNCHANGED','BASELINED','CHANGED','UNSTABLE']);
function safeWorkerCheckpoint(raw) {
  if(raw == null)return null;
  if(!raw || typeof raw!=='object' || Array.isArray(raw)
    || !WORKER_STATES.has(raw.status)
    || typeof raw.at!=='string'
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/.test(raw.at)
    || !Number.isFinite(Date.parse(raw.at))
    || new Date(raw.at).toISOString()!==raw.at
    || !Number.isSafeInteger(raw.processed)||raw.processed<0||raw.processed>2
    || !Number.isSafeInteger(raw.deferred)||raw.deferred<0||raw.deferred>2
    || !WORKER_SOURCES.has(raw.sourceCheck||''))
    throw new Error('AUTOMATION_DIAG_BAD_LEDGER_WORKER_CHECKPOINT');
  const blockedDate=safeDate(raw.blockedDate || '');
  return {status:raw.status,at:raw.at,processed:raw.processed,
    deferred:raw.deferred,blockedDate,sourceCheck:raw.sourceCheck||''};
}
const HISTORICAL_STATES=new Set(['RUNNING','SUCCEEDED','FAILED','DEFERRED','NO_WORK']);
const HISTORICAL_REASONS=new Set(['STARTED','COMPLETE','FAILED','NO_WORK','FUND_ACTIVE',
  'CLOSE_ACTIVE','BACKFILL_BUSY','LEASE_CONFLICT','BLOCKED_PRECONDITION','EXCEPTION']);
function safeHistoricalCheckpoint(v){
  if(v==null)return null;
  if(!v||typeof v!=='object'||Array.isArray(v)
    ||!HISTORICAL_STATES.has(v.state)||!HISTORICAL_REASONS.has(v.reason)
    ||!Number.isSafeInteger(v.startedAt)||v.startedAt<0
    ||(v.finishedAt!==null&&(!Number.isSafeInteger(v.finishedAt)||v.finishedAt<v.startedAt))
    ||typeof v.attempted!=='boolean'
    ||(v.ok!==null&&typeof v.ok!=='boolean')
    ||typeof v.deferred!=='boolean')
    throw new Error('AUTOMATION_DIAG_BAD_HISTORICAL_CHECKPOINT');
  const date=safeDate(v.runDate);
  if(date==='-'||(v.state==='RUNNING'&&v.finishedAt!==null)
    ||(v.state!=='RUNNING'&&v.finishedAt===null))
    throw new Error('AUTOMATION_DIAG_BAD_HISTORICAL_CHECKPOINT');
  return {runDate:date,startedAt:v.startedAt,finishedAt:v.finishedAt,
    state:v.state,attempted:v.attempted,ok:v.ok,deferred:v.deferred,reason:v.reason};
}
export function summarizeBackfillStatus(payload) {
  const a = payload?.automation;
  if (payload?.status !== 'ok' || !a || typeof a !== 'object'
      || typeof a.gasVersion !== 'string'
      || !/^\d+\.\d+$/.test(a.gasVersion)
      || payload.gasVersion !== a.gasVersion
      || typeof a.trigger !== 'object' || !a.trigger || Array.isArray(a.trigger))
    throw new Error('AUTOMATION_DIAG_BAD_RESPONSE');
  const trigger=a.trigger;
  const parts=a.gasVersion.split('.').map(Number);
  const hasMorningRelease=parts[0]>9||(parts[0]===9&&parts[1]>=235);
  const hasLedgerRelease=parts[0]>9||(parts[0]===9&&parts[1]>=237);
  const required=(hasMorningRelease?REQUIRED.concat('hasMorningBackfill'):REQUIRED)
    .concat(hasLedgerRelease?['hasIntegrityEdit','hasLedgerRebuild']:[]);
  const counts=hasMorningRelease?COUNTS.concat('morningBackfillCount'):COUNTS;
  const duplicateFlags=hasMorningRelease?DUPLICATES.concat('hasDuplicateMorningBackfillTriggers'):DUPLICATES;
  for (const name of [...required,...duplicateFlags,'hasLegacySplitTriggers']) {
    if (typeof trigger[name] !== 'boolean') throw new Error('AUTOMATION_DIAG_BAD_TRIGGER');
  }
  for (const name of counts) {
    if (!Number.isSafeInteger(trigger[name]) || trigger[name] < 0)
      throw new Error('AUTOMATION_DIAG_BAD_TRIGGER');
  }
  if (!Array.isArray(a.pendingKrxCloseDates) || a.pendingKrxCloseDates.length > 600)
    throw new Error('AUTOMATION_DIAG_BAD_QUEUE');
  const pending=a.pendingKrxCloseDates.map(safeDate);
  if (pending.includes('-') || new Set(pending).size !== pending.length)
    throw new Error('AUTOMATION_DIAG_BAD_QUEUE');
  // 08:45 auto-recovery cannot be healthy on a pre-9.235 deployment,
  // even when every legacy nightly trigger is installed and running.
  const complete=hasMorningRelease && required.every(name=>trigger[name]) &&
    counts.every(name=>trigger[name]===1) &&
    duplicateFlags.every(name=>!trigger[name]) && !trigger.hasLegacySplitTriggers;
  const triggerCounts=Object.fromEntries(counts.map(name=>[name,trigger[name]]));
  const triggerMissing=required.filter(name=>!trigger[name]);
  const duplicates=duplicateFlags.filter(name=>trigger[name]);
  if(hasLedgerRelease && typeof a.tradeLedgerWriteUnverified!=='boolean')
    throw new Error('AUTOMATION_DIAG_BAD_LEDGER_WRITE');
  if(hasLedgerRelease && typeof a.pendingTradeSnapshotRebuildFrom!=='string')
    throw new Error('AUTOMATION_DIAG_BAD_LEDGER_PENDING');
  const pendingTradeSnapshotRebuildFrom=hasLedgerRelease
    ?safeDate(a.pendingTradeSnapshotRebuildFrom):'-';
  const hasWorkerRelease=parts[0]>9||(parts[0]===9&&parts[1]>=238);
  if(hasWorkerRelease && (!Number.isSafeInteger(a.tradeSnapshotDeferredCount)
    || a.tradeSnapshotDeferredCount<0 || a.tradeSnapshotDeferredCount>600))
    throw new Error('AUTOMATION_DIAG_BAD_DEFERRED_COUNT');
  const tradeSnapshotDeferredCount=hasWorkerRelease?a.tradeSnapshotDeferredCount:null;
  const tradeSnapshotDeferredOldestDate=hasWorkerRelease
    ?safeDate(a.tradeSnapshotDeferredOldestDate):'-';
  if(hasWorkerRelease && ((tradeSnapshotDeferredCount===0 && tradeSnapshotDeferredOldestDate!=='-')
    || (tradeSnapshotDeferredCount>0 && tradeSnapshotDeferredOldestDate==='-')))
    throw new Error('AUTOMATION_DIAG_BAD_DEFERRED_DATE');
  const tradeSnapshotWorkerLastResult=hasWorkerRelease
    ?safeWorkerCheckpoint(a.tradeSnapshotWorkerLastResult):null;
  const overallStatus=String(a.overallStatus || '');
  if (!['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN'].includes(overallStatus))
    throw new Error('AUTOMATION_DIAG_BAD_RESPONSE');
  return {
    mode:'READ_ONLY', gasVersion:a.gasVersion, minGasVersion:'9.235',
    gasVersionReady:hasMorningRelease, overallStatus,
    triggerReady:complete, triggerCounts, triggerMissing, duplicateTriggerFlags:duplicates,
    legacySplitTriggers:trigger.hasLegacySplitTriggers,
    pendingDates:pending, pendingCount:pending.length,
    pendingTradeSnapshotRebuildFrom,
    tradeLedgerWriteUnverified:hasLedgerRelease?a.tradeLedgerWriteUnverified:false,
    tradeSnapshotDeferredCount,
    tradeSnapshotDeferredOldestDate,
    tradeSnapshotWorkerLastResult,
    officialKrxPriceHistoryLastDate:safeDate(a.officialKrxPriceHistoryLastDate),
    snapshotLastDate:safeDate(a.snapshotLastDate),
    priceHistoryLastDate:safeDate(a.priceHistoryLastDate),
    latestBackfill:checkpoint(a.backfillLastResult),
    latestHistoricalBackfill:checkpoint(a.historicalBackfillLastResult),
    historical2310:safeHistoricalCheckpoint(a.historical2310Checkpoint),
    historical0030:safeHistoricalCheckpoint(a.historical0030Checkpoint)
  };
}
async function request(url,token,fetchImpl) {
  let response;
  try {
    response=await fetchImpl(url,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:'getAutomationStatus',accessToken:token}),
      redirect:'follow',signal:AbortSignal.timeout(60000)});
  } catch {throw new Error('AUTOMATION_DIAG_NETWORK_FAILED');}
  if (!response.ok) throw new Error('AUTOMATION_DIAG_HTTP_FAILED');
  try{return await response.json();}
  catch {throw new Error('AUTOMATION_DIAG_NON_JSON');}
}
export async function runBackfillStatus({url,token,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if (typeof token!=='string' || !token.trim()) throw new Error('AUTOMATION_DIAG_TOKEN_MISSING');
  const invalid=token==='AUTOMATION_READONLY_AUTH_PROBE'
    ? 'AUTOMATION_READONLY_AUTH_PROBE_ALT' : 'AUTOMATION_READONLY_AUTH_PROBE';
  const denied=await request(endpoint,invalid,fetchImpl);
  if (denied?.status!=='error' || denied.message!=='인증 실패')
    throw new Error('AUTOMATION_DIAG_AUTH_DISABLED');
  return summarizeBackfillStatus(await request(endpoint,token,fetchImpl));
}
if (process.argv[1] && import.meta.url === new URL('file://'+process.argv[1]).href) {
  try {
    const data=await runBackfillStatus({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
    });
    console.log(JSON.stringify(data));
    if (!data.triggerReady) process.exitCode=1;
  } catch(error) {
    const code=String(error?.message||'');
    console.error(/^AUTOMATION_DIAG_[A-Z_]+$/.test(code)?code:'AUTOMATION_DIAG_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
