(function (global) {
  'use strict';

  const STATUS = Object.freeze({
    LIVE: 'LIVE', FINAL: 'FINAL', DELAYED: 'DELAYED', STALE: 'STALE',
    PARTIAL: 'PARTIAL', QUARANTINED: 'QUARANTINED', FAILED: 'FAILED'
  });

  function toMs(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function classifyObservation(obs, policy, now) {
    const p = policy || {};
    const observed = toMs(obs && obs.observedAt);
    const received = toMs(obs && obs.receivedAt);
    const report = toMs(now) ?? Date.now();
    const errors = [];
    if (!obs || obs.value === null || obs.value === undefined || !Number.isFinite(Number(obs.value))) errors.push('VALUE_INVALID');
    if (!received) errors.push('RECEIVED_AT_MISSING');
    if (obs && obs.requestedDate && obs.observationDate && obs.requestedDate !== obs.observationDate) errors.push('HOLIDAY_FALLBACK');
    if (obs && obs.schemaOk === false) errors.push('SCHEMA_CHANGED');
    if (obs && obs.gap === true) errors.push('GAP');
    if (errors.includes('SCHEMA_CHANGED')) return { status: STATUS.QUARANTINED, errors, lagMs: null, timestampQuality: observed ? 'VENUE' : 'RECEIVE_ONLY' };
    if (errors.includes('VALUE_INVALID') || errors.includes('RECEIVED_AT_MISSING')) return { status: STATUS.FAILED, errors, lagMs: null, timestampQuality: observed ? 'VENUE' : 'RECEIVE_ONLY' };
    if (errors.includes('HOLIDAY_FALLBACK') || errors.includes('GAP')) return { status: STATUS.PARTIAL, errors, lagMs: observed ? Math.max(0, received - observed) : null, timestampQuality: observed ? 'VENUE' : 'RECEIVE_ONLY' };
    const lagMs = observed ? Math.max(0, received - observed) : null;
    const ageMs = observed ? Math.max(0, report - observed) : null;
    if (Number.isFinite(p.maxAcceptableLagMs) && lagMs !== null && lagMs > p.maxAcceptableLagMs) return { status: STATUS.DELAYED, errors, lagMs, timestampQuality: 'VENUE' };
    if (Number.isFinite(p.maxAgeMs) && ageMs !== null && ageMs > p.maxAgeMs) return { status: STATUS.STALE, errors, lagMs, timestampQuality: 'VENUE' };
    return { status: obs.final === true ? STATUS.FINAL : STATUS.LIVE, errors, lagMs, timestampQuality: observed ? 'VENUE' : 'RECEIVE_ONLY' };
  }

  function validateKisRawFrame(frame, schemaRegistry) {
    const text = String(frame || '');
    const parts = text.split('|');
    if (parts.length < 4) return { ok: false, status: STATUS.QUARANTINED, reason: 'FRAME_FORMAT', rawFrame: text };
    const trId = parts[1];
    const declaredCount = Number(parts[2]);
    const payload = parts.slice(3).join('|');
    const fields = payload.split('^');
    const schema = schemaRegistry && schemaRegistry[trId];
    if (!schema) return { ok: false, status: STATUS.QUARANTINED, reason: 'UNKNOWN_TR_ID', trId, declaredCount, fieldCount: fields.length, rawPayload: payload };
    const allowed = Array.isArray(schema.fieldCounts) ? schema.fieldCounts : [schema.fieldCount];
    if (!allowed.includes(fields.length)) return { ok: false, status: STATUS.QUARANTINED, reason: 'FIELD_COUNT_MISMATCH', trId, declaredCount, fieldCount: fields.length, expectedFieldCounts: allowed, rawPayload: payload };
    return { ok: true, status: STATUS.LIVE, trId, declaredCount, fieldCount: fields.length, fields, rawPayload: payload };
  }

  function classifyBreadthRow(row) {
    const o = Number(row.open), h = Number(row.high), l = Number(row.low), v = Number(row.volume), amount = Number(row.turnover), r = Number(row.changePct);
    if (![o, h, l, v, amount, r].every(Number.isFinite)) return 'MISSING';
    if (o === 0 && h === 0 && l === 0 && v === 0 && amount === 0) return 'NON_TRADING';
    if (r > 0) return 'ADVANCE';
    if (r < 0) return 'DECLINE';
    return 'UNCHANGED';
  }

  function aggregateBreadth(rows, universeCount) {
    const counts = { ADVANCE: 0, DECLINE: 0, UNCHANGED: 0, NON_TRADING: 0, MISSING: 0 };
    (rows || []).forEach(row => { counts[classifyBreadthRow(row)] += 1; });
    const universe = Number.isFinite(Number(universeCount)) ? Number(universeCount) : (rows || []).length;
    const classified = Object.values(counts).reduce((a, b) => a + b, 0);
    if (classified < universe) counts.MISSING += universe - classified;
    const dataCount = counts.ADVANCE + counts.DECLINE + counts.UNCHANGED + counts.NON_TRADING;
    const participating = counts.ADVANCE + counts.DECLINE + counts.UNCHANGED;
    return {
      universeCount: universe,
      ...counts,
      adDiff: counts.ADVANCE - counts.DECLINE,
      advanceRatio: participating ? counts.ADVANCE / participating : null,
      dataCoverage: universe ? dataCount / universe : null,
      tradingParticipation: universe ? participating / universe : null,
      qcOk: counts.ADVANCE + counts.DECLINE + counts.UNCHANGED + counts.NON_TRADING + counts.MISSING === universe
    };
  }

  function adrMorningGap(input) {
    const skhy = Number(input.skhyPrice), fx = Number(input.usdKrw), kr = Number(input.krClose), ordPerDr = Number(input.ordPerDr || 0.1);
    if (![skhy, fx, kr, ordPerDr].every(x => Number.isFinite(x) && x > 0)) return null;
    const impliedOrdinaryKrw = skhy * fx / ordPerDr;
    return { impliedOrdinaryKrw, gapPct: (impliedOrdinaryKrw / kr - 1) * 100, semantic: 'MORNING_ADR_GAP' };
  }

  function synchronizedAdrPremium(input) {
    const base = adrMorningGap(input);
    if (!base) return null;
    const times = [toMs(input.skhyObservedAt), toMs(input.fxObservedAt), toMs(input.krObservedAt)];
    if (times.some(x => x === null)) return { ...base, semantic: 'SYNCHRONIZED_ADR_PREMIUM', status: STATUS.PARTIAL, observationGapSeconds: null };
    const gap = (Math.max(...times) - Math.min(...times)) / 1000;
    const maxGap = Number.isFinite(Number(input.maxGapSeconds)) ? Number(input.maxGapSeconds) : 300;
    return { ...base, semantic: 'SYNCHRONIZED_ADR_PREMIUM', observationGapSeconds: gap, status: gap <= maxGap ? STATUS.LIVE : STATUS.PARTIAL };
  }

  function programAdditivity(krx, nxt, unified, tolerance) {
    const values = [krx, nxt, unified].map(Number);
    if (!values.every(Number.isFinite)) return { ok: false, diff: null, reason: 'VALUE_INVALID' };
    const diff = values[0] + values[1] - values[2];
    const tol = Number.isFinite(Number(tolerance)) ? Number(tolerance) : 0;
    return { ok: Math.abs(diff) <= tol, diff };
  }

  const api = { STATUS, classifyObservation, validateKisRawFrame, classifyBreadthRow, aggregateBreadth, adrMorningGap, synchronizedAdrPremium, programAdditivity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarketBriefingQC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
