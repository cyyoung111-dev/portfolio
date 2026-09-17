(function (global) {
  'use strict';

  const REQUIRED = Object.freeze([
    'KOSPI', 'KOSDAQ', 'KOSPI200', 'K200_NIGHT',
    'SPX', 'NDX', 'SOX', 'VIX', 'USDKRW',
  ]);
  const IMPORTANT = Object.freeze([
    'SAMSUNG', 'SKHYNIX', 'NVDA', 'MU', 'DXY',
    'UST2Y', 'UST10Y', 'WTI', 'GOLD', 'BTC',
    'FOREIGN_NET', 'INSTITUTION_NET', 'PROGRAM_NET',
    'BREADTH_COVERAGE', 'BREADTH_PARTICIPATION',
  ]);

  function assess(masterApi, rows, tradingDate) {
    if (!masterApi || typeof masterApi.buildBriefingSnapshot !== 'function') throw new Error('MarketBriefingMaster required');
    const ids = [...REQUIRED, ...IMPORTANT];
    const snapshot = masterApi.buildBriefingSnapshot(rows || [], tradingDate, 'MORNING', ids);
    const missingRequired = REQUIRED.filter((id) => !snapshot.values[id]);
    const missingImportant = IMPORTANT.filter((id) => !snapshot.values[id]);
    const delayed = ids.filter((id) => snapshot.values[id]?.status === 'DELAYED');
    const stale = ids.filter((id) => snapshot.values[id]?.status === 'STALE');
    const receiveOnly = ids.filter((id) => snapshot.values[id]?.timestampQuality === 'RECEIVE_ONLY');
    const k200 = snapshot.values.K200_NIGHT;
    const k200Final = !!k200 && k200.status === 'FINAL' && k200.session === 'NIGHT';
    return {
      tradingDate,
      asOf: snapshot.asOf,
      ready: missingRequired.length === 0 && k200Final,
      missingRequired,
      missingImportant,
      delayed,
      stale,
      receiveOnly,
      k200Final,
      snapshot,
    };
  }

  function qcLabel(result) {
    if (!result) return 'FAILED';
    if (result.ready && !result.missingImportant.length && !result.stale.length) return 'PASS';
    if (result.ready) return 'PARTIAL';
    return 'NOT_READY';
  }

  const api = { REQUIRED, IMPORTANT, assess, qcLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MorningBriefingReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
