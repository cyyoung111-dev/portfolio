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
    deferred:r.deferred === true };
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
  for (const name of [...REQUIRED,...DUPLICATES,'hasLegacySplitTriggers']) {
    if (typeof trigger[name] !== 'boolean') throw new Error('AUTOMATION_DIAG_BAD_TRIGGER');
  }
  for (const name of COUNTS) {
    if (!Number.isSafeInteger(trigger[name]) || trigger[name] < 0)
      throw new Error('AUTOMATION_DIAG_BAD_TRIGGER');
  }
  if (!Array.isArray(a.pendingKrxCloseDates) || a.pendingKrxCloseDates.length > 600)
    throw new Error('AUTOMATION_DIAG_BAD_QUEUE');
  const pending=a.pendingKrxCloseDates.map(safeDate);
  if (pending.includes('-') || new Set(pending).size !== pending.length)
    throw new Error('AUTOMATION_DIAG_BAD_QUEUE');
  const complete=REQUIRED.every(name=>trigger[name]) &&
    COUNTS.every(name=>trigger[name]===1) &&
    DUPLICATES.every(name=>!trigger[name]) && !trigger.hasLegacySplitTriggers;
  const triggerCounts=Object.fromEntries(COUNTS.map(name=>[name,trigger[name]]));
  const triggerMissing=REQUIRED.filter(name=>!trigger[name]);
  const duplicates=DUPLICATES.filter(name=>trigger[name]);
  const overallStatus=String(a.overallStatus || '');
  if (!['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN'].includes(overallStatus))
    throw new Error('AUTOMATION_DIAG_BAD_RESPONSE');
  return {
    mode:'READ_ONLY', gasVersion:a.gasVersion, overallStatus,
    triggerReady:complete, triggerCounts, triggerMissing, duplicateTriggerFlags:duplicates,
    legacySplitTriggers:trigger.hasLegacySplitTriggers,
    pendingDates:pending, pendingCount:pending.length,
    officialKrxPriceHistoryLastDate:safeDate(a.officialKrxPriceHistoryLastDate),
    snapshotLastDate:safeDate(a.snapshotLastDate),
    priceHistoryLastDate:safeDate(a.priceHistoryLastDate),
    latestBackfill:checkpoint(a.backfillLastResult),
    latestHistoricalBackfill:checkpoint(a.historicalBackfillLastResult)
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
