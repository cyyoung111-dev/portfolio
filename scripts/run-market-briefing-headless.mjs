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
function parseArgs(argv) {
  const checkpoint = String(argv[argv.indexOf('--checkpoint') + 1] || '').toUpperCase();
  const suppliedDate = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : '';
  if (!ALLOWED.has(checkpoint)) throw new Error('지원하지 않는 checkpoint');
  const tradingDate = suppliedDate || kstDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) throw new Error('잘못된 tradingDate');
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
    if (!result || result.status !== 'ok') throw new Error(String(result?.message || 'GAS_RESPONSE_ERROR'));
    return result;
  };
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
  const diagnostic = { checkpoint:result.checkpoint, tradingDate:result.tradingDate, status:result.decision?.status || (successful?'COLLECTED':'NOT_READY'), published:!!result.persistence, missing:result.decision?.data?.missing || result.sync?.missing || [], issues:result.decision?.data?.issues || [], providerErrors:Object.keys(result.sync?.errors || {}) };
  console.log(JSON.stringify(diagnostic));
  if (!successful) process.exitCode = 1;
}

export { createRequest, parseArgs };
