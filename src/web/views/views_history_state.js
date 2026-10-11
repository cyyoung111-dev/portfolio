// ════════════════════════════════════════════════════════════════
//  views_history_state.js — 히스토리 상태/컨트롤/UI 상태 메시지
// ════════════════════════════════════════════════════════════════

const __histState = window.__histState || {
  mode: 'week',
  benchmarks: ['KOSPI'],
  debugByDate: {},
  debugDate: '',
  missingSnapshotDates: [],
  repairResult: null,
  repairInProgress: false,
  repairProgress: null,
  fullRepairPolling: false,
  loadRequestId: 0,
  snapshots: [],
  integrityDiagnostics: [],
  rangeDiagnosisFailed: false,
  detailDate: '',
  lastSuccessfulView: null,
};
window.__histState = __histState;

const HIST_BENCHMARK_TYPES = ['KOSPI', 'KOSDAQ', 'SP500', 'DOW', 'NASDAQ', 'NASDAQ100'];
const HIST_BENCHMARK_STORAGE_KEY = 'pf_history_benchmarks';

function _initHistState() {
  __histState.mode = ['day', 'week', 'month'].includes(__histState.mode) ? __histState.mode : 'week';
  // 이전 배포에서 선택했던 지원 종료 지수가 메모리에 남아 있어도 즉시 제거합니다.
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(HIST_BENCHMARK_STORAGE_KEY) || 'null'); } catch (e) {}
  const saved = Array.isArray(stored) ? stored : (Array.isArray(__histState.benchmarks) ? __histState.benchmarks : ['KOSPI']);
  __histState.benchmarks = saved.filter(type => HIST_BENCHMARK_TYPES.includes(type));
  try { localStorage.setItem(HIST_BENCHMARK_STORAGE_KEY, JSON.stringify(__histState.benchmarks)); } catch (e) {}
}

function _getHistMode() {
  return ['day', 'week', 'month'].includes(__histState.mode) ? __histState.mode : 'week';
}

function _setHistModeState(mode) {
  __histState.mode = ['day', 'week', 'month'].includes(mode) ? mode : 'week';
}

function _getHistBenchmarks() {
  return Array.isArray(__histState.benchmarks) ? __histState.benchmarks.slice() : [];
}

function _setHistBenchmarks(next) {
  __histState.benchmarks = Array.isArray(next) ? next.slice() : [];
  try { localStorage.setItem(HIST_BENCHMARK_STORAGE_KEY, JSON.stringify(__histState.benchmarks)); } catch (e) {}
}


function _historyDateToUtcMs(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

// Display-only exchange calendar mirrors the GAS 2026/2027 source of truth.
const HISTORY_KRX_CLOSED_DATES = { '2026': new Set(["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-02","2026-05-01","2026-05-05","2026-05-25","2026-06-03","2026-07-17","2026-08-17","2026-09-24","2026-09-25","2026-10-05","2026-10-09","2026-12-25","2026-12-31"]), '2027': new Set(["2027-01-01","2027-02-08","2027-02-09","2027-03-01","2027-05-03","2027-05-05","2027-05-13","2027-07-19","2027-08-16","2027-09-14","2027-09-15","2027-09-16","2027-10-04","2027-10-11","2027-12-27","2027-12-31"]) };
function _historyKrxSessionStatus(dateStr) {
  const ms = _historyDateToUtcMs(dateStr);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== dateStr) return 'UNKNOWN';
  if ([0,6].includes(new Date(ms).getUTCDay())) return 'CLOSED';
  const calendar = HISTORY_KRX_CLOSED_DATES[dateStr.slice(0,4)];
  return !calendar ? 'UNKNOWN' : (calendar.has(dateStr) ? 'CLOSED' : 'OPEN');
}
function _getHistorySnapshotGap(latestDate) {
  const latest = _normalizeHistDate(latestDate || '');
  const today = typeof _kstTodayStr === 'function' ? _kstTodayStr() : _normalizeHistDate(new Date());
  const latestMs = _historyDateToUtcMs(latest), todayMs = _historyDateToUtcMs(today);
  if (!Number.isFinite(latestMs) || !Number.isFinite(todayMs) || latestMs > todayMs) return null;
  const kstNow = typeof _kstNow === 'function' ? _kstNow() : new Date();
  const kstMinutes = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  const pendingToday = kstMinutes < 19 * 60 + 15; // 19:00 GAS integrated close (not 16:30 briefing)
  let days=0,unknownDates=0,firstMissingDate='';
  for(let ms=latestMs+86400000;ms<=todayMs;ms+=86400000) {
    const date=new Date(ms).toISOString().slice(0,10);
    const session=_historyKrxSessionStatus(date);
    if(session==='UNKNOWN') { unknownDates++; continue; }
    if(session==='OPEN' && !(date===today && pendingToday)) {days++;if(!firstMissingDate)firstMissingDate=date;}
  }
  return {days,unknownDates,latest,today,firstMissingDate,
    isTodayPending:pendingToday&&_historyKrxSessionStatus(today)==='OPEN'};
}
function _historySnapshotGapHtml(gap) {
  if(!gap)return '';
  let message='';
  if(gap.days>0){
    const label=gap.days===1?'거래일 1일 스냅샷 미생성':`거래일 ${gap.days}일 스냅샷 미생성`;
    message+=` · <span style="color:var(--amber)">⚠️ ${_escapeHtml(label)} (${_escapeHtml(gap.firstMissingDate)} → ${_escapeHtml(gap.today)})</span>`;
  }else if(gap.isTodayPending){
    message+=' · <span style="color:var(--muted)">오늘 19시 통합 마감 대기 중</span>';
  }
  if(gap.unknownDates)message+=' · <span style="color:var(--amber)">거래일 달력 확인 필요</span>';
  return message;
}

