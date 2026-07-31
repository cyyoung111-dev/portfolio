// ════════════════════════════════════════════════════════════════
//  views_history_pipeline.js — 히스토리 데이터 로딩/가공 파이프라인
//  의존: views_history_state.js, views_history_render.js, views_history_benchmark.js
// ════════════════════════════════════════════════════════════════

async function loadHistoryChart() {
  const statusEl = $el('histStatusMsg');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  const coverageEl = $el('histCoveragePanel');
  if (!chartWrap) return;

  if (!GSHEET_API_URL) {
    _setHistoryStatus(statusEl, 'no_api');
    chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    if (coverageEl) coverageEl.innerHTML = '';
    return;
  }

  _setHistoryStatus(statusEl, 'loading');
  chartWrap.innerHTML = '';
  if (tableWrap) tableWrap.innerHTML = '';
  if (coverageEl) coverageEl.innerHTML = '';

  try {
    const startMonth = String($el('histStartMonth')?.value || '').trim();
    // ★ [버그수정] var → const (async 함수 내 var 호이스팅 리스크 제거)
    const rangeDays = parseInt($el('histRangeSelect')?.value || '365', 10);
    let fromStr = '';
    if (/^\d{4}-\d{2}$/.test(startMonth)) fromStr = `${startMonth}-01`;
    else if (rangeDays > 0) {
      // ★ [버그수정] new Date() 로컬 타임존 → _kstNow() + _kstDateOffset() 으로 교체
      //   settings_fetch.js getDateStr()과 동일한 패턴 — KST 기준으로 통일
      const todayStr = _kstTodayStr();
      fromStr = _kstDateOffset(todayStr, -rangeDays);
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
    const graphSnapshots = tableSnapshots;
    const coverage = _analyzeHistoryCoverage(snapshots, mode);
    __histState.missingSnapshotDates = coverage.missing.map(item => item.targetDate);
    _renderHistoryCoverage(coverageEl, coverage, mode);

    const latestSnapshotDate = snapshots[snapshots.length-1].date || '';
    const latestDate = _fmtHistDateCompact(latestSnapshotDate);
    const snapshotGap = _getHistorySnapshotGap(latestSnapshotDate);
    _setHistoryStatus(statusEl, 'summary', {
      graphCount: graphSnapshots.length,
      tableCount: tableSnapshots.length,
      mode,
      latestDate,
      snapshotGap
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
    const baseMsg = `그래프·표 ${tableSnapshots.length}${mode==='week'?'주':'개월'} · 원본 ${snapshots.length}일 · 최근: ${latestDate}`;
    const benchMsg = benchmarkTypes.length === 0
      ? '비교지수 없음'
      : `비교지수 ${benchmarkTypes.length - missing.length}/${benchmarkTypes.length}개 로드`;
    const missingMsg = missing.length ? ` (실패: ${missing.join(', ')})` : '';
    _setHistoryStatus(statusEl, 'summary_benchmark', { baseMsg, benchMsg, missingMsg, snapshotGap });

    _drawHistoryChart(chartWrap, graphSnapshots, mode, {
      types: benchmarkTypes,
      seriesMap: benchSeriesMap,
      metaMap: benchMetaMap,
      portfolioSnapshots: snapshots
    });
    _drawHistoryTable(tableWrap, tableSnapshots);

  } catch(e) {
    _setHistoryStatus(statusEl, 'error', { message: e.message });
  }
}

function _renderHistoryCoverage(el, coverage, mode) {
  if (!el) return;
  const missing = Array.isArray(coverage?.missing) ? coverage.missing : [];
  if (!missing.length) {
    el.innerHTML = '<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 선택 기간의 스냅샷 주기가 연속적입니다.</div>';
    return;
  }
  const labels = missing.slice(0, 6).map(item => item.label).join(', ');
  const more = missing.length > 6 ? ` 외 ${missing.length - 6}개` : '';
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:9px 11px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2))">
    <div style="min-width:0;font-size:.67rem;color:var(--text);line-height:1.55">
      <b style="color:var(--amber)">⚠️ ${mode === 'week' ? '주간' : '월간'} 스냅샷 ${missing.length}개 누락</b><br>
      <span style="color:var(--muted)">${_escapeHtml(labels + more)} · 오늘까지 금요일/월말 영업일 기준으로 복구합니다.<br>장기간 누락은 16:20 평가단가 자동 트리거 중단 또는 실행 오류일 수 있으며, 보완 실행 시 트리거도 점검합니다.</span>
    </div>
    <button type="button" class="btn-ghost-sm" data-history-action="repair-gaps">🛠️ 누락 보완</button>
  </div>`;
}

async function repairHistorySnapshotGaps() {
  const dates = Array.from(new Set(__histState.missingSnapshotDates || [])).filter(Boolean);
  if (!dates.length || !GSHEET_API_URL) return;
  if (!confirm(`${dates.length}개의 누락 스냅샷을 가격이력과 거래이력으로 복구할까요?\n처리 중에는 화면을 닫지 마세요.`)) return;
  const btn = document.querySelector('[data-history-action="repair-gaps"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 복구 중...'; }
  let repaired = 0;
  const failed = [];
  let automationRestored = false;
  try {
    for (let i = 0; i < dates.length; i += 4) {
      const chunk = dates.slice(i, i + 4);
      const data = await requestGsheetFormJson('repairSnapshots', { data: JSON.stringify({ dates: chunk }) }, { timeoutMs: 120000, retry: 0 });
      if (!data || data.status === 'error') throw new Error(data?.message || 'GAS 복구 응답 오류');
      repaired += Array.isArray(data.repaired) ? data.repaired.length : 0;
      if (Array.isArray(data.failed)) failed.push(...data.failed);
      automationRestored = automationRestored || !!data.automationRestored;
      if (btn) btn.textContent = `⏳ ${Math.min(i + chunk.length, dates.length)}/${dates.length}`;
    }
    showToast(`스냅샷 ${repaired}개 복구 완료${failed.length ? ` · 실패 ${failed.length}개` : ''}${automationRestored ? ' · 자동 트리거 복구' : ''}`, failed.length ? 'warn' : 'ok');
    await loadHistoryChart();
  } catch (e) {
    showToast(`스냅샷 복구 실패: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🛠️ 다시 시도'; }
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
