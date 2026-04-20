// ════════════════════════════════════════════════════════════════
//  views_history.js — 스냅샷 히스토리, 구글시트탭, 종목코드탭
//  의존: data.js, settings.js, views_system.js
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
            <button type="button" id="histBenchClear" class="hist-bench-btn" data-bench="CLEAR" style="border-style:dashed;color:var(--muted)">해제</button>
          </div>
          <button id="btn-history-refresh" class="btn-ghost-sm">🔄 새로고침</button>
        </div>
      </div>
      <div id="histStatusMsg" style="font-size:.72rem;color:var(--muted);margin-bottom:8px"></div>
      <div id="histChartWrap" style="width:100%;overflow-x:auto"></div>
      <div id="histTableWrap" style="margin-top:18px"></div>
    </div>`;
  window._histMode = window._histMode || 'week';
  window._histBenchmarks = Array.isArray(window._histBenchmarks) ? window._histBenchmarks : ['KOSPI'];
  _applyHistModeUI(window._histMode);
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
    if (type === 'CLEAR') window._histBenchmarks = [];
    else _toggleHistBenchmark(type);
    _renderHistBenchmarkButtons();
    loadHistoryChart();
  });
}

const HIST_BENCHMARK_TYPES = ['KOSPI', 'KOSDAQ', 'SP500', 'NASDAQ', 'NASDAQ100'];

function _toggleHistBenchmark(type) {
  if (!HIST_BENCHMARK_TYPES.includes(type)) return;
  const next = new Set(Array.isArray(window._histBenchmarks) ? window._histBenchmarks : []);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  window._histBenchmarks = Array.from(next);
}

function _renderHistBenchmarkButtons() {
  const selected = new Set(Array.isArray(window._histBenchmarks) ? window._histBenchmarks : []);
  document.querySelectorAll('#histBenchmarkMulti .hist-bench-btn').forEach(btn => {
    const type = btn.dataset?.bench || '';
    const isClear = type === 'CLEAR';
    const active = !isClear && selected.has(type);
    btn.style.border = active ? '1px solid var(--amber)' : '1px solid var(--border)';
    btn.style.background = active ? 'var(--c-amber-15)' : 'transparent';
    btn.style.color = active ? 'var(--gold)' : 'var(--muted)';
    btn.style.padding = '4px 8px';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '.68rem';
    btn.style.fontWeight = active ? '700' : '500';
  });
}

function _setHistMode(mode) {
  window._histMode = mode;
  window.mode = mode;
  _applyHistModeUI(mode);
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

async function loadHistoryChart() {
  const statusEl = $el('histStatusMsg');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  if (!chartWrap) return;

  if (!GSHEET_API_URL) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--amber)">⚠️ 재동기화 설정 후 이용 가능합니다.</span>';
    chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">⏳ 불러오는 중...</span>';
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
    const url = GSHEET_API_URL + '?action=getHistory' + (fromStr ? ('&from=' + fromStr) : '');
    const res  = await fetchWithTimeout(url, 15000);
    const data = await res.json();
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">스냅샷 데이터가 없습니다. 데이터가 쌓이면 자동으로 표시됩니다.</span>';
      return;
    }

    snapshots = snapshots
      .map(s => ({ ...s, date: _normalizeHistDate(s.date || '') }))
      .filter(s => !!s.date)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!snapshots.length) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">선택한 기간에 데이터가 없습니다.</span>';
      return;
    }

    // 거래이력 기반 원가 재계산값이 있으면 우선 적용
    snapshots = _mergeTradeBasedCost(snapshots);
    const mode = window._histMode || 'week';
    const tableSnapshots = mode === 'week' ? _filterWeeklyFriday(snapshots) : _filterMonthEnd(snapshots);

    if (statusEl) statusEl.innerHTML =
      `<span style="color:var(--muted)">그래프 ${snapshots.length}일 · 표 ${tableSnapshots.length}${mode==='week'?'주':'개월'} · 최근: ${_fmtHistDateCompact(snapshots[snapshots.length-1].date || '')}</span>`;

    const benchmarkTypes = Array.from(new Set(
      (Array.isArray(window._histBenchmarks) ? window._histBenchmarks : [])
        .map(v => String(v || '').toUpperCase().trim())
        .filter(v => HIST_BENCHMARK_TYPES.includes(v))
    ));
    // ★ [버그수정] Promise.all → 순차 직렬 요청
    //   GAS 웹앱은 동시 다중 요청을 직렬로 처리하므로 병렬 요청 시
    //   _bm_* 시트 간 flush/sleep 타이밍이 겹쳐 대부분 빈 결과 반환됨
    const benchSeriesMap = {};
    const benchMetaMap = {};
    for (const type of benchmarkTypes) {
      const payload = await _fetchBenchmarkSeries(type, snapshots[0].date, snapshots[snapshots.length - 1].date);
      benchSeriesMap[type] = Array.isArray(payload?.points) ? payload.points : [];
      benchMetaMap[type] = payload?.symbol || '';
    }

    const missing = benchmarkTypes.filter(type => (benchSeriesMap[type] || []).length === 0);
    if (statusEl) {
      const baseMsg = `그래프 ${snapshots.length}일 · 표 ${tableSnapshots.length}${mode==='week'?'주':'개월'} · 최근: ${_fmtHistDateCompact(snapshots[snapshots.length-1].date || '')}`;
      const benchMsg = benchmarkTypes.length === 0
        ? '비교지수 없음'
        : `비교지수 ${benchmarkTypes.length - missing.length}/${benchmarkTypes.length}개 로드`;
      const missingMsg = missing.length ? ` (실패: ${missing.join(', ')})` : '';
      statusEl.innerHTML = `<span style="color:var(--muted)">${baseMsg} · ${benchMsg}${missingMsg}</span>`;
    }

    _drawHistoryChart(chartWrap, snapshots, mode, { types: benchmarkTypes, seriesMap: benchSeriesMap, metaMap: benchMetaMap });
    _drawHistoryTable(tableWrap, tableSnapshots);

  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${e.message}</span>`;
  }
}

