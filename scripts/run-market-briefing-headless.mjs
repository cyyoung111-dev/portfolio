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

function previousKrxOpenSession(date) {
  let candidate=dateOffset(date,-1);
  for(let i=0;i<25;i++,candidate=dateOffset(candidate,-1)){
    const state=krxSessionStatus(candidate);
    if(state==='OPEN')return candidate;
    if(state==='UNKNOWN')throw new Error('K200_PRIOR_KRX_SESSION_UNVERIFIED');
  }
  throw new Error('K200_PRIOR_KRX_SESSION_NOT_FOUND');
}
function previousWeekday(date) {
  let candidate=dateOffset(date,-1);
  for(let i=0;i<7;i++){
    const weekday=new Date(candidate+'T00:00:00Z').getUTCDay();
    if(weekday!==0&&weekday!==6)return candidate;
    candidate=dateOffset(candidate,-1);
  }
  throw new Error('FOREIGN_SESSION_DATE_INVALID');
}
function verifiedHolidayOverseasContext(payload,tradingDate) {
  const expectedUs=previousWeekday(tradingDate);
  const usValid=['SP500','NASDAQ100'].every(key=>{
    const point=payload?.[key],sourceDate=String(point?.sourceDate||'');
    return Number(point?.value)>0 && sourceDate===expectedUs
      && (point.status==='FINAL'||point.finality==='REGULAR_CLOSE');
  });
  // FX daily feeds may publish current KST date or the previous weekday's
  // completed daily close. Never accept an arbitrarily old or future quote.
  const fx=payload?.USDKRW,fxDate=String(fx?.sourceDate||'');
  const fxValid=Number(fx?.value)>0 && (fxDate===tradingDate||fxDate===expectedUs);
  return {usValid,fxValid,expectedUs};
}

