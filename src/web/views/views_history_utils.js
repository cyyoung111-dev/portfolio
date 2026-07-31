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

function _historyUtcDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
}

function _historyDateStr(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function _historyWeekStart(dateStr) {
  const date = _historyUtcDate(dateStr);
  if (!date) return '';
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return _historyDateStr(date);
}

// 금요일 자료가 없더라도 해당 주의 마지막 스냅샷을 사용합니다.
// 휴일·트리거 실패 때문에 주간 데이터가 통째로 사라지는 문제를 방지합니다.
function _filterWeeklyFriday(snapshots) {
  const weekMap = {};
  snapshots.forEach(s => {
    const key = _historyWeekStart(s.date || '');
    if (!key) return;
    if (!weekMap[key] || (s.date || '') > (weekMap[key].date || '')) weekMap[key] = s;
  });
  return Object.keys(weekMap).sort().map(k => weekMap[k]);
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

function _historyTargetDate(periodStart, mode, maxDate) {
  const date = _historyUtcDate(periodStart);
  if (!date) return '';
  if (mode === 'week') {
    date.setUTCDate(date.getUTCDate() + 4); // 금요일
  } else {
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() - 2);
    else if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  }
  const target = _historyDateStr(date);
  return maxDate && target > maxDate ? maxDate : target;
}

function _analyzeHistoryCoverage(snapshots, mode) {
  const normalizedMode = mode === 'month' ? 'month' : 'week';
  const dates = (Array.isArray(snapshots) ? snapshots : [])
    .map(s => _normalizeHistDate(s?.date || ''))
    .filter(Boolean)
    .sort();
  if (dates.length < 2) return { missing: [], first: dates[0] || '', last: dates[0] || '' };

  const today = (typeof _kstTodayStr === 'function') ? _kstTodayStr() : _normalizeHistDate(new Date());
  const expectedLast = today && today > dates[dates.length - 1] ? today : dates[dates.length - 1];
  const present = new Set(dates.map(date => normalizedMode === 'week' ? _historyWeekStart(date) : date.slice(0, 7) + '-01'));
  let cursor = _historyUtcDate(normalizedMode === 'week' ? _historyWeekStart(dates[0]) : dates[0].slice(0, 7) + '-01');
  const endKey = normalizedMode === 'week' ? _historyWeekStart(expectedLast) : expectedLast.slice(0, 7) + '-01';
  const missing = [];
  while (cursor && _historyDateStr(cursor) <= endKey) {
    const key = _historyDateStr(cursor);
    if (!present.has(key)) {
      const targetDate = _historyTargetDate(key, normalizedMode, today);
      missing.push({
        key,
        targetDate,
        label: normalizedMode === 'week' ? `${key.slice(5).replace('-', '.')} 주` : key.slice(0, 7).replace('-', '.')
      });
    }
    if (normalizedMode === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { missing, first: dates[0], last: dates[dates.length - 1], expectedLast: today };
}

function _fmtHistDateCompact(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return fmtDateDot(v || '');
  return `${m[1]}.${m[2]}.${m[3]}`;
}
