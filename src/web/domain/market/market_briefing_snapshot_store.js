(function (global) {
  'use strict';

  const CHECKPOINT_ORDER = Object.freeze(['NIGHT_FINAL', 'MORNING', 'KRX_FINAL', 'AFTER_FINAL', 'EVENING']);

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function stableClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshotKey(tradingDate, checkpoint) {
    if (!validDate(tradingDate) || !CHECKPOINT_ORDER.includes(checkpoint)) throw new Error('invalid tradingDate/checkpoint');
    return `${tradingDate}:${checkpoint}`;
  }

  function appendSnapshot(store, snapshot, meta = {}) {
    if (!snapshot || !validDate(snapshot.tradingDate) || !CHECKPOINT_ORDER.includes(snapshot.checkpoint)) throw new Error('invalid snapshot');
    const rows = Array.isArray(store) ? store.slice() : [];
    const key = snapshotKey(snapshot.tradingDate, snapshot.checkpoint);
    const existing = rows.find((row) => row.key === key);
    if (existing) return rows;
    rows.push({
      key,
      tradingDate: snapshot.tradingDate,
      checkpoint: snapshot.checkpoint,
      asOf: snapshot.asOf || null,
      values: stableClone(snapshot.values || {}),
      scenario: meta.scenario == null ? null : stableClone(meta.scenario),
      createdAt: meta.createdAt || snapshot.asOf || null,
      sourceRevision: meta.sourceRevision || null,
    });
    return rows.sort((a, b) => {
      if (a.tradingDate !== b.tradingDate) return a.tradingDate.localeCompare(b.tradingDate);
      return CHECKPOINT_ORDER.indexOf(a.checkpoint) - CHECKPOINT_ORDER.indexOf(b.checkpoint);
    });
  }

  function getSnapshot(store, tradingDate, checkpoint) {
    const key = snapshotKey(tradingDate, checkpoint);
    const row = (store || []).find((item) => item.key === key);
    return row ? stableClone(row) : null;
  }

  function morningScenario(store, tradingDate) {
    const morning = getSnapshot(store, tradingDate, 'MORNING');
    return morning && morning.scenario != null ? stableClone(morning.scenario) : null;
  }

  function eveningPostmortem(store, tradingDate, eveningSnapshot, meta = {}) {
    const morning = getSnapshot(store, tradingDate, 'MORNING');
    const formalHitRate = Boolean(morning && morning.scenario != null);
    const nextStore = appendSnapshot(store, eveningSnapshot, {
      ...meta,
      scenario: {
        morningScenario: formalHitRate ? stableClone(morning.scenario) : null,
        evaluationStatus: formalHitRate ? 'READY' : 'UNCONFIRMED',
        formalHitRate,
      },
    });
    return {
      store: nextStore,
      evaluationStatus: formalHitRate ? 'READY' : 'UNCONFIRMED',
      formalHitRate,
      morningScenario: formalHitRate ? stableClone(morning.scenario) : null,
    };
  }

  function previousEveningContext(store, tradingDate) {
    const candidates = (store || []).filter((row) => row.checkpoint === 'EVENING' && row.tradingDate < tradingDate);
    candidates.sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));
    return candidates.length ? stableClone(candidates[0]) : null;
  }

  const api = { CHECKPOINT_ORDER, snapshotKey, appendSnapshot, getSnapshot, morningScenario, eveningPostmortem, previousEveningContext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingSnapshotStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
