(function (global) {
  'use strict';

  const REQUIRED = Object.freeze([
    'KOSPI', 'KOSDAQ', 'KOSPI200', 'K200_NIGHT',
    'SPX', 'NDX', 'SOX', 'VIX', 'USDKRW',
  ]);
  const IMPORTANT = Object.freeze([
    'SAMSUNG', 'SKHYNIX', 'VKOSPI', 'DXY',
    'UST10Y', 'WTI', 'GOLD', 'BTC',
  ]);
  // 현재 저장소에서 실제 provider가 검증되지 않은 항목은 readiness 결손으로 계산하지 않습니다.
  // 특히 2년물 선물(ZT=F)을 현물 UST2Y 수익률로 오표기하지 않습니다.
  const PLANNED = Object.freeze([
    'UST2Y', 'NVDA', 'MU',
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
    const k200Final = !!k200 && k200.tradingDate === tradingDate &&
      k200.status === 'FINAL' && k200.session === 'NIGHT' && k200.finality === 'NIGHT_FINAL';
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
      planned: PLANNED.slice(),
      snapshot,
    };
  }

  function qcLabel(result) {
    if (!result) return 'FAILED';
    if (result.ready && !result.missingImportant.length && !result.stale.length) return 'PASS';
    if (result.ready) return 'PARTIAL';
    return 'NOT_READY';
  }

  const api = { REQUIRED, IMPORTANT, PLANNED, assess, qcLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MorningBriefingReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
