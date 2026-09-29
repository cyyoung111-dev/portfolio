(function (global) {
  'use strict';

  const REQUIRED_BY_CHECKPOINT = Object.freeze({
    MORNING: ['KOSPI','KOSDAQ','KOSPI200','K200_NIGHT','SPX','NDX','SOX','VIX','USDKRW'],
    KRX_FINAL: ['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX','FOREIGN_NET','INSTITUTION_NET','BREADTH_COVERAGE','BREADTH_PARTICIPATION'],
    AFTER_FINAL: ['SAMSUNG','SKHYNIX','KRX_AFTER_TURNOVER','NXT_AFTER_TURNOVER'],
    EVENING: ['KOSPI','KOSDAQ','KOSPI200','K200_NIGHT','USDKRW','SAMSUNG','SKHYNIX'],
  });
  const KRX_FINAL_SERIES = Object.freeze(['KOSPI','KOSDAQ','SAMSUNG','SKHYNIX']);
  const KRX_SAME_DAY_SERIES = Object.freeze(['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX']);

  function isRegularFinal(row, tradingDate) {
    return !!row && row.market === 'KRX' && row.session === 'REGULAR' &&
      row.status === 'FINAL' && row.finality === 'REGULAR_CLOSE' && row.tradingDate === tradingDate;
  }

  function evaluate(masterApi, rows, tradingDate, checkpoint) {
    const required = REQUIRED_BY_CHECKPOINT[checkpoint];
    if (!required) throw new Error('unsupported checkpoint');
    const snapshot = masterApi.buildBriefingSnapshot(rows || [], tradingDate, checkpoint, required);
    const missing = required.filter((id) => !snapshot.values[id]);
    const bad = [];
    const warnings = [];
    Object.entries(snapshot.values).forEach(([id,row]) => {
      if (!row) return;
      if (['FAILED','QUARANTINED','STALE'].includes(row.status)) bad.push(`${id}:${row.status}`);
      if (Date.parse(row.observedAt || row.receivedAt) > Date.parse(snapshot.asOf)) bad.push(`${id}:LOOKAHEAD`);
    });
    const k200 = snapshot.values.K200_NIGHT;
    if (checkpoint === 'MORNING' && k200 && !(k200.session === 'NIGHT' && k200.status === 'FINAL' && k200.finality === 'NIGHT_FINAL')) bad.push('K200_NIGHT:NOT_FINAL');
    if (checkpoint === 'EVENING' && k200 && k200.status === 'FINAL') bad.push('K200_NIGHT:FALSE_FINAL');
    if (checkpoint === 'KRX_FINAL' || checkpoint === 'EVENING') {
      KRX_SAME_DAY_SERIES.forEach((id) => {
        const row = snapshot.values[id];
        if (row && row.tradingDate !== tradingDate) bad.push(`${id}:TRADING_DATE_MISMATCH`);
      });
      KRX_FINAL_SERIES.forEach((id) => {
        const row = snapshot.values[id];
        if (row && !isRegularFinal(row, tradingDate)) bad.push(`${id}:NOT_REGULAR_FINAL`);
      });
      const k200Regular = snapshot.values.KOSPI200;
      if (k200Regular && k200Regular.status === 'DELAYED') warnings.push('KOSPI200:DELAYED_AUXILIARY');
    }
    if (checkpoint === 'AFTER_FINAL') {
      ['SAMSUNG','SKHYNIX'].forEach((id) => {
        const row = snapshot.values[id];
        if (row && !isRegularFinal(row, tradingDate)) bad.push(`${id}:NOT_REGULAR_FINAL`);
      });
    }
    return { checkpoint, tradingDate, asOf:snapshot.asOf, ready:missing.length===0 && bad.length===0, missing, issues:bad, warnings, snapshot };
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

  const api={REQUIRED_BY_CHECKPOINT,KRX_FINAL_SERIES,KRX_SAME_DAY_SERIES,isRegularFinal,evaluate,continuity,releaseDecision};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  global.MarketBriefingOperationalGate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
