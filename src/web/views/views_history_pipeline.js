// ════════════════════════════════════════════════════════════════
//  views_history_pipeline.js — 히스토리 데이터 로딩/가공 파이프라인
//  의존: views_history_state.js, views_history_render.js, views_history_benchmark.js
// ════════════════════════════════════════════════════════════════

async function loadHistoryChart() {
  const statusEl = $el('histStatusMsg');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  if (!chartWrap) return;

  if (!GSHEET_API_URL) {
    _setHistoryStatus(statusEl, 'no_api');
    chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    return;
  }

  _setHistoryStatus(statusEl, 'loading');
  chartWrap.innerHTML = '';
  if (tableWrap) tableWrap.innerHTML = '';

  try {
    const startMonth = String($el('histStartMonth')?.value || '').trim();
    var rangeDays = parseInt($el('histRangeSelect')?.value || '365', 10);
    let fromStr = '';
    if (/^\d{4}-\d{2}$/.test(startMonth)) fromStr = `${startMonth}-01`;
    else if (rangeDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rangeDays);
      fromStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
    }
    const data = await _historyRequestJson('getHistory', { from: fromStr }, { timeoutMs: 15000, retry: 0 });
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      _setHistoryStatus(statusEl, 'empty_data');
      return;
    }

    snapshots = snapshots
      .map(s => ({ ...s, date: _normalizeHistDate(s.date || '') }))
      .filter(s => !!s.date)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!snapshots.length) {
      _setHistoryStatus(statusEl, 'empty_range');
      return;
    }

    // 거래이력 기반 원가 재계산값이 있으면 우선 적용
    snapshots = _mergeTradeBasedCost(snapshots);
    const mode = _getHistMode();
    const tableSnapshots = mode === 'week' ? _filterWeeklyFriday(snapshots) : _filterMonthEnd(snapshots);

    const latestDate = _fmtHistDateCompact(snapshots[snapshots.length-1].date || '');
    _setHistoryStatus(statusEl, 'summary', {
      graphCount: snapshots.length,
      tableCount: tableSnapshots.length,
      mode,
      latestDate
    });

    const benchmarkTypes = Array.from(new Set(
      _getHistBenchmarks()
        .map(v => String(v || '').toUpperCase().trim())
        .filter(v => HIST_BENCHMARK_TYPES.includes(v))
    ));
    const benchBundle = await _loadBenchmarkBundle(
      benchmarkTypes,
      snapshots[0].date,
      snapshots[snapshots.length - 1].date
    );
    const benchSeriesMap = benchBundle.seriesMap;
    const benchMetaMap = benchBundle.metaMap;
    const missing = benchBundle.failedTypes;
    const baseMsg = `그래프 ${snapshots.length}일 · 표 ${tableSnapshots.length}${mode==='week'?'주':'개월'} · 최근: ${latestDate}`;
    const benchMsg = benchmarkTypes.length === 0
      ? '비교지수 없음'
      : `비교지수 ${benchmarkTypes.length - missing.length}/${benchmarkTypes.length}개 로드`;
    const missingMsg = missing.length ? ` (실패: ${missing.join(', ')})` : '';
    _setHistoryStatus(statusEl, 'summary_benchmark', { baseMsg, benchMsg, missingMsg });

    _drawHistoryChart(chartWrap, snapshots, mode, { types: benchmarkTypes, seriesMap: benchSeriesMap, metaMap: benchMetaMap });
    _drawHistoryTable(tableWrap, tableSnapshots);

  } catch(e) {
    _setHistoryStatus(statusEl, 'error', { message: e.message });
  }
}

function _mergeTradeBasedCost(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return snapshots;
  if (!Array.isArray(rawTrades) || rawTrades.length === 0) return snapshots;

  const timeline = _buildCostTimelineFromTrades(snapshots.map(s => _histDateKey(s.date || '')));
  return snapshots.map(s => {
    const key = _histDateKey(s.date || '');
    const tradeCost = timeline[key];
    if (!Number.isFinite(tradeCost)) return s;
    return { ...s, costAmt: Math.round(tradeCost) };
  });
}

function _buildCostTimelineFromTrades(snapshotDateKeys) {
  const targets = [...new Set(snapshotDateKeys.filter(Boolean))].sort();
  const out = {};
  if (!targets.length) return out;

  const trades = rawTrades
    .filter(t => t && t.date && t.name)
    .map(t => ({
      date: _histDateKey(t.date || ''),
      tradeType: (t.tradeType || '').toLowerCase(),
      qty: parseFloat(t.qty || 0),
      price: parseFloat(t.price || 0),
      name: (t.name || '').trim(),
      acct: (t.acct || '').trim(),
    }))
    .filter(t => t.date && t.name && t.qty > 0 && t.price >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const posMap = {}; // key -> { qty, totalCost }
  const posKey = t => `${t.acct}||${t.name}`;
  const totalCost = () => Object.values(posMap).reduce((s, p) => s + (p.totalCost || 0), 0);

  let ti = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    while (ti < trades.length && trades[ti].date <= target) {
      const t = trades[ti++];
      const key = posKey(t);
      if (!posMap[key]) posMap[key] = { qty: 0, totalCost: 0 };
      const p = posMap[key];
      if (t.tradeType === 'buy') {
        p.qty += t.qty;
        p.totalCost += t.qty * t.price;
      } else if (t.tradeType === 'sell') {
        const avg = p.qty > 0 ? p.totalCost / p.qty : 0;
        const sellQty = Math.min(t.qty, p.qty);
        p.qty -= sellQty;
        p.totalCost -= avg * sellQty;
        if (p.qty <= 0) {
          p.qty = 0;
          p.totalCost = 0;
        }
      }
    }
    out[target] = Math.max(0, totalCost());
  }
  return out;
}
