// ════════════════════════════════════════════════════════════════
//  views_history_utils.js — 히스토리 뷰 포맷/필터 공용 유틸
//  의존: 없음 (순수 함수)
// ════════════════════════════════════════════════════════════════

function _histDateKey(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return '';
  // 날짜 input과 스냅샷 정규화 형식(YYYY-MM-DD)에 맞춘다.
  // 점 형식으로 반환하면 같은 날짜도 input 값과 일치하지 않아 "스냅샷 없음"으로 오판한다.
  return `${m[1]}-${m[2]}-${m[3]}`;
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

// 매수는 외부 자금 유입(+), 매도는 외부 자금 회수(-)로 분리해 기간별 수익률을 연결합니다.
// 단순 평가금액/원가 비율과 달리 추가 매수·매도로 포트폴리오 규모가 바뀌어도 수익으로 보지 않습니다.
function _buildCashflowAdjustedReturnIndex(snapshots, trades) {
  const values = (Array.isArray(snapshots) ? snapshots : [])
    .map(snapshot => ({
      date: _histDateKey(snapshot?.date || ''),
      evalAmt: Number(snapshot?.evalAmt || snapshot?.total || snapshot?.eval || 0),
    }))
    .filter(point => point.date && Number.isFinite(point.evalAmt) && point.evalAmt >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!values.length) return [];

  const cashflowByDate = {};
  (Array.isArray(trades) ? trades : []).forEach(trade => {
    const date = _histDateKey(trade?.date || '');
    const amount = Number(trade?.qty || 0) * Number(trade?.price || 0);
    const type = String(trade?.tradeType || '').toLowerCase();
    if (!date || !Number.isFinite(amount) || amount <= 0 || (type !== 'buy' && type !== 'sell')) return;
    cashflowByDate[date] = (cashflowByDate[date] || 0) + (type === 'buy' ? amount : -amount);
  });

  let returnIndex = 100;
  const points = [{ date: values[0].date, returnIndex }];
  const cashflows = Object.keys(cashflowByDate).sort().map(date => ({ date, amount: cashflowByDate[date] }));
  let cashflowIndex = 0;
  while (cashflowIndex < cashflows.length && cashflows[cashflowIndex].date <= values[0].date) cashflowIndex++;
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    let netCashflow = 0;
    while (cashflowIndex < cashflows.length && cashflows[cashflowIndex].date <= current.date) {
      if (cashflows[cashflowIndex].date > previous.date) netCashflow += cashflows[cashflowIndex].amount;
      cashflowIndex++;
    }
    const growth = previous.evalAmt > 0 ? (current.evalAmt - netCashflow) / previous.evalAmt : NaN;
    if (Number.isFinite(growth) && growth >= 0) returnIndex *= growth;
    points.push({ date: current.date, returnIndex });
  }
  return points;
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

function _selectHistorySnapshots(snapshots, mode) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  if (mode === 'day') return list.slice();
  if (mode === 'week') return _filterWeeklyFriday(list);
  if (mode === 'month') return _filterMonthEnd(list);
  return _filterWeeklyFriday(list);
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
