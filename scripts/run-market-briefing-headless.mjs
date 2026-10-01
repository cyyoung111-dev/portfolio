#!/usr/bin/env node
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
const SCHEDULES = {
  '15 21 * * 0-4': { checkpoint:'NIGHT_FINAL', hour:21, minute:15, days:[0,1,2,3,4] },
  '30 22 * * 0-4': { checkpoint:'MORNING', hour:22, minute:30, days:[0,1,2,3,4] },
  '5 7 * * 1-5': { checkpoint:'KRX_FINAL', hour:7, minute:5, days:[1,2,3,4,5] },
  '15 11 * * 1-5': { checkpoint:'EVENING', hour:11, minute:15, days:[1,2,3,4,5] },
};
function scheduledDate(schedule, checkpoint, now) {
  const slot = SCHEDULES[schedule];
  if (!slot || slot.checkpoint !== checkpoint) throw new Error('예약 checkpoint 불일치');
  // 지연 실행도 가장 최근 예약 시각의 KST 거래일을 유지한다.
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(now);
    candidate.setUTCDate(candidate.getUTCDate() - offset);
    candidate.setUTCHours(slot.hour, slot.minute, 0, 0);
    if (slot.days.includes(candidate.getUTCDay()) && candidate <= now) return kstDate(candidate);
  }
  throw new Error('예약 거래일을 결정할 수 없습니다.');
}
function parseArgs(argv, now = new Date()) {
  const checkpoint = String(argv[argv.indexOf('--checkpoint') + 1] || '').toUpperCase();
  const suppliedDate = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : '';
  if (!ALLOWED.has(checkpoint)) throw new Error('지원하지 않는 checkpoint');
  const schedule = argv.includes('--schedule') ? argv[argv.indexOf('--schedule') + 1] : '';
  const tradingDate = suppliedDate || (schedule ? scheduledDate(schedule, checkpoint, now) : kstDate(now));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate) || !Number.isFinite(Date.parse(tradingDate)) || new Date(tradingDate).toISOString().slice(0,10) !== tradingDate) throw new Error('잘못된 tradingDate');
  return { checkpoint, tradingDate };
}
function createRequest(url, token, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url)) throw new Error('GAS_WEB_APP_URL은 HTTPS여야 합니다.');
  return async (action, params = {}) => {
    const form = new URLSearchParams({ action, ...params });
    if (token) form.set('accessToken', token);
    const response = await fetchImpl(url, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded;charset=UTF-8' }, body:form, redirect:'follow' });
    if (!response.ok) throw new Error(`GAS_HTTP_${response.status}`);
    const result = await response.json();
    // 배포된 GAS의 환율 API는 데이터 상태를 최상위 status로 반환한다.
    if (action === 'getExchangeRateHistory' && result && result.status !== 'ok') {
      if (['CONFIRMED','NO_DATA'].includes(result.status) && Array.isArray(result.history)) return { ...result, status:'ok', dataStatus:result.status };
      if (['MISSING_SOURCE','INVALID_SCHEMA'].includes(result.status)) throw new Error(`FX_HISTORY_${result.status}`);
    }
    if (!result || result.status !== 'ok') throw new Error(String(result?.message || 'GAS_RESPONSE_ERROR'));
    return result;
  };
}
function diagnosticFor(result, token = '') {
  const successful = result.checkpoint === 'NIGHT_FINAL' ? result.successful : result.decision?.publishable === true;
  const redact = value => {
    let message = String(value);
    if (token) message = message.split(token).join('[REDACTED]');
    return message.replace(/(accessToken|auth_key|apiKey|secret|token)([=:\s]+)[^&\s"',}]+/gi, '$1$2[REDACTED]');
  };
  const counts = value => value ? { saved:value.saved, duplicates:value.duplicates, rejected:value.rejected } : null;
  return { checkpoint:result.checkpoint, tradingDate:result.tradingDate, status:result.decision?.status || (successful?'COLLECTED':'NOT_READY'), published:!!result.persistence,
    missing:result.decision?.data?.missing || result.sync?.missing || [], issues:result.decision?.data?.issues || [],
    providerErrors:Object.keys(result.sync?.errors || {}), providerErrorDetails:Object.fromEntries(Object.entries(result.sync?.errors || {}).map(([key,value]) => [key,redact(value)])),
    masterPersistence:counts(result.sync?.persistence), snapshotPersistence:counts(result.persistence),
    readinessSeries:result.decision?.data?.snapshot?.values || {}, warnings:result.decision?.data?.warnings || [] };
}
export async function runHeadless({ checkpoint, tradingDate, url, token, request: suppliedRequest, receivedAt }) {
  const request = suppliedRequest || createRequest(url, token);
  const runtime = globalThis.MarketBriefingRuntime, gate = globalThis.MarketBriefingOperationalGate;
  const sync = await runtime.syncServerMaster(request, request, tradingDate, { checkpoint, from:dateOffset(tradingDate, -10), scheduledToleranceSeconds:300, receivedAt });
  if (checkpoint === 'NIGHT_FINAL') return { checkpoint, tradingDate, sync, decision:null, persistence:null, successful:runtime.hasNightFinal(tradingDate) };
  const decision = runtime.readiness(tradingDate, checkpoint);
  if (!decision.publishable) return { checkpoint, tradingDate, sync, decision, persistence:null };
  const released = await runtime.releaseAndPersist(request, tradingDate, checkpoint, gate.seriesForCheckpoint(checkpoint));
  return { checkpoint, tradingDate, sync, decision:released.decision, persistence:released.persistence };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runHeadless({ ...args, url:process.env.GAS_WEB_APP_URL || '', token:process.env.GAS_ACCESS_TOKEN || '' });
  const successful = result.checkpoint === 'NIGHT_FINAL' ? result.successful : result.decision?.publishable === true;
  const diagnostic = diagnosticFor(result, process.env.GAS_ACCESS_TOKEN || '');
  console.log(JSON.stringify(diagnostic));
  if (!successful) process.exitCode = 1;
}

export { createRequest, parseArgs, diagnosticFor };