const SCHEDULE_SLOTS = Object.freeze({
  '15 21 * * 0-4': { hour:21, minute:15, weekdays:[0,1,2,3,4], checkpoint:'NIGHT_FINAL' },
  // KRX final daily derivative data is not guaranteed by same-day 06:15.
  // At next open session 09:15 KST, retry ONLY the preceding official KRX
  // trading session; do not pretend this repairs the earlier 07:30 briefing.
  '15 0 * * 1-5': { hour:0, minute:15, weekdays:[1,2,3,4,5], checkpoint:'NIGHT_FINAL', publishedPriorSession:true },
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
    if (slot.weekdays.includes(candidate.getUTCDay()) && candidate <= now) {
      const scheduledDate=kstDate(candidate);
      if (!slot.publishedPriorSession) return scheduledDate;
      return previousKrxOpenSession(scheduledDate);
    }
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
  return { checkpoint, tradingDate, schedule, scheduledAt,
    requireKrxOfficialNight: schedule === '15 0 * * 1-5' };
}
function maskSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('***');
  return text.replace(/((?:accessToken|auth_key|apiKey|secret|token)\s*[=:]\s*)[^&\s,;]+/gi, '$1***');
}
function persistenceCounts(value) { return value ? { saved:Number(value.saved)||0, duplicates:Number(value.duplicates)||0, rejected:Number(value.rejected)||0 } : null; }
function headlessSucceeded(result) {
  if (result.sourceReadOnly === true) return result.successful === true;
  if (result.skippedDomestic === true)
    return result.checkpoint === 'KRX_FINAL'
      || (result.checkpoint === 'EVENING' && result.successful === true);
  return result.checkpoint === 'NIGHT_FINAL'
    ? result.successful === true : result.decision?.publishable === true;
}
function diagnosticFor(result, secrets = []) {
  const successful = headlessSucceeded(result);
  // A next-session provider check must never masquerade as a 15:30 release.
  if (result.sourceReadOnly === true) return {
    checkpoint:result.checkpoint, tradingDate:result.tradingDate,
    status:successful?'SOURCE_VERIFIED_NO_PUBLISH':'SOURCE_NOT_READY',
    published:false, sourceReadOnly:true, writesPerformed:0,
    officialIndexCount:result.officialIndexCount||0,
    officialStockCount:result.officialStockCount||0,
    masterPersistence:null, snapshotPersistence:null,
    restoreAllowed:false, deleteAllowed:false,
  };
  return { checkpoint:result.checkpoint, tradingDate:result.tradingDate, status:result.skippedDomestic ? (successful ? 'SKIPPED_DOMESTIC_CLOSED' : 'FOREIGN_CONTEXT_MISSING') : result.decision?.status || (successful?'COLLECTED':'NOT_READY'), published:!!result.persistence,
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
// The operational MARKET_SNAPSHOTS schema is immutable and stores an asOf
// of 15:30 KST but no actual T+1 publication/receipt timestamp. Writing a
// next-morning close through that checkpoint would create look-ahead history.
// Until publication provenance has its own reviewed schema, only verify the
// exact official source dates here. Do not hydrate, persist or release.
async function checkT1KrxOfficialReadOnly(request, tradingDate) {
  if (krxSessionStatus(tradingDate) !== 'OPEN')
    return {checkpoint:'KRX_FINAL',tradingDate,sourceReadOnly:true,successful:false,
      officialIndexCount:0,officialStockCount:0};
  const [benchResult, stockResult] = await Promise.allSettled([
    request('getBenchmarks',{benchmarks:'KOSPI,KOSDAQ',from:tradingDate,to:tradingDate,fresh:'1'},{timeoutMs:45000,retry:0}),
    request('getKrxOfficialStockCloses',{date:tradingDate,codes:'005930,000660'},{timeoutMs:45000,retry:0}),
  ]);
  const bench=benchResult.status==='fulfilled'?benchResult.value:null;
  const stock=stockResult.status==='fulfilled'?stockResult.value:null;
  const officialIndexCount=['KOSPI','KOSDAQ'].filter(key=>{
    const meta=bench?.seriesMeta?.[key], rows=bench?.series?.[key];
    return bench?.status==='ok' && meta?.confirmedClose===true
      && meta?.officialDate===tradingDate && meta?.source==='KRX_OFFICIAL'
      && Array.isArray(rows) && rows.some(row=>row?.date===tradingDate
        && row?.source==='KRX_OFFICIAL' && typeof row.value==='number'
        && Number.isFinite(row.value) && row.value>0);
  }).length;
  const officialStockCount=['005930','000660'].filter(code=>{
    const row=stock?.closes?.[code];
    return stock?.status==='ok' && stock.requestedDate===tradingDate
      && row?.code===code && row?.requestedDate===tradingDate
      && row?.usedDate===tradingDate && row?.source==='KRX_OFFICIAL'
      && ['KRX','KRX_OTP'].includes(row?.providerSource)
      && typeof row.price==='number' && Number.isFinite(row.price)
      && row.price>0 && Number.isFinite(Date.parse(row?.receivedAt||''));
  }).length;
  return {checkpoint:'KRX_FINAL',tradingDate,sourceReadOnly:true,
    successful:officialIndexCount===2 && officialStockCount===2,
    officialIndexCount,officialStockCount,persistence:null,sync:null,decision:null};
}

export async function runHeadless({ checkpoint, tradingDate, url, token, request: suppliedRequest, receivedAt,
  requireKrxOfficialNight = false, schedule = '', sourceReadOnlyT1 = false,
  fxFallback = fetchUsdKrwYahooDaily }) {
  const request = suppliedRequest || createRequest(url, token);
  if (sourceReadOnlyT1 === true) {
    if (checkpoint !== 'KRX_FINAL' || schedule) throw new Error('T1_KRX_CHECKPOINT_MISMATCH');
    return checkT1KrxOfficialReadOnly(request,tradingDate);
  }
  const runtime = globalThis.MarketBriefingRuntime, gate = globalThis.MarketBriefingOperationalGate;
  // KRX_FINAL has no same-day domestic close on exchange holidays/weekends.
  // Keep EVENING foreign/FX collection running, but do not publish a false
  // same-day KRX final. UNKNOWN dates must not be silently skipped.
  const domesticClosed = krxSessionStatus(tradingDate) === 'CLOSED';
  // 06:15 scheduled collection and MORNING consume the preceding KRX session.
  // Manual NIGHT_FINAL --date and 09:15 T+1 catch-up name the source BAS_DD
  // itself. Never shift an explicit historical recovery request backwards.
  // Unknown/closed KRX dates fail closed instead of persisting misdated prices.
  const isKrxOpen = krxSessionStatus(tradingDate)==='OPEN';
  const usePriorNight = checkpoint==='MORNING'
    || (checkpoint==='NIGHT_FINAL' && schedule==='15 21 * * 0-4');
  const nightSourceDate = checkpoint==='NIGHT_FINAL'||checkpoint==='MORNING'
    ? (isKrxOpen ? (usePriorNight ? previousKrxOpenSession(tradingDate) : tradingDate) : '')
    : '';
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
    try {
      const response = await request(action, scopedParams, options);
      // An existing but empty FX ledger is as unusable as a missing tab.
      // Fallback is strictly briefing-only and requires a verified, dated
      // Yahoo daily candle; it never writes the finance/valuation ledger.
      if (action === 'getExchangeRateHistory'
          && response?.status === 'NO_DATA'
          && Array.isArray(response.history) && response.history.length === 0)
        return fxFallback({ from:scopedParams.from, to:scopedParams.to });
      return response;
    } catch (error) {
      // Only an explicit missing source may use the dated Yahoo fallback.
      // Authentication, network and invalid-schema failures remain visible.
      if (action === 'getExchangeRateHistory' && error?.message === 'FX_MISSING_SOURCE')
        return fxFallback({ from:scopedParams.from, to:scopedParams.to });
      throw error;
    }
  };
  const sync = await runtime.syncServerMaster(scopedRequest, scopedRequest, tradingDate, { checkpoint, from:dateOffset(tradingDate, -10),
    to:benchmarkTo, benchmarkTo, fxTo, nightSourceDate,
    scheduledToleranceSeconds:300, receivedAt });
  if (domesticClosed && checkpoint === 'EVENING') {
    // Domestic Snapshot is suppressed, but the scheduled foreign-market / FX
    // collection must fail visibly when its independent sources are unavailable.
    // A VIX-only or SOX-only response is not a successful foreign-market
    // recap. Both primary US equity benchmarks are required; secondary
    // market indicators remain optional but their omissions are diagnosed.
    const {usValid:foreign,fxValid:fx}=verifiedHolidayOverseasContext(sync?.payload,tradingDate);
    return {checkpoint,tradingDate,skippedDomestic:true,successful:foreign&&fx,
      sync,decision:null,persistence:null};
  }
  if (checkpoint === 'NIGHT_FINAL') {
    const k200=sync?.payload?.K200_NIGHT;
    // The 09:15 catch-up MUST prove the actual KRX final feed for the
    // requested prior session. A stored KIS/Toss NIGHT_FINAL, a previous
    // date or even an official but partial observation cannot satisfy it.
    const officialReady=Number(k200?.value)>0 && k200?.seriesId==='K200_NIGHT'
      && k200?.source==='KRX_OFFICIAL' && k200?.sourceDate===tradingDate
      && k200?.tradingDate===tradingDate && k200?.status==='FINAL'
      && k200?.finality==='NIGHT_FINAL' && k200?.fallback!==true;
    return {checkpoint,tradingDate,sync,decision:null,persistence:null,
      successful:runtime.hasNightFinal(tradingDate) && (!requireKrxOfficialNight || officialReady)};
  }
  const decision = runtime.readiness(tradingDate, checkpoint);
  if (!decision.publishable) return { checkpoint, tradingDate, sync, decision, persistence:null };
  const released = await runtime.releaseAndPersist(request, tradingDate, checkpoint, gate.seriesForCheckpoint(checkpoint));
  return { checkpoint, tradingDate, sync, decision:released.decision, persistence:released.persistence };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runHeadless({ ...args, url:process.env.GAS_WEB_APP_URL || '', token:process.env.GAS_ACCESS_TOKEN || '' });
  const successful = headlessSucceeded(result);
  const diagnostic = diagnosticFor(result,[process.env.GAS_ACCESS_TOKEN,process.env.GAS_WEB_APP_URL]);
  console.log(JSON.stringify(diagnostic));
  if (!successful) process.exitCode = 1;
}

export { createRequest, diagnosticFor, headlessSucceeded, parseArgs, scheduledTradingDate, maskSecrets };
