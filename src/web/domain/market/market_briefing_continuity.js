(function (global) {
  'use strict';

  const CHECKPOINT = Object.freeze({
    NIGHT_FINAL: 'NIGHT_FINAL',
    MORNING: 'MORNING',
    KRX_FINAL: 'KRX_FINAL',
    AFTER_FINAL: 'AFTER_FINAL',
    EVENING: 'EVENING',
  });

  const ORDER = Object.freeze({
    NIGHT_FINAL: 1,
    MORNING: 2,
    KRX_FINAL: 3,
    AFTER_FINAL: 4,
    EVENING: 5,
  });

  function toMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function appendObservation(history, observation) {
    if (!Array.isArray(history)) throw new Error('history must be an array');
    if (!observation || !observation.seriesId || !observation.checkpoint || !observation.observedAt) {
      throw new Error('seriesId/checkpoint/observedAt are required');
    }
    if (!ORDER[observation.checkpoint]) throw new Error('unknown checkpoint');
    const observedMs = toMs(observation.observedAt);
    if (observedMs == null) throw new Error('invalid observedAt');
    const duplicate = history.some((row) =>
      row.seriesId === observation.seriesId &&
      row.checkpoint === observation.checkpoint &&
      row.observedAt === observation.observedAt
    );
    if (duplicate) return history.slice();
    return history.concat([{ ...observation }]).sort((a, b) => toMs(a.observedAt) - toMs(b.observedAt));
  }

  function latestAtOrBefore(history, seriesId, cutoff) {
    const cutoffMs = toMs(cutoff);
    if (cutoffMs == null) return null;
    return (history || [])
      .filter((row) => row.seriesId === seriesId && toMs(row.observedAt) != null && toMs(row.observedAt) <= cutoffMs)
      .sort((a, b) => toMs(b.observedAt) - toMs(a.observedAt))[0] || null;
  }

  function buildTransition(history, seriesId, tradingDate) {
    const rows = (history || [])
      .filter((row) => row.seriesId === seriesId && row.tradingDate === tradingDate)
      .slice()
      .sort((a, b) => ORDER[a.checkpoint] - ORDER[b.checkpoint] || toMs(a.observedAt) - toMs(b.observedAt));
    return rows.map((row) => ({
      checkpoint: row.checkpoint,
      observedAt: row.observedAt,
      value: row.value,
      status: row.status,
      session: row.session || null,
    }));
  }

  function storeMorningScenario(store, record) {
    if (!store || typeof store !== 'object') throw new Error('store is required');
    if (!record || !record.tradingDate || !record.createdAt || !record.scenarios) {
      throw new Error('tradingDate/createdAt/scenarios are required');
    }
    if (store[record.tradingDate]) throw new Error('morning scenario is immutable');
    return { ...store, [record.tradingDate]: JSON.parse(JSON.stringify(record)) };
  }

  function getMorningScenario(store, tradingDate) {
    return store && store[tradingDate] ? JSON.parse(JSON.stringify(store[tradingDate])) : null;
  }

  function eveningPostmortem(store, tradingDate, actual) {
    const morning = getMorningScenario(store, tradingDate);
    if (!morning) {
      return { status: 'UNCONFIRMED', reason: 'MORNING_SCENARIO_MISSING', formalHitRate: null, actual: actual || null };
    }
    return { status: 'READY', morning, actual: actual || null };
  }

  function validateContinuity(history, tradingDate) {
    const rows = (history || []).filter((row) => row.tradingDate === tradingDate);
    const issues = [];
    const bySeries = new Map();
    rows.forEach((row) => {
      const list = bySeries.get(row.seriesId) || [];
      list.push(row);
      bySeries.set(row.seriesId, list);
    });
    bySeries.forEach((list, seriesId) => {
      const sorted = list.slice().sort((a, b) => toMs(a.observedAt) - toMs(b.observedAt));
      for (let i = 1; i < sorted.length; i += 1) {
        if (toMs(sorted[i].observedAt) < toMs(sorted[i - 1].observedAt)) issues.push(`${seriesId}:TIME_ORDER`);
      }
      const keys = new Set();
      sorted.forEach((row) => {
        const key = `${row.checkpoint}|${row.observedAt}`;
        if (keys.has(key)) issues.push(`${seriesId}:DUPLICATE`);
        keys.add(key);
      });
    });
    return { ok: issues.length === 0, issues, rowCount: rows.length };
  }

  const api = {
    CHECKPOINT,
    appendObservation,
    latestAtOrBefore,
    buildTransition,
    storeMorningScenario,
    getMorningScenario,
    eveningPostmortem,
    validateContinuity,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingContinuity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
