// ════════════════════════════════════════════════════════════════
//  views_history_state.js — 히스토리 상태/컨트롤/UI 상태 메시지
// ════════════════════════════════════════════════════════════════

const _histState = {
  mode: 'week',
  benchmarks: ['KOSPI'],
  debugByDate: {},
  debugDate: '',
};

const HIST_BENCHMARK_TYPES = ['KOSPI', 'KOSDAQ', 'SP500', 'NASDAQ', 'NASDAQ100'];

function _initHistState() {
  _histState.mode = _histState.mode === 'month' ? 'month' : 'week';
  _histState.benchmarks = Array.isArray(_histState.benchmarks) ? _histState.benchmarks.slice() : ['KOSPI'];
}

function _getHistMode() {
  return _histState.mode === 'month' ? 'month' : 'week';
}

function _setHistModeState(mode) {
  _histState.mode = mode === 'month' ? 'month' : 'week';
}

function _getHistBenchmarks() {
  return Array.isArray(_histState.benchmarks) ? _histState.benchmarks.slice() : [];
}

function _setHistBenchmarks(next) {
  _histState.benchmarks = Array.isArray(next) ? next.slice() : [];
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
    statusEl.innerHTML = `<span style="color:var(--muted)">그래프 ${meta.graphCount || 0}일 · 표 ${meta.tableCount || 0}${meta.mode==='week'?'주':'개월'} · 최근: ${meta.latestDate || '-'}</span>`;
    return;
  }
  if (type === 'summary_benchmark') {
    statusEl.innerHTML = `<span style="color:var(--muted)">${meta.baseMsg || ''} · ${meta.benchMsg || ''}${meta.missingMsg || ''}</span>`;
    return;
  }
  if (type === 'error') {
    statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${meta.message || '알 수 없는 오류'}</span>`;
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