async function _fetchBenchmarkSeries(type, fromDate, toDate) {
  if (!GSHEET_API_URL || !type || !fromDate || !toDate) return { points: [], symbol: '' };
  try {
    const url = GSHEET_API_URL
      + '?action=getBenchmark'
      + '&benchmark=' + encodeURIComponent(type)
      + '&from=' + encodeURIComponent(fromDate)
      + '&to=' + encodeURIComponent(toDate);
    const res = await fetchWithTimeout(url, 15000);
    const data = await res.json();
    if (!data || data.status === 'error') return { points: [], symbol: '' };
    const arr = Array.isArray(data.points) ? data.points : [];
    const points = arr
      .map(p => ({ date: _normalizeHistDate(p.date || ''), value: parseFloat(p.value || 0) }))
      .filter(p => p.date && p.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { points, symbol: (data.symbol || '').toString().trim() };
  } catch(_) {
    return { points: [], symbol: '' };
  }
}

function _drawHistoryChart(wrap, snapshots, _mode, benchmarkOpt) {
  const W = Math.min(wrap.clientWidth || 700, 900);
  const H = 260;
  const PAD = { top: 20, right: 54, bottom: 52, left: 72 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  // 데이터 추출 (손익 중심)
  const pts = snapshots.map(s => ({
    date: _fmtHistDateShort(s.date || ''),
    cost: parseFloat(s.costAmt || s.cost || 0),
    eval: parseFloat(s.evalAmt || s.total || s.eval || 0),
  }));
  pts.forEach(p => { p.pnl = p.eval - p.cost; });

  const minMoney = Math.min(...pts.map(p => p.pnl));
  const maxMoney = Math.max(...pts.map(p => p.pnl));
  const moneyPad = (maxMoney - minMoney) * 0.1 || Math.max(Math.abs(maxMoney), Math.abs(minMoney)) * 0.08 || 1000000;
  const yMoneyMin = minMoney - moneyPad;
  const yMoneyMax = maxMoney + moneyPad;

  const xScale = i => PAD.left + (i / (pts.length - 1 || 1)) * CW;
  const yMoney = v => PAD.top + CH - ((v - yMoneyMin) / (yMoneyMax - yMoneyMin || 1)) * CH;

  // 손익 polyline
  const pnlPts  = pts.map((p, i) => `${xScale(i).toFixed(1)},${yMoney(p.pnl).toFixed(1)}`).join(' ');
  // 손익 fill path (0선 기준)
  const zero    = yMoney(0).toFixed(1);
  const pnlFill = `M${xScale(0).toFixed(1)},${zero} ` +
    pts.map((p, i) => `L${xScale(i).toFixed(1)},${yMoney(p.pnl).toFixed(1)}`).join(' ') +
    ` L${xScale(pts.length-1).toFixed(1)},${zero} Z`;

  // x축 레이블 (최대 5개 + 마지막)
  const labelStep = Math.max(1, Math.ceil(pts.length / 5));
  let xLabels = '';
  for (let i = 0; i < pts.length; i += labelStep) {
    xLabels += `<text x="${xScale(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${pts[i].date || ''}</text>`;
  }
  if ((pts.length - 1) % labelStep !== 0) {
    xLabels += `<text x="${xScale(pts.length - 1).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${pts[pts.length - 1].date || ''}</text>`;
  }

  // 비교지수 정렬 (우측축, 복수 선택)
  const benchTypes = Array.isArray(benchmarkOpt?.types) ? benchmarkOpt.types : [];
  const benchSeriesMap = benchmarkOpt?.seriesMap || {};
  const benchColors = ['#60a5fa', '#22c55e', '#f59e0b', '#a78bfa', '#fb7185'];
  const benchLines = benchTypes.map((benchType, idx) => {
    const benchRaw = Array.isArray(benchSeriesMap[benchType]) ? benchSeriesMap[benchType] : [];
    const benchByDate = {};
    benchRaw.forEach(b => { if (b.date && b.value > 0) benchByDate[b.date] = b.value; });

    // ★ [버그수정] base 계산 개선 — 스냅샷 시작일 기준 지수값을 정확히 찾기
    //   기존: carry-over 후 arr[0].raw → 지수 데이터가 스냅샷 시작일보다 늦게 시작하면
    //         첫 carry값이 base가 되어 수익률이 왜곡됨
    //   수정: 스냅샷 첫 날짜 이전 중 가장 가까운 지수값을 base로 사용
    const firstSnapshotDate = snapshots[0]?.date || '';
    let base = 0;
    if (firstSnapshotDate) {
      if (benchByDate[firstSnapshotDate]) {
        base = benchByDate[firstSnapshotDate];
      } else {
        const sortedBenchDates = Object.keys(benchByDate).sort();
        // 스냅샷 시작일 이전 중 가장 가까운 날짜 (carry-back)
        for (let di = sortedBenchDates.length - 1; di >= 0; di--) {
          if (sortedBenchDates[di] <= firstSnapshotDate) {
            base = benchByDate[sortedBenchDates[di]];
            break;
          }
        }
        // carry-back 없으면 가장 첫 값 사용
        if (!base && sortedBenchDates.length > 0) base = benchByDate[sortedBenchDates[0]];
      }
    }

    // carry-over: 스냅샷 날짜별 지수값 매핑 (해당 날짜 없으면 직전값 사용)
    let lastBench = 0;
    const arr = pts.map((p, i) => {
      const date = snapshots[i]?.date || '';
      const now = benchByDate[date];
      if (now > 0) lastBench = now;
      return { i, date, raw: lastBench || 0 };
    }).filter(b => b.raw > 0);
    arr.forEach(b => { b.idx = base > 0 ? (b.raw / base * 100) : 0; });
    return { type: benchType, color: benchColors[idx % benchColors.length], pts: arr };
  }).filter(x => x.pts.length > 1);
  const hasBench = benchLines.length > 0;
  const allIdx = hasBench ? benchLines.flatMap(x => x.pts.map(p => p.idx)) : [];
  const minIdx = hasBench ? Math.min(...allIdx) : 90;
  const maxIdx = hasBench ? Math.max(...allIdx) : 110;
  const idxPad = (maxIdx - minIdx) * 0.15 || 5;
  const yIdxMin = minIdx - idxPad;
  const yIdxMax = maxIdx + idxPad;
  const yIdx = v => PAD.top + CH - ((v - yIdxMin) / (yIdxMax - yIdxMin || 1)) * CH;
  const benchLineSvg = hasBench
    ? benchLines.map(line => {
        const ptsStr = line.pts.map((b) => `${xScale(b.i).toFixed(1)},${yIdx(b.idx).toFixed(1)}`).join(' ');
        return `<polyline points="${ptsStr}" fill="none" stroke="${line.color}" stroke-width="2.1" stroke-linejoin="round"/>`;
      }).join('')
    : '';

  // y축 레이블 (왼쪽: 금액, 오른쪽: 지수)
  let yLabels = '';
  let yLabelsRight = '';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const moneyV = yMoneyMin + (yMoneyMax - yMoneyMin) * (i / yTicks);
    const idxV   = yIdxMin + (yIdxMax - yIdxMin) * (i / yTicks);
    const y = yMoney(moneyV).toFixed(1);
    yLabels += `<text x="${PAD.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="var(--muted)">${_fmtAxisKrw(moneyV)}</text>`;
    yLabelsRight += `<text x="${PAD.left + CW + 5}" y="${y}" dominant-baseline="middle" font-size="10" fill="var(--muted)">${hasBench ? idxV.toFixed(1) : ''}</text>`;
    yLabels += `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + CW}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  }

  // 마지막 포인트 표시
  const lastPt = pts[pts.length - 1];
  const lastX  = xScale(pts.length - 1);
  const pnlColor = lastPt.pnl >= 0 ? 'var(--green)' : 'var(--red)';

  wrap.innerHTML = `
    <svg width="${W}" height="${H}" style="display:block;max-width:100%;font-variant-numeric:tabular-nums">
      <defs>
        <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lastPt.pnl >= 0 ? '#22c55e' : '#ef4444'}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${lastPt.pnl >= 0 ? '#22c55e' : '#ef4444'}" stop-opacity="0.03"/>
        </linearGradient>
      </defs>
      ${yLabels}
      ${yLabelsRight}
      ${xLabels}
      <!-- 손익 fill -->
      <path d="${pnlFill}" fill="url(#pnlGrad)" />
      <!-- 0선 -->
      <line x1="${PAD.left}" y1="${zero}" x2="${PAD.left + CW}" y2="${zero}"
        stroke="${lastPt.pnl >= 0 ? 'var(--green)' : 'var(--red)'}" stroke-width="0.8" stroke-dasharray="3,3"/>
      <!-- 손익 라인 -->
      <polyline points="${pnlPts}" fill="none" stroke="${pnlColor}" stroke-width="2" stroke-linejoin="round"/>
      ${benchLineSvg}
      <!-- 마지막 포인트 dot -->
      <circle cx="${lastX.toFixed(1)}" cy="${yMoney(lastPt.pnl).toFixed(1)}" r="3.5" fill="${pnlColor}"/>
      <!-- 범례 -->
      <line x1="${PAD.left + 4}" y1="${PAD.top + 10}" x2="${PAD.left + 20}" y2="${PAD.top + 10}" stroke="${pnlColor}" stroke-width="2"/>
      <text x="${PAD.left + 24}" y="${PAD.top + 14}" font-size="10" fill="var(--muted)">손익</text>
      ${hasBench ? benchLines.map((line, i) => {
        const sx = PAD.left + 72 + i * 100;
        return `<line x1="${sx}" y1="${PAD.top + 10}" x2="${sx + 14}" y2="${PAD.top + 10}" stroke="${line.color}" stroke-width="2"/>
      <text x="${sx + 18}" y="${PAD.top + 14}" font-size="10" fill="var(--muted)">${line.type}</text>`;
      }).join('') : ''}
    </svg>
    ${hasBench ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:.68rem">
      ${benchLines.map(line => {
        const last = line.pts[line.pts.length - 1];
        const delta = last ? (last.idx - 100) : 0;
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--border);border-radius:999px;background:var(--s2)">
          <span style="width:8px;height:8px;border-radius:999px;background:${line.color}"></span>
          <span style="color:var(--muted)">${line.type}</span>
          <span style="color:${line.color};font-weight:700">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</span>
        </span>`;
      }).join('')}
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-top:10px;font-variant-numeric:tabular-nums">
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">현재 손익</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${pSign(lastPt.pnl)}${_fmtKrw(lastPt.pnl)}</div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">수익률</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${lastPt.cost > 0 ? (pSign(lastPt.pnl) + (lastPt.pnl/lastPt.cost*100).toFixed(1) + '%') : '-'}</div>
      </div>
      ${hasBench ? benchLines.map(line => {
        const last = line.pts[line.pts.length - 1];
        const delta = last ? (last.idx - 100) : 0;
        return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">${line.type} 변화</div>
        <div style="font-size:.88rem;font-weight:700;color:${line.color}">${(delta >= 0 ? '+' : '') + delta.toFixed(1)}%</div>
      </div>`;
      }).join('') : ''}
    </div>`;
}

function _drawHistoryTable(wrap, snapshots) {
  const fmt = _fmtKrw;
  const mode = window._histMode || 'week';
  const recent = [...snapshots].reverse().slice(0, 20);
  const diagnostics = _buildHistoryDiagnostics(snapshots);
  window._histDebugByDate = diagnostics;
  let html = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:6px">최근 스냅샷 (최대 20개 · ${mode==='week'?'주간 기준':'월간 기준'})</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.72rem;font-variant-numeric:tabular-nums">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--muted)">
          <th style="text-align:left;padding:4px 6px;font-weight:600">날짜</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">평가금액</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">매입원가(거래기준)</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">손익</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">수익률</th>
        </tr>
      </thead>
      <tbody>`;
  recent.forEach(s => {
    const ev   = parseFloat(s.evalAmt || s.total || s.eval || 0);
    const co   = parseFloat(s.costAmt || s.cost || 0);
    const pnl  = ev - co;
    const pct  = co > 0 ? (pnl / co * 100).toFixed(1) : '-';
    const c    = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    html += `<tr style="border-bottom:1px solid var(--c-black-12)">
      <td style="padding:5px 6px;color:var(--muted);white-space:nowrap">${_fmtHistDateCompact(s.date || '')}</td>
      <td style="padding:5px 6px;text-align:right;color:var(--text)">${fmt(ev)}</td>
      <td style="padding:5px 6px;text-align:right;color:var(--muted)">${fmt(co)}</td>
      <td style="padding:5px 6px;text-align:right;color:${c}">${pSign(pnl)}${fmt(pnl)}</td>
      <td style="padding:5px 6px;text-align:right;color:${c}">${pct !== '-' ? pSign(pnl) + pct + '%' : '-'}</td>
    </tr>`;
  });
  html += `</tbody></table></div><div id="histDebugPanel" style="margin-top:8px"></div>`;
  wrap.innerHTML = html;
  _renderHistDebugPanel(window._histDebugDate || '');
}

function _buildHistoryDiagnostics(snapshots) {
  const out = {};
  if (!Array.isArray(snapshots) || snapshots.length < 2) return out;
  for (let i = 1; i < snapshots.length; i++) {
    const cur = snapshots[i], prev = snapshots[i - 1];
    const curEval = parseFloat(cur.evalAmt || cur.total || cur.eval || 0);
    const curCost = parseFloat(cur.costAmt || cur.cost || 0);
    const prevEval = parseFloat(prev.evalAmt || prev.total || prev.eval || 0);
    const prevCost = parseFloat(prev.costAmt || prev.cost || 0);
    const curQty = parseFloat(cur.qty || 0);
    const prevQty = parseFloat(prev.qty || 0);
    const dEval = curEval - prevEval;
    const dCost = curCost - prevCost;
    const absEval = Math.abs(dEval);
    const absCost = Math.abs(dCost);
    const prevEvalAbs = Math.max(1, Math.abs(prevEval));
    const evalJumpPct = absEval / prevEvalAbs;
    if (evalJumpPct >= 0.6 && absCost <= Math.max(100000000, prevCost * 0.1)) {
      out[cur.date] = {
        level: 'warn',
        note: `중복집계 의심 (평가 ${dEval>=0?'+':''}${_fmtKrw(dEval)}, 원가 ${dCost>=0?'+':''}${_fmtKrw(dCost)})`,
        curEval, prevEval, curCost, prevCost, curQty, prevQty, dEval, dCost, evalJumpPct,
      };
    } else if (absEval >= 500000000 && absCost <= Math.max(100000000, absEval * 0.12)) {
      out[cur.date] = {
        level: 'warn',
        note: `가격 영향 큼 (평가 ${dEval>=0?'+':''}${_fmtKrw(dEval)}, 원가 ${dCost>=0?'+':''}${_fmtKrw(dCost)})`,
        curEval, prevEval, curCost, prevCost, curQty, prevQty, dEval, dCost, evalJumpPct,
      };
    } else if (absCost >= 300000000) {
      out[cur.date] = {
        level: 'info',
        note: `매수/매도 영향 (원가 ${dCost>=0?'+':''}${_fmtKrw(dCost)})`,
        curEval, prevEval, curCost, prevCost, curQty, prevQty, dEval, dCost, evalJumpPct,
      };
    }
  }
  return out;
}

function _toggleHistDebug(date) {
  window._histDebugDate = (window._histDebugDate === date) ? '' : date;
  _renderHistDebugPanel(window._histDebugDate);
}

function _renderHistDebugPanel(date) {
  const panel = $el('histDebugPanel');
  if (!panel) return;
  const d = (window._histDebugByDate || {})[date];
  if (!date || !d) {
    panel.innerHTML = '';
    return;
  }
  const tone = d.level === 'warn' ? 'var(--amber)' : 'var(--muted)';
  panel.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;background:var(--s2);padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:.72rem;font-weight:700;color:${tone}">🧪 ${_fmtHistDateCompact(date)} 디버그</div>
        <button data-action="toggle-hist-debug" data-date="${date}" style="border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:.7rem">닫기</button>
      </div>
      <div style="font-size:.66rem;color:var(--text);line-height:1.7">
        <div>• 진단: <span style="color:${tone}">${d.note}</span></div>
        <div>• 평가금액: ${_fmtKrw(d.prevEval)} → ${_fmtKrw(d.curEval)} (${d.dEval>=0?'+':''}${_fmtKrw(d.dEval)})</div>
        <div>• 매입원가: ${_fmtKrw(d.prevCost)} → ${_fmtKrw(d.curCost)} (${d.dCost>=0?'+':''}${_fmtKrw(d.dCost)})</div>
        <div>• 수량: ${(d.prevQty||0).toLocaleString()} → ${(d.curQty||0).toLocaleString()}</div>
        <div>• 평가단가(역산): ${d.prevQty>0 ? Math.round(d.prevEval/d.prevQty).toLocaleString() : '-'} → ${d.curQty>0 ? Math.round(d.curEval/d.curQty).toLocaleString() : '-'}</div>
        <div>• 평가 변동률(직전 대비): ${(d.evalJumpPct*100).toFixed(1)}%</div>
      </div>
    </div>`;
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

// ════════════════════════════════════════════════════════════════
//  renderGsheetView — 구글시트 연동 설정 탭
// ════════════════════════════════════════════════════════════════
function renderGsheetView(area) {
  const currentUrl = GSHEET_API_URL || '';
  const isLinked = !!currentUrl;

  area.innerHTML = `
    <div style="padding:12px 0 8px">
      <div style="font-size:.80rem;font-weight:700;color:var(--text);margin-bottom:16px">🔗 구글시트 연동</div>

      <!-- 연동 상태 카드 -->
      <div style="background:${isLinked ? 'var(--c-green-08)' : 'var(--s2)'};
                  border:1px solid ${isLinked ? 'var(--c-green-30)' : 'var(--border)'};
                  border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <div style="font-size:1.3rem">${isLinked ? '✅' : '⭕'}</div>
        <div>
          <div style="font-size:.78rem;font-weight:700;color:${isLinked ? 'var(--green)' : 'var(--muted)'}">${isLinked ? '연동됨' : '연동 안됨'}</div>
          <div style="font-size:.65rem;color:var(--muted);margin-top:2px;word-break:break-all">${isLinked ? currentUrl.slice(0, 60) + (currentUrl.length > 60 ? '…' : '') : '구글 Apps Script 웹앱 URL을 입력하세요'}</div>
        </div>
        ${isLinked ? `<button id="btn-clear-gsheet-url" class="btn-del-sm" style="margin-left:auto;flex-shrink:0">해제</button>` : ''}
      </div>

      <!-- URL 입력 -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:8px">Apps Script 웹앱 URL</div>
        <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap">
          <input id="gsheetUrlInput" type="text"
            value="${currentUrl.replace(/"/g,'&quot;')}"
            placeholder="https://script.google.com/macros/s/..."
            style="flex:1;background:var(--s1);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:.73rem;min-width:0"
          />
          <button id="btn-save-gsheet-url" class="btn-purple-sm">저장 · 연결 테스트</button>
        </div>
        <div id="gsheetTestResult" style="margin-top:8px;font-size:.68rem;color:var(--muted);min-height:1.2em"></div>
      </div>

      <!-- 안내 -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:10px">📋 연동 방법</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:.70rem;color:var(--muted);line-height:1.6">
          <div><span style="color:var(--c-purple-45);font-weight:700">①</span> Google Drive에서 새 스프레드시트 생성</div>
          <div><span style="color:var(--c-purple-45);font-weight:700">②</span> 확장 프로그램 → Apps Script 열기</div>
          <div><span style="color:var(--c-purple-45);font-weight:700">③</span> <code style="background:var(--s1);padding:1px 5px;border-radius:3px;font-size:.68rem">apps_script.gs</code> 코드를 붙여넣기 후 저장</div>
          <div><span style="color:var(--c-purple-45);font-weight:700">④</span> 배포 → 새 배포 → 웹앱 선택 → 액세스: <b style="color:var(--text)">모든 사용자</b></div>
          <div><span style="color:var(--c-purple-45);font-weight:700">⑤</span> 생성된 웹앱 URL을 위 입력창에 붙여넣고 <b style="color:var(--text)">저장 · 연결 테스트</b></div>
        </div>
      </div>

    </div>`;
}

// ════════════════════════════════════════════════════════════════
//  renderStocksView — 기초정보 탭 (계좌·종목·섹터 관리)
// ════════════════════════════════════════════════════════════════
function renderStocksView(area) {
  area.innerHTML = `
    <div style="padding:12px 0 8px;display:flex;flex-direction:column;gap:20px">

      ${renderTabSyncPanel('stocks')}

      <!-- ── 계좌 관리 ── -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">🏦 계좌 관리</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button id="btn-acct-add" class="btn-purple-sm">➕ 계좌 추가</button>
          </div>
        </div>
        <div id="acctMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <!-- 계좌 추가 폼 -->
        <div id="acctMgmtNewWrap" style="display:none;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--amber);font-weight:700;margin-bottom:8px">➕ 새 계좌 추가</div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
            <input id="acctMgmtNewInput" type="text" placeholder="계좌명 입력"
              style="flex:1;background:var(--s1);border:1px solid rgba(251,191,36,.4);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem" />
          </div>
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:6px">색상 선택</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div id="acctNewColorPreview" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;border:2px solid var(--border)"></div>
            <div id="acctNewColorDots" class="flex-wrap-gap4"></div>
          </div>
          <input type="hidden" id="acctMgmtNewColor" />
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="btn-acct-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-acct-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="acctMgmtList"></div>
      </div>

      <!-- ── 종목 관리 ── -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">📋 종목 관리</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button id="btn-sm-add" class="btn-purple-sm">➕ 종목 추가</button>
            <label class="btn-ghost-sm" style="cursor:pointer">
              📂 xlsx/csv 업로드
              <input id="smCsvFileInput" type="file" accept=".xlsx,.csv" style="display:none"/>
            </label>
            <button id="btn-sm-template" class="btn-ghost-sm">⬇️ 양식</button>
          </div>
        </div>
        <div id="smMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <!-- 종목 추가 폼 -->
        <div id="smMgmtNewWrap" style="display:none;background:var(--c-purple-06);border:1px solid var(--c-purple-30);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--c-purple-45);font-weight:700;margin-bottom:8px">➕ 새 종목 추가</div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:6px;margin-bottom:8px">
            <input id="smMgmtNewName" type="text" placeholder="종목명"
              style="background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem" />
            <input id="smMgmtNewCode" type="text" placeholder="종목코드" maxlength="6"
              style="background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem;font-family:'Courier New',monospace;text-align:center" />
          </div>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;margin-bottom:4px">유형</div>
          <div id="smTypeGroup" class="flex-wrap-gap3" style="margin-bottom:10px"></div>
          <input type="hidden" id="smMgmtNewType" value="주식"/>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;margin-bottom:4px">섹터</div>
          <div id="smSecGroup" class="flex-wrap-gap3" style="margin-bottom:10px"></div>
          <input type="hidden" id="smMgmtNewSec" value="기타"/>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="btn-sm-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-sm-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="stockMgmtSort"></div>
        <div id="stockMgmtBody" style="max-height:420px;overflow-y:auto"></div>
      </div>

      <!-- ── 섹터 관리 ── -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">📂 섹터 관리</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button id="btn-sec-add" class="btn-purple-sm">➕ 섹터 추가</button>
            <label class="btn-ghost-sm" style="cursor:pointer">
              📂 xlsx/csv 업로드
              <input id="secCsvFileInput" type="file" accept=".xlsx,.csv" style="display:none"/>
            </label>
            <button id="btn-sec-template" class="btn-ghost-sm">⬇️ 양식</button>
          </div>
        </div>
        <div id="secMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <!-- 섹터 추가 폼 -->
        <div id="secMgmtNewWrap" style="display:none;background:var(--c-purple-06);border:1px solid var(--c-purple-30);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--c-purple-45);font-weight:700;margin-bottom:8px">➕ 새 섹터 추가</div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
            <input id="secMgmtNewName" type="text" placeholder="섹터명 입력"
              style="flex:1;background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem" />
          </div>
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:6px">색상 선택</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div id="secNewColorPreview" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;border:2px solid var(--border)"></div>
            <div id="secNewColorDots" class="flex-wrap-gap4"></div>
          </div>
          <input type="hidden" id="secMgmtNewColor" />
          <div style="display:flex;gap:6px">
            <button id="btn-sec-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-sec-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="sectorMgmtBody"></div>
      </div>

    </div>`;

  // 각 관리 UI 초기화
  buildAcctMgmt();
  buildStockMgmt();
  buildSectorMgmt();
}
