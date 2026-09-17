(function (global) {
  'use strict';

  const SERIES = Object.freeze({
    BREADTH_AD_LINE: 'BREADTH_AD_LINE',
    BREADTH_ADR20: 'BREADTH_ADR20',
    BREADTH_COVERAGE: 'BREADTH_COVERAGE',
    BREADTH_PARTICIPATION: 'BREADTH_PARTICIPATION',
    FOREIGN_NET: 'FOREIGN_NET',
    INSTITUTION_NET: 'INSTITUTION_NET',
    PROGRAM_NET: 'PROGRAM_NET',
    K200_NIGHT: 'K200_NIGHT',
    KRX_AFTER_TURNOVER: 'KRX_AFTER_TURNOVER',
    NXT_AFTER_TURNOVER: 'NXT_AFTER_TURNOVER',
    SKHY_ADR_GAP: 'SKHY_ADR_GAP',
  });

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${name} must be finite`);
    return number;
  }

  function classifyBreadthSymbol(row) {
    if (!row || row.listed === false) return 'UNLISTED';
    if (row.missing === true) return 'MISSING';
    const open = Number(row.open || 0);
    const high = Number(row.high || 0);
    const low = Number(row.low || 0);
    const volume = Number(row.volume || 0);
    const turnover = Number(row.turnover || 0);
    if (open === 0 && high === 0 && low === 0 && volume === 0 && turnover === 0) return 'NON_TRADING';
    const close = finite(row.close, 'close');
    const previousClose = finite(row.previousClose, 'previousClose');
    if (close > previousClose) return 'ADVANCE';
    if (close < previousClose) return 'DECLINE';
    return 'UNCHANGED';
  }

  function aggregateBreadth(rows, previousAdLine = 0) {
    const counts = { universe: 0, advance: 0, decline: 0, unchanged: 0, nonTrading: 0, missing: 0 };
    (rows || []).forEach((row) => {
      const state = classifyBreadthSymbol(row);
      if (state === 'UNLISTED') return;
      counts.universe += 1;
      if (state === 'ADVANCE') counts.advance += 1;
      else if (state === 'DECLINE') counts.decline += 1;
      else if (state === 'UNCHANGED') counts.unchanged += 1;
      else if (state === 'NON_TRADING') counts.nonTrading += 1;
      else if (state === 'MISSING') counts.missing += 1;
    });
    const identity = counts.advance + counts.decline + counts.unchanged + counts.nonTrading + counts.missing;
    if (identity !== counts.universe) throw new Error('breadth identity mismatch');
    const covered = counts.advance + counts.decline + counts.unchanged + counts.nonTrading;
    const trading = counts.advance + counts.decline + counts.unchanged;
    const adDiff = counts.advance - counts.decline;
    return {
      ...counts,
      adDiff,
      adLine: finite(previousAdLine, 'previousAdLine') + adDiff,
      coverage: counts.universe ? covered / counts.universe : 0,
      participation: counts.universe ? trading / counts.universe : 0,
    };
  }

  function makeObservation(input) {
    if (!input || !input.seriesId || !input.tradingDate || !input.receivedAt) throw new Error('seriesId/tradingDate/receivedAt required');
    return {
      seriesId: input.seriesId,
      tradingDate: input.tradingDate,
      value: finite(input.value, 'value'),
      market: input.market || 'UNKNOWN',
      session: input.session || 'UNKNOWN',
      source: input.source || 'UNKNOWN',
      status: input.status || 'PARTIAL',
      finality: input.finality || null,
      observedAt: input.observedAt || null,
      receivedAt: input.receivedAt,
      quality: input.quality || null,
      revision: Number.isInteger(input.revision) ? input.revision : 0,
    };
  }

  function breadthObservations(summary, meta) {
    const base = { tradingDate: meta.tradingDate, market: meta.market || 'KRX', session: 'REGULAR', source: meta.source || 'KRX', status: meta.status || 'FINAL', observedAt: meta.observedAt || null, receivedAt: meta.receivedAt };
    return [
      makeObservation({ ...base, seriesId: SERIES.BREADTH_AD_LINE, value: summary.adLine }),
      makeObservation({ ...base, seriesId: SERIES.BREADTH_COVERAGE, value: summary.coverage }),
      makeObservation({ ...base, seriesId: SERIES.BREADTH_PARTICIPATION, value: summary.participation }),
    ];
  }

  function flowObservation(kind, value, meta) {
    const seriesId = kind === 'FOREIGN' ? SERIES.FOREIGN_NET : kind === 'INSTITUTION' ? SERIES.INSTITUTION_NET : SERIES.PROGRAM_NET;
    return makeObservation({ seriesId, value, tradingDate: meta.tradingDate, market: meta.market || 'KRX', session: meta.session || 'REGULAR', source: meta.source || 'KRX', status: meta.status || 'FINAL', observedAt: meta.observedAt || null, receivedAt: meta.receivedAt, quality: meta.quality || null });
  }

  function nightFutureObservation(value, meta) {
    return makeObservation({ seriesId: SERIES.K200_NIGHT, value, tradingDate: meta.tradingDate, market: 'KRX', session: 'NIGHT', source: meta.source || 'KIS', status: meta.status || 'LIVE', finality: meta.finality || null, observedAt: meta.observedAt || null, receivedAt: meta.receivedAt, quality: meta.quality || null });
  }

  function afterTurnoverObservation(venue, value, meta) {
    if (venue !== 'KRX' && venue !== 'NXT') throw new Error('venue must be KRX or NXT');
    return makeObservation({ seriesId: venue === 'KRX' ? SERIES.KRX_AFTER_TURNOVER : SERIES.NXT_AFTER_TURNOVER, value, tradingDate: meta.tradingDate, market: venue, session: 'AFTER', source: meta.source || 'KIS', status: meta.status || 'PARTIAL', observedAt: meta.observedAt || null, receivedAt: meta.receivedAt, quality: meta.quality || 'MISSING' });
  }

  function skhyAdrGap(skhyUsd, usdKrw, priorKrClose) {
    const implied = finite(skhyUsd, 'skhyUsd') * finite(usdKrw, 'usdKrw') * 10;
    return implied / finite(priorKrClose, 'priorKrClose') - 1;
  }

  const api = { SERIES, classifyBreadthSymbol, aggregateBreadth, makeObservation, breadthObservations, flowObservation, nightFutureObservation, afterTurnoverObservation, skhyAdrGap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
