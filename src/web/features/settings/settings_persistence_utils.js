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
  });
  return next;
}

function _applyDivData(raw) {
  const normalized = _normalizeDivData(raw);
  Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
  Object.assign(DIVDATA, normalized);
}
