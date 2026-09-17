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

  function normalizeObservation(input) {
    if (!input || !input.seriesId || !validDate(input.tradingDate)) throw new Error('seriesId/tradingDate are required');
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('value must be finite');
    const observedAt = input.observedAt || null;
    const receivedAt = input.receivedAt || null;
    if (!receivedAt || !Number.isFinite(Date.parse(receivedAt))) throw new Error('receivedAt is required');
    if (observedAt && !Number.isFinite(Date.parse(observedAt))) throw new Error('invalid observedAt');
    return {
      seriesId: String(input.seriesId), tradingDate: input.tradingDate, value,
      market: input.market || 'UNKNOWN', session: input.session || 'UNKNOWN', source: input.source || 'UNKNOWN',
      status: input.status || 'PARTIAL', finality: input.finality || null,
      observedAt, receivedAt,
      timestampQuality: observedAt ? 'OBSERVED' : 'RECEIVE_ONLY',
      lagSeconds: observedAt ? Math.max(0, Math.round((Date.parse(receivedAt) - Date.parse(observedAt)) / 1000)) : null,
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

  function selectAt(master, seriesId, cutoffAt) {
    const cutoff = Date.parse(cutoffAt || '');
    if (!Number.isFinite(cutoff)) return null;
    return (master || []).filter((row) => row.seriesId === seriesId)
      .filter((row) => Date.parse(row.observedAt || row.receivedAt) <= cutoff)
      .sort((a, b) => Date.parse(b.observedAt || b.receivedAt) - Date.parse(a.observedAt || a.receivedAt))[0] || null;
  }

  function buildBriefingSnapshot(master, tradingDate, checkpoint, seriesIds) {
    const asOf = checkpointAt(tradingDate, checkpoint);
    const values = {};
    (seriesIds || []).forEach((seriesId) => { values[seriesId] = selectAt(master, seriesId, asOf); });
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
      else if (Date.parse(row.observedAt || row.receivedAt) > Date.parse(snapshot.asOf)) issues.push(`${seriesId}:LOOKAHEAD`);
      else if (row.timestampQuality === 'RECEIVE_ONLY' && row.observedAt) issues.push(`${seriesId}:TIMESTAMP_QUALITY`);
    });
    return { ok: issues.length === 0, issues };
  }

  const api = { CHECKPOINT_TIME, SERIES_POLICY, checkpointAt, normalizeObservation, upsertObservation, selectAt, buildBriefingSnapshot, bridgeBriefings, validateSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingMaster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
