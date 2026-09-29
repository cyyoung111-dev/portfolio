(function (global) {
  'use strict';

  const CHECKPOINT_TIME = Object.freeze({
    NIGHT_FINAL: '06:00:00',
    MORNING: '07:30:00',
    KRX_FINAL: '15:30:00',
    AFTER_FINAL: '20:00:00',
    EVENING: '20:15:00',
  });

  const SERIES_POLICY = Object.freeze({
    K200_NIGHT: { morning: 'FINAL', evening: 'LIVE' },
    KRX_REGULAR: { morning: 'PRIOR_FINAL', evening: 'FINAL' },
    KRX_AFTER: { morning: 'PRIOR_FINAL', evening: 'FINAL' },
    NXT_AFTER: { morning: 'PRIOR_FINAL', evening: 'FINAL' },
    US_FUTURES_FREE: { morning: 'DELAYED', evening: 'DELAYED' },
  });

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function checkpointAt(tradingDate, checkpoint, offset = '+09:00') {
    if (!validDate(tradingDate) || !CHECKPOINT_TIME[checkpoint]) throw new Error('invalid tradingDate/checkpoint');
    return `${tradingDate}T${CHECKPOINT_TIME[checkpoint]}${offset}`;
  }

  function checkpointForTime(time) {
    const value = String(time || '').slice(0, 8);
    if (!/^\d{2}:\d{2}:\d{2}$/.test(value)) throw new Error('invalid checkpoint time');
    if (value >= CHECKPOINT_TIME.EVENING) return 'EVENING';
    if (value >= CHECKPOINT_TIME.AFTER_FINAL) return 'AFTER_FINAL';
    if (value >= CHECKPOINT_TIME.KRX_FINAL) return 'KRX_FINAL';
    if (value >= CHECKPOINT_TIME.MORNING) return 'MORNING';
    return 'NIGHT_FINAL';
  }

  function currentCheckpoint(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return checkpointForTime(`${values.hour}:${values.minute}:${values.second}`);
  }

  function normalizeObservation(input) {
    if (!input || !input.seriesId || !validDate(input.tradingDate)) throw new Error('seriesId/tradingDate are required');
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('value must be finite');
    const receivedMs = Date.parse(input.receivedAt || '');
    const observedMs = input.observedAt ? Date.parse(input.observedAt) : null;
    if (!Number.isFinite(receivedMs)) throw new Error('receivedAt is required');
    if (input.observedAt && !Number.isFinite(observedMs)) throw new Error('invalid observedAt');
    if (Number.isFinite(observedMs) && observedMs > receivedMs) throw new Error('observedAt must not be after receivedAt');
    const observedAt = Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null;
    const receivedAt = new Date(receivedMs).toISOString();
    return {
      seriesId: String(input.seriesId), tradingDate: input.tradingDate, value,
      market: input.market || 'UNKNOWN', session: input.session || 'UNKNOWN', source: input.source || 'UNKNOWN',
      status: input.status || 'PARTIAL', finality: input.finality || null,
      currency: input.currency || null,
      sourceDate: validDate(input.sourceDate) ? input.sourceDate : null,
      fallback: input.fallback === true,
      observedAt, receivedAt,
      timestampQuality: observedAt ? 'OBSERVED' : 'RECEIVE_ONLY',
      lagSeconds: observedAt ? Math.round((receivedMs - observedMs) / 1000) : null,
      revision: Number.isInteger(input.revision) ? input.revision : 0,
      quality: input.quality || null,
    };
  }

  function upsertObservation(master, input) {
    const row = normalizeObservation(input);
    const rows = Array.isArray(master) ? master.slice() : [];
    const same = (item) => item.seriesId === row.seriesId && item.tradingDate === row.tradingDate &&
      item.session === row.session && item.observedAt === row.observedAt && item.receivedAt === row.receivedAt;
    if (rows.some(same)) return rows;
    rows.push(row);
    return rows.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  }

  function isHistoricalFinalFallback(row, targetTradingDate) {
    return !!row && validDate(targetTradingDate) && validDate(row.sourceDate) && row.sourceDate < targetTradingDate &&
      row.status === 'FINAL' && (row.finality === 'REGULAR_CLOSE' || row.finality === 'HISTORICAL_CLOSE');
  }

  const MORNING_PRIOR_FINAL = Object.freeze(['KOSPI', 'KOSDAQ', 'KOSPI200']);

  function isSameDayCandidate(row, seriesId, targetTradingDate, checkpoint, cutoff) {
    if (!row || row.tradingDate !== targetTradingDate) return false;
    if (checkpoint === 'MORNING' && MORNING_PRIOR_FINAL.includes(seriesId)) return false;
    return Date.parse(row.observedAt || row.receivedAt) <= cutoff;
  }

  function selectAt(master, seriesId, cutoffAt, targetTradingDate, checkpoint) {
    const cutoff = Date.parse(cutoffAt || '');
    if (!Number.isFinite(cutoff)) return null;
    const rows = (master || []).filter((row) => row.seriesId === seriesId);
    if (!validDate(targetTradingDate)) return rows
      .filter((row) => Date.parse(row.observedAt || row.receivedAt) <= cutoff)
      .sort((a, b) => Date.parse(b.observedAt || b.receivedAt) - Date.parse(a.observedAt || a.receivedAt))[0] || null;
    const sameDay = rows.filter((row) => isSameDayCandidate(row, seriesId, targetTradingDate, checkpoint, cutoff))
      .sort((a, b) => Date.parse(b.observedAt || b.receivedAt) - Date.parse(a.observedAt || a.receivedAt))[0] || null;
    if (sameDay) return sameDay;
    return rows.filter((row) => isHistoricalFinalFallback(row, targetTradingDate))
      .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate) || Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0] || null;
  }

  function buildBriefingSnapshot(master, tradingDate, checkpoint, seriesIds) {
    const asOf = checkpointAt(tradingDate, checkpoint);
    const values = {};
    (seriesIds || []).forEach((seriesId) => { values[seriesId] = selectAt(master, seriesId, asOf, tradingDate, checkpoint); });
    return { tradingDate, checkpoint, asOf, values };
  }

  function bridgeBriefings(master, tradingDate, seriesIds) {
    return {
      nightFinal: buildBriefingSnapshot(master, tradingDate, 'NIGHT_FINAL', seriesIds),
      morning: buildBriefingSnapshot(master, tradingDate, 'MORNING', seriesIds),
      krxFinal: buildBriefingSnapshot(master, tradingDate, 'KRX_FINAL', seriesIds),
      afterFinal: buildBriefingSnapshot(master, tradingDate, 'AFTER_FINAL', seriesIds),
      evening: buildBriefingSnapshot(master, tradingDate, 'EVENING', seriesIds),
    };
  }

  function validateSnapshot(snapshot) {
    const issues = [];
    Object.entries(snapshot?.values || {}).forEach(([seriesId, row]) => {
      if (!row) issues.push(`${seriesId}:MISSING`);
      else if (Date.parse(row.observedAt || row.receivedAt) > Date.parse(snapshot.asOf) && !isHistoricalFinalFallback(row, snapshot.tradingDate)) issues.push(`${seriesId}:LOOKAHEAD`);
      else if (row.timestampQuality === 'RECEIVE_ONLY' && row.observedAt) issues.push(`${seriesId}:TIMESTAMP_QUALITY`);
    });
    return { ok: issues.length === 0, issues };
  }

  const api = { CHECKPOINT_TIME, SERIES_POLICY, MORNING_PRIOR_FINAL, checkpointAt, checkpointForTime, currentCheckpoint, normalizeObservation, upsertObservation, isHistoricalFinalFallback, isSameDayCandidate, selectAt, buildBriefingSnapshot, bridgeBriefings, validateSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingMaster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
