(function (global) {
  'use strict';

  const REQUIRED_BY_CHECKPOINT = Object.freeze({
    MORNING: ['KOSPI','KOSDAQ','KOSPI200','K200_NIGHT','SPX','NDX','SOX','VIX','USDKRW'],
    KRX_FINAL: ['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX','FOREIGN_NET','INSTITUTION_NET','BREADTH_COVERAGE','BREADTH_PARTICIPATION'],
    AFTER_FINAL: ['SAMSUNG','SKHYNIX','KRX_AFTER_TURNOVER','NXT_AFTER_TURNOVER'],
    EVENING: ['KOSPI','KOSDAQ','KOSPI200','K200_NIGHT','USDKRW','SAMSUNG','SKHYNIX'],
  });

  function evaluate(masterApi, rows, tradingDate, checkpoint) {
    const required = REQUIRED_BY_CHECKPOINT[checkpoint];
    if (!required) throw new Error('unsupported checkpoint');
    const snapshot = masterApi.buildBriefingSnapshot(rows || [], tradingDate, checkpoint, required);
    const missing = required.filter((id) => !snapshot.values[id]);
    const bad = [];
    Object.entries(snapshot.values).forEach(([id,row]) => {
      if (!row) return;
      if (['FAILED','QUARANTINED','STALE'].includes(row.status)) bad.push(`${id}:${row.status}`);
      if (Date.parse(row.observedAt || row.receivedAt) > Date.parse(snapshot.asOf)) bad.push(`${id}:LOOKAHEAD`);
    });
    const k200 = snapshot.values.K200_NIGHT;
    if (checkpoint === 'MORNING' && k200 && !(k200.session === 'NIGHT' && k200.status === 'FINAL')) bad.push('K200_NIGHT:NOT_FINAL');
    if (checkpoint === 'EVENING' && k200 && k200.status === 'FINAL') bad.push('K200_NIGHT:FALSE_FINAL');
    return { checkpoint, tradingDate, asOf:snapshot.asOf, ready:missing.length===0 && bad.length===0, missing, issues:bad, snapshot };
  }

  function continuity(snapshotStoreApi, store, tradingDate, checkpoint) {
    if (checkpoint === 'MORNING') {
      const prior = snapshotStoreApi.previousEveningContext(store || [], tradingDate);
      return { priorEvening: prior, connected: !!prior };
    }
    if (checkpoint === 'EVENING') {
      const morning = snapshotStoreApi.getSnapshot(store || [], tradingDate, 'MORNING');
      return { morning, connected: !!morning, formalHitRate: !!(morning && morning.scenario != null) };
    }
    return { connected: true };
  }

  function releaseDecision(masterApi, snapshotStoreApi, rows, store, tradingDate, checkpoint) {
    const data = evaluate(masterApi, rows, tradingDate, checkpoint);
    const link = continuity(snapshotStoreApi, store, tradingDate, checkpoint);
    const blocked = !data.ready;
    return {
      publishable: !blocked,
      status: blocked ? 'NOT_READY' : (link.connected ? 'READY' : 'READY_WITH_CONTEXT_GAP'),
      data,
      continuity: link,
    };
  }

  const api={REQUIRED_BY_CHECKPOINT,evaluate,continuity,releaseDecision};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  global.MarketBriefingOperationalGate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
