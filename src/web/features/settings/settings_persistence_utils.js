// ════════════════════════════════════════════════════════════════
//  settings_persistence_utils.js — 설정 저장/복원 보조 유틸
// ════════════════════════════════════════════════════════════════

function _toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _toMonths(v) {
  if (Array.isArray(v)) {
    return v.map(m => Number(m)).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  }
  if (typeof v === 'string') {
    return v.split(',').map(m => Number(String(m).trim())).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  }
  return [];
}

function _normalizeDivData(raw) {
  const next = {};
  if (!raw || typeof raw !== 'object') return next;
  Object.entries(raw).forEach(([key, v]) => {
    const prev = (v && typeof v === 'object') ? v : {};
    // ★ key가 name이면 code로 변환 (getDivKey 사용)
    const storeKey = (typeof getDivKey === 'function') ? getDivKey(key) : key;
    next[storeKey] = {
      perShare: _toNum(prev.perShare, 0),
      freq: typeof prev.freq === 'string' ? prev.freq : '-',
      months: _toMonths(prev.months),
      note: typeof prev.note === 'string' ? prev.note : '',
    };
    const row = next[storeKey];
    for (const field of ['source','listedName','isin','crno','updatedAt','providerCheckStatus',
      'providerCheckedAt','providerWindowFrom','providerWindowTo','refreshState','lastAttemptAt']) {
      if (typeof prev[field] === 'string') row[field] = prev[field];
    }
    if (Number.isFinite(Number(prev.ttmPerShare)) && prev.ttmPerShare != null)
      row.ttmPerShare = Number(prev.ttmPerShare);
    if (Number.isInteger(Number(prev.count)) && prev.count != null) row.count = Number(prev.count);
    if (Array.isArray(prev.events)) row.events = prev.events.map(event => ({
      date:String(event?.date || '').slice(0,10), payDate:String(event?.payDate || '').slice(0,10),
      amount:_toNum(event?.amount,0), source:String(event?.source || prev.source || '')
    })).filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.amount > 0);
  });
  return next;
}

function _applyDivData(raw) {
  const normalized = _normalizeDivData(raw);
  Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
  Object.assign(DIVDATA, normalized);
}
