(function (global) {
  'use strict';

  const REQUIRED_BY_CHECKPOINT = Object.freeze({
    MORNING: ['KOSPI','KOSDAQ','KOSPI200','K200_NIGHT','SPX','NDX','SOX','VIX','USDKRW'],
    KRX_FINAL: ['KOSPI','KOSDAQ','SAMSUNG','SKHYNIX'],
    AFTER_FINAL: ['SAMSUNG','SKHYNIX'],
    EVENING: ['KOSPI','KOSDAQ','USDKRW','SAMSUNG','SKHYNIX'],
  });
  const OPTIONAL_BY_CHECKPOINT = Object.freeze({
    MORNING: ['VKOSPI','DXY','UST10Y','WTI','GOLD','BTC','SAMSUNG','SKHYNIX'],
    KRX_FINAL: ['KOSPI200','VKOSPI','FOREIGN_NET','INSTITUTION_NET','BREADTH_COVERAGE','BREADTH_PARTICIPATION'],
    AFTER_FINAL: ['KRX_AFTER_TURNOVER','NXT_AFTER_TURNOVER'],
    EVENING: ['KOSPI200','K200_NIGHT'],
  });
  const KRX_FINAL_SERIES = Object.freeze(['KOSPI','KOSDAQ','SAMSUNG','SKHYNIX']);
  const KRX_SAME_DAY_SERIES = Object.freeze(['KOSPI','KOSDAQ','SAMSUNG','SKHYNIX']);

  function isRegularFinal(row, tradingDate) {
    return !!row && row.market === 'KRX' && row.session === 'REGULAR' &&
      row.status === 'FINAL' && row.finality === 'REGULAR_CLOSE' && row.tradingDate === tradingDate;
  }

  function previousWeekday(date) {
    const d = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime())) return '';
    for (let i=0;i<7;i++) {
      d.setUTCDate(d.getUTCDate()-1);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) return d.toISOString().slice(0,10);
    }
    return '';
  }

  function evaluate(masterApi, rows, tradingDate, checkpoint) {
    const required = REQUIRED_BY_CHECKPOINT[checkpoint];
    if (!required) throw new Error('unsupported checkpoint');
    const optional = OPTIONAL_BY_CHECKPOINT[checkpoint] || [];
    const snapshot = masterApi.buildBriefingSnapshot(rows || [], tradingDate, checkpoint, required.concat(optional));
    const missing = required.filter((id) => !snapshot.values[id]);
    const bad = [];
    const warnings = [];
    optional.forEach((id) => { if (!snapshot.values[id]) warnings.push(`${id}:MISSING_OPTIONAL`); });
    Object.entries(snapshot.values).forEach(([id,row]) => {
      if (!row) return;
      const target = optional.includes(id) ? warnings : bad;
      if (['FAILED','QUARANTINED','STALE'].includes(row.status)) target.push(`${id}:${row.status}`);
      const scheduledDelay = masterApi.isScheduledDelayCandidate(row, id, tradingDate, checkpoint, Date.parse(snapshot.asOf));
      if (Date.parse(row.observedAt || row.receivedAt) > Date.parse(snapshot.asOf) && !masterApi.isHistoricalFinalFallback(row, tradingDate) && !scheduledDelay) target.push(`${id}:LOOKAHEAD`);
      if (scheduledDelay) warnings.push(`${id}:SCHEDULED_DELAY_TOLERANCE`);
    });
    const k200 = snapshot.values.K200_NIGHT;
    if (checkpoint === 'MORNING' && k200 && !(k200.tradingDate === tradingDate && k200.session === 'NIGHT' && k200.status === 'FINAL' && k200.finality === 'NIGHT_FINAL')) bad.push('K200_NIGHT:NOT_FINAL');
    if (checkpoint === 'EVENING' && k200 && k200.status === 'FINAL' && k200.tradingDate === tradingDate) warnings.push('K200_NIGHT:COMPLETED_NIGHT_FINAL');
    if (checkpoint === 'MORNING') {
      // 기존 master에서 오래된 FINAL이 PARTIAL보다 우선 선택되더라도
      // 실제 최근 거래일 관측과 비교하여 stale 종가를 발행하지 않습니다.
      const nearestWeekday = previousWeekday(tradingDate);
      ['KOSPI','KOSDAQ'].forEach((id) => {
        const row = snapshot.values[id];
        if (!row) return;
        if (!(row.market === 'KRX' && row.session === 'REGULAR'
            && row.source === 'KRX_OFFICIAL' && row.status === 'FINAL'
            && row.finality === 'REGULAR_CLOSE' && row.tradingDate < tradingDate)) {
          bad.push(`${id}:NOT_CONFIRMED_PREVIOUS_REGULAR_CLOSE`);
          return;
        }
        const latestKnown = (rows || []).filter((item) => item && item.seriesId === id
          && item.tradingDate < tradingDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(item.tradingDate))
          .reduce((latest,item) => item.tradingDate > latest ? item.tradingDate : latest, '');
        if (latestKnown > row.tradingDate) {
          bad.push(`${id}:STALE_OFFICIAL_CLOSE`);
        } else if (nearestWeekday && row.tradingDate < nearestWeekday
          && row.quality !== 'KRX_VERIFIED_EMPTY_OR_CLOSED_GAP') {
          // 예상 직전 평일보다 오래된 값은 수신일 사이 비거래 증거 없으면 거부.
          bad.push(`${id}:UNVERIFIED_CLOSE_DATE_GAP`);
        } else if (row.quality === 'KRX_VERIFIED_EMPTY_OR_CLOSED_GAP') {
          warnings.push(`${id}:KRX_CONFIRMED_DATA_GAP`);
        }
      });
    }
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

  function seriesForCheckpoint(checkpoint) {
    return (REQUIRED_BY_CHECKPOINT[checkpoint] || []).concat(OPTIONAL_BY_CHECKPOINT[checkpoint] || []);
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

  const api={REQUIRED_BY_CHECKPOINT,OPTIONAL_BY_CHECKPOINT,KRX_FINAL_SERIES,KRX_SAME_DAY_SERIES,seriesForCheckpoint,isRegularFinal,evaluate,continuity,releaseDecision};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  global.MarketBriefingOperationalGate=api;
})(typeof globalThis!=='undefined'?globalThis:this);
