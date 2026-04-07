// ════════════════════════════════════════════════════════════════
//  views_history_utils.js — 히스토리 뷰 포맷/필터 공용 유틸
//  의존: 없음 (순수 함수)
// ════════════════════════════════════════════════════════════════

function _histDateKey(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return '';
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function _fmtAxisKrw(v) {
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return (v / 1e4).toFixed(0) + '만';
  return Math.round(v).toLocaleString();
}

function _fmtKrw(v) {
  const abs = Math.abs(v), sign = v < 0 ? '-' : '';
  if (abs >= 1e8) {
    const uk = Math.floor(abs / 1e8);
    const man = Math.round((abs % 1e8) / 1e4);
    return man > 0 ? `${sign}${uk}억 ${man.toLocaleString()}만` : `${sign}${uk}억`;
  }
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만';
  return sign + Math.round(abs).toLocaleString();
}

function _fmtHistDateShort(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return '';
  return `${m[2]}.${m[3]}`;
}

function _fmtHistDateShortWeek(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return '';
  return `${m[2]}.${m[3]}`;
}

function _fmtHistDateShortMonth(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})/);
  if (!m) return '';
  return `${m[1].slice(2)}.${m[2]}`;
}

function _normalizeHistDate(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return '';
}

function _filterWeeklyFriday(snapshots) {
  return snapshots.filter(s => {
    const m = String(s.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const dowKst = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))).getUTCDay();
    return dowKst === 5; // 금요일(KST 날짜 기준)
  });
}

function _filterMonthEnd(snapshots) {
  const monthMap = {};
  snapshots.forEach(s => {
    const m = String(s.date || '').match(/^(\d{4})-(\d{2})/);
    if (!m) return;
    const key = `${m[1]}-${m[2]}`;
    if (!monthMap[key] || (s.date || '') > (monthMap[key].date || '')) monthMap[key] = s;
  });
  return Object.keys(monthMap).sort().map(k => monthMap[k]);
}

function _fmtHistDateCompact(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return fmtDateDot(v || '');
  return `${m[1]}.${m[2]}.${m[3]}`;
}
