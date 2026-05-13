// ════════════════════════════════════════════════════════════════
//  views_history_state.js — 히스토리 상태/컨트롤/UI 상태 메시지
// ════════════════════════════════════════════════════════════════

const __histState = window.__histState || {
  mode: 'week',
  benchmarks: ['KOSPI'],
  debugByDate: {},
  debugDate: '',
};
window.__histState = __histState;

const HIST_BENCHMARK_TYPES = ['KOSPI', 'KOSDAQ', 'SP500', 'NASDAQ', 'NASDAQ100'];

function _initHistState() {
  __histState.mode = __histState.mode === 'month' ? 'month' : 'week';
  __histState.benchmarks = Array.isArray(__histState.benchmarks) ? __histState.benchmarks.slice() : ['KOSPI'];
}

function _getHistMode() {
  return __histState.mode === 'month' ? 'month' : 'week';
}

function _setHistModeState(mode) {
  __histState.mode = mode === 'month' ? 'month' : 'week';
}

function _getHistBenchmarks() {
  return Array.isArray(__histState.benchmarks) ? __histState.benchmarks.slice() : [];
}

function _setHistBenchmarks(next) {
  __histState.benchmarks = Array.isArray(next) ? next.slice() : [];
}

function _setHistoryStatus(statusEl, type, payload) {
  if (!statusEl) return;
  const meta = payload || {};
  if (type === 'no_api') {
    statusEl.innerHTML = '<span style="color:var(--amber)">⚠️ 재동기화 설정 후 이용 가능합니다.</span>';
    return;
  }
  if (type === 'loading') {
    statusEl.innerHTML = '<span style="color:var(--muted)">⏳ 불러오는 중...</span>';
    return;
  }
  if (type === 'empty_data') {
    statusEl.innerHTML = '<span style="color:var(--muted)">스냅샷 데이터가 없습니다. 데이터가 쌓이면 자동으로 표시됩니다.</span>';
    return;
  }
  if (type === 'empty_range') {
    statusEl.innerHTML = '<span style="color:var(--muted)">선택한 기간에 데이터가 없습니다.</span>';
    return;
  }
  if (type === 'summary') {
    const graphCount = Number.isFinite(Number(meta.graphCount)) ? Number(meta.graphCount) : 0;
    const tableCount = Number.isFinite(Number(meta.tableCount)) ? Number(meta.tableCount) : 0;
    const unit = meta.mode === 'week' ? '주' : '개월';
    statusEl.innerHTML = `<span style="color:var(--muted)">그래프 ${graphCount}일 · 표 ${tableCount}${unit} · 최근: ${_escapeHtml(meta.latestDate || '-')}</span>`;
    return;
  }
  if (type === 'summary_benchmark') {
    const baseMsg = _escapeHtml(meta.baseMsg || '');
    const benchMsg = _escapeHtml(meta.benchMsg || '');
    const missingMsg = _escapeHtml(meta.missingMsg || '');
    statusEl.innerHTML = `<span style="color:var(--muted)">${baseMsg} · ${benchMsg}${missingMsg}</span>`;
    return;
  }
  if (type === 'error') {
    statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${_escapeHtml(meta.message || '알 수 없는 오류')}</span>`;
  }
}

function _toggleHistBenchmark(type) {
  if (!HIST_BENCHMARK_TYPES.includes(type)) return;
  const next = new Set(_getHistBenchmarks());
  if (next.has(type)) next.delete(type);
  else next.add(type);
  _setHistBenchmarks(Array.from(next));
}

function _renderHistBenchmarkButtons() {
  const selected = new Set(_getHistBenchmarks());
  document.querySelectorAll('#histBenchmarkMulti .hist-bench-btn').forEach(btn => {
    const type = btn.dataset?.bench || '';
    const isClear = type === 'CLEAR';
    const active = !isClear && selected.has(type);
    btn.classList.toggle('active', active);
  });
}

function _setHistMode(mode) {
  _setHistModeState(mode);
  _applyHistModeUI(_getHistMode());
  loadHistoryChart();
}

function _applyHistModeUI(mode) {
  const wBtn = $el('histModeWeek');
  const mBtn = $el('histModeMonth');
  if (!wBtn || !mBtn) return;
  [wBtn, mBtn].forEach(b => {
    b.style.background = 'transparent';
    b.style.color = 'var(--muted)';
    b.style.fontWeight = '400';
  });
  const active = mode === 'week' ? wBtn : mBtn;
  active.style.background = 'var(--c-purple-45,#7c3aed)';
  active.style.color = '#fff';
  active.style.fontWeight = '600';
}
