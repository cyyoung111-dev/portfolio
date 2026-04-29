// ════════════════════════════════════════════════════════════════
//  views_history_render.js — 히스토리 뷰 초기 렌더/이벤트 결선
// ════════════════════════════════════════════════════════════════
function renderHistoryView(area) {
  area.innerHTML = `
    <div style="padding:12px 0 8px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <div style="font-size:.80rem;font-weight:700;color:var(--text)">📈 손익 그래프</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;background:var(--s2);border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button id="histModeWeek" style="padding:4px 10px;font-size:.70rem;border:none;cursor:pointer">주간</button>
            <button id="histModeMonth" style="padding:4px 10px;font-size:.70rem;border:none;cursor:pointer">월간</button>
          </div>
          <input id="histStartMonth" type="month" title="시작 연월"
            style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.72rem" />
          <select id="histRangeSelect"
            style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.72rem">
            <option value="90">3개월</option>
            <option value="180">6개월</option>
            <option value="365" selected>1년</option>
            <option value="730">2년</option>
            <option value="0">전체</option>
          </select>
          <div id="histBenchmarkMulti" title="비교지수(복수선택)"
            style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:4px;border:1px solid var(--border);border-radius:8px;background:var(--s2)">
            <button type="button" class="hist-bench-btn" data-bench="KOSPI">KOSPI</button>
            <button type="button" class="hist-bench-btn" data-bench="KOSDAQ">KOSDAQ</button>
            <button type="button" class="hist-bench-btn" data-bench="SP500">S&P500</button>
            <button type="button" class="hist-bench-btn" data-bench="NASDAQ">NASDAQ</button>
            <button type="button" class="hist-bench-btn" data-bench="NASDAQ100">NASDAQ100</button>
            <button type="button" id="histBenchClear" class="hist-bench-btn hist-bench-btn-clear" data-bench="CLEAR">해제</button>
          </div>
          <button id="btn-history-refresh" class="btn-ghost-sm">🔄 새로고침</button>
        </div>
      </div>
      <div id="histStatusMsg" style="font-size:.72rem;color:var(--muted);margin-bottom:8px"></div>
      <div id="histChartWrap" style="width:100%;overflow-x:auto"></div>
      <div id="histTableWrap" style="margin-top:18px"></div>
    </div>`;
  _initHistState();
  _applyHistModeUI(_getHistMode());
  _renderHistBenchmarkButtons();
  const monthEl = $el('histStartMonth');
  if (monthEl && !monthEl.value) {
    const d = new Date();
    monthEl.value = `${d.getFullYear()}-01`;
  }
  loadHistoryChart();
  $el('histRangeSelect')?.addEventListener('change', loadHistoryChart);
  $el('histStartMonth')?.addEventListener('change', loadHistoryChart);
  $el('histBenchmarkMulti')?.addEventListener('click', e => {
    const btn = e.target?.closest?.('.hist-bench-btn');
    if (!btn) return;
    const type = btn.dataset?.bench || '';
    if (!type) return;
    if (type === 'CLEAR') _setHistBenchmarks([]);
    else _toggleHistBenchmark(type);
    _renderHistBenchmarkButtons();
    loadHistoryChart();
  });
}
