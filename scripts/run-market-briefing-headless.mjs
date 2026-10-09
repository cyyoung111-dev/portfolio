#!/usr/bin/env node
import { krxSessionStatus } from './krx-session-calendar.mjs';
import { fetchUsdKrwYahooDaily } from './market-briefing-fx-fallback.mjs';
import '../src/web/domain/market/market_data_provider.js';
import '../src/web/domain/market/market_briefing_master.js';
import '../src/web/domain/market/market_briefing_provider_normalizer.js';
import '../src/web/domain/market/market_briefing_snapshot_store.js';
import '../src/web/domain/market/market_briefing_operational_gate.js';
import '../src/web/domain/market/market_briefing_runtime_store.js';
import '../src/web/domain/market/market_briefing_provider_collector.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};
await import('../src/web/domain/market/market_briefing_runtime.js');

const ALLOWED = new Set(['NIGHT_FINAL', 'MORNING', 'KRX_FINAL', 'EVENING']);
function kstDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
}
function dateOffset(date, days) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
const SCHEDULE_SLOTS = Object.freeze({
  '15 21 * * 0-4': { hour:21, minute:15, weekdays:[0,1,2,3,4], checkpoint:'NIGHT_FINAL' },
  '30 22 * * 0-4': { hour:22, minute:30, weekdays:[0,1,2,3,4], checkpoint:'MORNING' },
  '30 7 * * 1-5': { hour:7, minute:30, weekdays:[1,2,3,4,5], checkpoint:'KRX_FINAL' },
  '15 11 * * 1-5': { hour:11, minute:15, weekdays:[1,2,3,4,5], checkpoint:'EVENING' },
});
function scheduledTradingDate(schedule, now = new Date()) {
  const slot = SCHEDULE_SLOTS[String(schedule || '').trim()];
  if (!slot) throw new Error('지원하지 않는 schedule');
  const cursor = new Date(now);
  cursor.setUTCSeconds(0, 0);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - offset, slot.hour, slot.minute));
    if (slot.weekdays.includes(candidate.getUTCDay()) && candidate <= now) return kstDate(candidate);
  }
  throw new Error('schedule tradingDate를 계산할 수 없습니다.');
}
function parseArgs(argv) {
  const checkpoint = String(argv[argv.indexOf('--checkpoint') + 1] || '').toUpperCase();
  const suppliedDate = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : '';
  const schedule = argv.includes('--schedule') ? argv[argv.indexOf('--schedule') + 1] : '';
  const scheduledAt = argv.includes('--scheduled-at') ? argv[argv.indexOf('--scheduled-at') + 1] : '';
  if (!ALLOWED.has(checkpoint)) throw new Error('지원하지 않는 checkpoint');
  if (schedule && (!SCHEDULE_SLOTS[schedule] || SCHEDULE_SLOTS[schedule].checkpoint !== checkpoint)) throw new Error('schedule과 checkpoint가 일치하지 않습니다.');
  const scheduledAnchor = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduledAt && (!scheduledAnchor || Number.isNaN(scheduledAnchor.getTime()))) throw new Error('잘못된 scheduled-at');
  const tradingDate = suppliedDate || (schedule ? scheduledTradingDate(schedule, scheduledAnchor || new Date()) : kstDate());
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(tradingDate) ? new Date(`${tradingDate}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== tradingDate) throw new Error('잘못된 tradingDate');
  return { checkpoint, tradingDate, schedule, scheduledAt };
}
function maskSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('***');
  return text.replace(/((?:accessToken|auth_key|apiKey|secret|token)\s*[=:]\s*)[^&\s,;]+/gi, '$1***');
}
function persistenceCounts(value) { return value ? { saved:Number(value.saved)||0, duplicates:Number(value.duplicates)||0, rejected:Number(value.rejected)||0 } : null; }
function diagnosticFor(result, secrets = []) {
  const successful = result.skippedDomestic === true || (result.checkpoint === 'NIGHT_FINAL' ? result.successful : result.decision?.publishable === true);
  return { checkpoint:result.checkpoint, tradingDate:result.tradingDate, status:result.skippedDomestic ? 'SKIPPED_DOMESTIC_CLOSED' : result.decision?.status || (successful?'COLLECTED':'NOT_READY'), published:!!result.persistence,
    ...(result.skippedDomestic ? { skipReason:'KRX_CONFIRMED_NON_TRADING_DAY' } : {}),
    masterPersistence:persistenceCounts(result.sync?.persistence), snapshotPersistence:persistenceCounts(result.persistence),
    readinessSeries:result.decision?.data?.snapshot?.values || {}, warnings:result.decision?.data?.warnings || [],
    missing:result.decision?.data?.missing || result.sync?.missing || [], issues:result.decision?.data?.issues || [],
    providerErrors:Object.keys(result.sync?.errors || {}),
    providerErrorDetails:Object.fromEntries(Object.entries(result.sync?.errors || {}).map(([key,value])=>[key,maskSecrets(value,secrets)])) };
}
function createRequest(url, token, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url)) throw new Error('GAS_WEB_APP_URL은 HTTPS여야 합니다.');
  return async (action, params = {}, options = {}) => {
    const form = new URLSearchParams({ action, ...params });
    if (token) form.set('accessToken', token);
    // All collectors pass timeoutMs, but the original adapter ignored it.
    // Bound redirects and GAS network stalls instead of consuming the full
    // 10-minute GitHub Actions job without a useful provider error.
    const requested = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(requested) && requested > 0
      ? Math.min(90000, Math.max(5000, requested)) : 45000;
    const response = await fetchImpl(url, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded;charset=UTF-8' }, body:form, redirect:'follow', signal:AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`GAS_HTTP_${response.status}`);
    const result = await response.json();
    if (action === 'getExchangeRateHistory') {
      if (result && ['ok', 'CONFIRMED', 'NO_DATA'].includes(result.status)) return result;
      if (result && ['MISSING_SOURCE', 'INVALID_SCHEMA'].includes(result.status)) throw new Error(`FX_${result.status}`);
    }
    if (!result || result.status !== 'ok') throw new Error(maskSecrets(result?.message || 'GAS_RESPONSE_ERROR', [token, url]));
    return result;
  };
}
export async function runHeadless({ checkpoint, tradingDate, url, token, request: suppliedRequest, receivedAt, fxFallback = fetchUsdKrwYahooDaily }) {
  const request = suppliedRequest || createRequest(url, token);
  const runtime = globalThis.MarketBriefingRuntime, gate = globalThis.MarketBriefingOperationalGate;
  // KRX_FINAL has no same-day domestic close on exchange holidays/weekends.
  // Keep EVENING foreign/FX collection running, but do not publish a false
  // same-day KRX final. UNKNOWN dates must not be silently skipped.
  const domesticClosed = krxSessionStatus(tradingDate) === 'CLOSED';
  if (domesticClosed && checkpoint === 'KRX_FINAL')
    return { checkpoint, tradingDate, skippedDomestic:true, sync:null, decision:null, persistence:null };
  const benchmarkTo = checkpoint === 'MORNING' ? dateOffset(tradingDate, -1) : tradingDate;
  const fxTo = tradingDate;
  const scopedRequest = async (action, params = {}, options) => {
    const scopedParams = {
      ...params,
      ...(action === 'getBenchmarks' ? { to:benchmarkTo } : {}),
      ...(action === 'getExchangeRateHistory' ? { to:fxTo } : {}),
    };
    try { return await request(action, scopedParams, options); }
    catch (error) {
      // The production workbook has no '환율이력' tab. Do not synthesize FX
      // or write to the financial ledger: use dated Yahoo daily FX only for
      // the market briefing, and only for the explicit MISSING_SOURCE case.
      // GAS authentication, schema errors and other failures stay visible.
      if (action === 'getExchangeRateHistory' && error?.message === 'FX_MISSING_SOURCE')
        return fxFallback({ from:scopedParams.from, to:scopedParams.to });
      throw error;
    }
  };
  const sync = await runtime.syncServerMaster(scopedRequest, scopedRequest, tradingDate, { checkpoint, from:dateOffset(tradingDate, -10),
    to:benchmarkTo, benchmarkTo, fxTo, scheduledToleranceSeconds:300, receivedAt });
  if (domesticClosed && checkpoint === 'EVENING')
    return { checkpoint, tradingDate, skippedDomestic:true, sync, decision:null, persistence:null };
  if (checkpoint === 'NIGHT_FINAL') return { checkpoint, tradingDate, sync, decision:null, persistence:null, successful:runtime.hasNightFinal(tradingDate) };
  const decision = runtime.readiness(tradingDate, checkpoint);
  if (!decision.publishable) return { checkpoint, tradingDate, sync, decision, persistence:null };
  const released = await runtime.releaseAndPersist(request, tradingDate, checkpoint, gate.seriesForCheckpoint(checkpoint));
  return { checkpoint, tradingDate, sync, decision:released.decision, persistence:released.persistence };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runHeadless({ ...args, url:process.env.GAS_WEB_APP_URL || '', token:process.env.GAS_ACCESS_TOKEN || '' });
  const successful = result.skippedDomestic === true || (result.checkpoint === 'NIGHT_FINAL' ? result.successful : result.decision?.publishable === true);
  const diagnostic = diagnosticFor(result,[process.env.GAS_ACCESS_TOKEN,process.env.GAS_WEB_APP_URL]);
  console.log(JSON.stringify(diagnostic));
  if (!successful) process.exitCode = 1;
}

export { createRequest, diagnosticFor, parseArgs, scheduledTradingDate, maskSecrets };