function _setHistoryStatus(statusEl, type, payload) {
  if (!statusEl) return;
  const meta = payload || {};
  if (type === 'no_api') {
    statusEl.innerHTML = '<span style="color:var(--amber)">⚠️ 재동기화 설정 후 이용 가능합니다.</span>';
    return;
  }
  if (type === 'loading') {
    const step = Math.min(Math.max(Number(meta.step) || 1, 1), Math.max(Number(meta.total) || 2, 1));
    const total = Math.max(Number(meta.total) || 2, 1);
    const progress = Math.round(step / total * 100);
    statusEl.innerHTML = `<div class="hist-progress" role="status">
      <div class="hist-progress-copy"><span>⏳ ${_escapeHtml(meta.message || '불러오는 중...')}</span><b>${step}/${total}</b></div>
      <div class="hist-progress-track" aria-hidden="true"><span style="width:${progress}%"></span></div>
    </div>`;
    return;
  }
  if (type === 'query_ready') {
    statusEl.innerHTML = '<span style="color:var(--muted)">조회 조건을 선택한 뒤 🔎 조회 버튼을 눌러주세요.</span>';
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
    const unit = meta.mode === 'day' ? '일' : (meta.mode === 'week' ? '주' : '개월');
    statusEl.innerHTML = `<span style="color:var(--muted)">그래프 ${graphCount}${unit} · 표 ${tableCount}${unit} · 최근: ${_escapeHtml(meta.latestDate || '-')}${_historySnapshotGapHtml(meta.snapshotGap)}</span>`;
    return;
  }
  if (type === 'summary_benchmark') {
    const baseMsg = _escapeHtml(meta.baseMsg || '');
    const benchMsg = _escapeHtml(meta.benchMsg || '');
    const missingMsg = _escapeHtml(meta.missingMsg || '');
    statusEl.innerHTML = `<span style="color:var(--muted)">${baseMsg} · ${benchMsg}${missingMsg}${_historySnapshotGapHtml(meta.snapshotGap)}</span>`;
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
  _invalidateHistoryLoad();
}

function _invalidateHistoryLoad() {
  __histState.loadRequestId++;
  const queryBtn = $el('btn-history-query');
  if (queryBtn) {
    queryBtn.disabled = false;
    queryBtn.removeAttribute('aria-busy');
    const label = queryBtn.querySelector('span');
    if (label) label.textContent = '조회';
  }
  _setHistoryStatus($el('histStatusMsg'), 'query_ready');
}

function _captureSuccessfulHistoryView() {
  const statusEl = $el('histStatusMsg');
  const coverageEl = $el('histCoveragePanel');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  if (!statusEl || !chartWrap || !chartWrap.innerHTML) return;
  __histState.lastSuccessfulView = {
    statusHtml: statusEl.innerHTML,
    coverageHtml: coverageEl?.innerHTML || '',
    chartHtml: chartWrap.innerHTML,
    tableHtml: tableWrap?.innerHTML || '',
    startMonth: String($el('histStartMonth')?.value || ''),
    range: String($el('histRangeSelect')?.value || '365'),
  };
}

function _restoreSuccessfulHistoryView() {
  const saved = __histState.lastSuccessfulView;
  if (!saved?.chartHtml) return false;
  const statusEl = $el('histStatusMsg');
  const coverageEl = $el('histCoveragePanel');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  if (!statusEl || !chartWrap) return false;
  const startMonth = $el('histStartMonth');
  const range = $el('histRangeSelect');
  if (startMonth) startMonth.value = saved.startMonth || startMonth.value;
  if (range) range.value = saved.range || range.value;
  statusEl.innerHTML = saved.statusHtml || '';
  if (coverageEl) coverageEl.innerHTML = saved.coverageHtml || '';
  chartWrap.innerHTML = saved.chartHtml;
  if (tableWrap) tableWrap.innerHTML = saved.tableHtml || '';
  return true;
}

function _applyHistModeUI(mode) {
  const dBtn = $el('histModeDay');
  const wBtn = $el('histModeWeek');
  const mBtn = $el('histModeMonth');
  if (!dBtn || !wBtn || !mBtn) return;
  [dBtn, wBtn, mBtn].forEach(b => {
    b.style.background = 'transparent';
    b.style.color = 'var(--muted)';
    b.style.fontWeight = '400';
  });
  const active = mode === 'day' ? dBtn : (mode === 'week' ? wBtn : mBtn);
  active.style.background = 'var(--c-purple-45,#7c3aed)';
  // 활성 배경은 모든 프리셋에서 진한 보라색이므로 흰색 텍스트로 대비를 유지합니다.
  active.style.color = '#fff';
  active.style.fontWeight = '600';
}
