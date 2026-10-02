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
const SCHEDULE_SLOTS = Object.freeze({
  '15 21 * * 0-4': { hour:21, minute:15, weekdays:[0,1,2,3,4] },
  '30 22 * * 0-4': { hour:22, minute:30, weekdays:[0,1,2,3,4] },
  '5 7 * * 1-5': { hour:7, minute:5, weekdays:[1,2,3,4,5] },
  '15 11 * * 1-5': { hour:11, minute:15, weekdays:[1,2,3,4,5] },
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
  if (!ALLOWED.has(checkpoint)) throw new Error('지원하지 않는 checkpoint');
  const tradingDate = suppliedDate || (schedule ? scheduledTradingDate(schedule) : kstDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) throw new Error('잘못된 tradingDate');
  return { checkpoint, tradingDate, schedule };
}
function maskSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('***');
  return text.replace(/(accessToken=)[^&\s]+/gi, '$1***');
}
function createRequest(url, token, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url)) throw new Error('GAS_WEB_APP_URL은 HTTPS여야 합니다.');
  return async (action, params = {}) => {
    const form = new URLSearchParams({ action, ...params });
    if (token) form.set('accessToken', token);
    const response = await fetchImpl(url, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded;charset=UTF-8' }, body:form, redirect:'follow' });
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
export async function runHeadless({ checkpoint, tradingDate, url, token, request: suppliedRequest, receivedAt }) {
  const request = suppliedRequest || createRequest(url, token);
  const runtime = globalThis.MarketBriefingRuntime, gate = globalThis.MarketBriefingOperationalGate;
  const sync = await runtime.syncServerMaster(request, request, tradingDate, { checkpoint, from:dateOffset(tradingDate, -10),
    to:checkpoint === 'MORNING' ? dateOffset(tradingDate, -1) : tradingDate, scheduledToleranceSeconds:300, receivedAt });
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
  const diagnostic = { checkpoint:result.checkpoint, tradingDate:result.tradingDate, status:result.decision?.status || (successful?'COLLECTED':'NOT_READY'), published:!!result.persistence, missing:result.decision?.data?.missing || result.sync?.missing || [], issues:result.decision?.data?.issues || [], providerErrors:Object.fromEntries(Object.entries(result.sync?.errors || {}).map(([key,value])=>[key,maskSecrets(value,[process.env.GAS_ACCESS_TOKEN,process.env.GAS_WEB_APP_URL])])) };
  console.log(JSON.stringify(diagnostic));
  if (!successful) process.exitCode = 1;
}

export { createRequest, parseArgs, scheduledTradingDate, maskSecrets };
