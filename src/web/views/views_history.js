// ════════════════════════════════════════════════════════════════
//  views_history.js — 스냅샷 히스토리, 구글시트탭, 종목코드탭
//  의존: data.js, settings.js, views_system.js
// ════════════════════════════════════════════════════════════════
// 과거 버전에서 참조하던 전역 방어 (캐시된 스크립트 혼재 시 ReferenceError 방지)
if (typeof window.realEstatePnl === 'undefined') window.realEstatePnl = 0;
var realEstatePnl = window.realEstatePnl || 0;
// 과거/캐시된 코드에서 bare `mode` 참조 시 안전장치
if (typeof window.mode === 'undefined') window.mode = 'week';
var mode = window.mode;

function renderHistoryView(area) {
  area.innerHTML = `
    <div style="padding:12px 0 8px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <div style="font-size:.80rem;font-weight:700;color:var(--text)">📈 손익 그래프</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;background:var(--s2);border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button id="histModeWeek" onclick="_setHistMode('week')" style="padding:4px 10px;font-size:.70rem;border:none;cursor:pointer">주간</button>
            <button id="histModeMonth" onclick="_setHistMode('month')" style="padding:4px 10px;font-size:.70rem;border:none;cursor:pointer">월간</button>
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
          <button onclick="loadHistoryChart()" class="btn-ghost-sm">🔄 새로고침</button>
        </div>
      </div>
      <div id="histStatusMsg" style="font-size:.72rem;color:var(--muted);margin-bottom:8px"></div>
      <div id="histChartWrap" style="width:100%;overflow-x:auto"></div>
      <div id="histTableWrap" style="margin-top:18px"></div>
    </div>`;
  window._histMode = window._histMode || 'week';
  _applyHistModeUI(window._histMode);
  const monthEl = $el('histStartMonth');
  if (monthEl && !monthEl.value) {
    const d = new Date();
    monthEl.value = `${d.getFullYear()}-01`;
  }
  loadHistoryChart();
  $el('histRangeSelect')?.addEventListener('change', loadHistoryChart);
  $el('histStartMonth')?.addEventListener('change', loadHistoryChart);
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

    // 범위 필터
    const days = parseInt($el('histRangeSelect')?.value || '365');
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutStr = cutoff.toISOString().slice(0, 10).replace(/-/g, '.');
      snapshots = snapshots.filter(s => (s.date || '') >= cutStr);
    }

    if (!snapshots.length) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">선택한 기간에 데이터가 없습니다.</span>';
      return;
    }

    if (statusEl) statusEl.innerHTML =
      `<span style="color:var(--muted)">총 ${snapshots.length}${mode==='week'?'주':'개월'} · 최근: ${_fmtHistDateCompact(snapshots[snapshots.length-1].date || '')}</span>`;

    // 거래이력 기반 원가 재계산값이 있으면 우선 적용
    snapshots = _mergeTradeBasedCost(snapshots);

    _drawHistoryChart(chartWrap, snapshots, mode);
    _drawHistoryTable(tableWrap, snapshots);

  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${e.message}</span>`;
  }
}

function _drawHistoryChart(wrap, snapshots) {
  const fmt = _fmtKrw;
  const mode = window._histMode || 'week';
  const W = Math.min(wrap.clientWidth || 700, 900);
  const H = 260;
  const PAD = { top: 20, right: 54, bottom: 52, left: 72 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  // 데이터 추출 (evalAmt = 평가금액, pnl = 손익)
  const pts = snapshots.map(s => ({
    date: mode === 'week' ? _fmtHistDateShortWeek(s.date || '') : _fmtHistDateShortMonth(s.date || ''),
    eval: parseFloat(s.evalAmt || s.total || s.eval || 0),
    cost: parseFloat(s.costAmt || s.cost || 0),
    realPnl: realEstatePnl,
  }));
  pts.forEach(p => { p.pnl = p.eval - p.cost; });

  const minEval = Math.min(...pts.map(p => p.eval));
  const maxEval = Math.max(...pts.map(p => p.eval));
  const minPnl  = Math.min(...pts.map(p => p.pnl));
  const maxPnl  = Math.max(...pts.map(p => p.pnl));

  // y축 범위 (약간 여백)
  const evalPad = (maxEval - minEval) * 0.1 || maxEval * 0.05 || 1000000;
  const pnlPad  = (Math.max(Math.abs(maxPnl), Math.abs(minPnl))) * 0.15 || 1000000;
  const yEvalMin = minEval - evalPad;
  const yEvalMax = maxEval + evalPad;
  const yPnlMin  = minPnl  - pnlPad;
  const yPnlMax  = maxPnl  + pnlPad;

  const xScale = i => PAD.left + (i / (pts.length - 1 || 1)) * CW;
  const yEval  = v => PAD.top + CH - ((v - yEvalMin) / (yEvalMax - yEvalMin || 1)) * CH;
  const yPnl   = v => PAD.top + CH - ((v - yPnlMin) / (yPnlMax - yPnlMin || 1)) * CH;

  // 평가금액 polyline
  const evalPts = pts.map((p, i) => `${xScale(i).toFixed(1)},${yEval(p.eval).toFixed(1)}`).join(' ');
  // 손익 polyline
  const pnlPts  = pts.map((p, i) => `${xScale(i).toFixed(1)},${yPnl(p.pnl).toFixed(1)}`).join(' ');
  // 손익 fill path (0선 기준)
  const zero    = yPnl(0).toFixed(1);
  const pnlFill = `M${xScale(0).toFixed(1)},${zero} ` +
    pts.map((p, i) => `L${xScale(i).toFixed(1)},${yPnl(p.pnl).toFixed(1)}`).join(' ') +
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

  // y축 레이블 (왼쪽: 평가금액, 오른쪽: 손익)
  let yLabels = '';
  let yLabelsRight = '';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const evalV = yEvalMin + (yEvalMax - yEvalMin) * (i / yTicks);
    const pnlV  = yPnlMin + (yPnlMax - yPnlMin) * (i / yTicks);
    const y = yEval(evalV).toFixed(1);
    yLabels += `<text x="${PAD.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="var(--muted)">${_fmtAxisKrw(evalV)}</text>`;
    yLabelsRight += `<text x="${PAD.left + CW + 5}" y="${y}" dominant-baseline="middle" font-size="10" fill="var(--muted)">${_fmtAxisKrw(pnlV)}</text>`;
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
      <!-- 평가금액 라인 -->
      <polyline points="${evalPts}" fill="none" stroke="var(--c-purple-45)" stroke-width="1.8" stroke-linejoin="round"/>
      <!-- 손익 라인 -->
      <polyline points="${pnlPts}" fill="none" stroke="${pnlColor}" stroke-width="2" stroke-linejoin="round"/>
      <!-- 마지막 포인트 dot -->
      <circle cx="${lastX.toFixed(1)}" cy="${yEval(lastPt.eval).toFixed(1)}" r="3.5" fill="var(--c-purple-45)"/>
      <circle cx="${lastX.toFixed(1)}" cy="${yPnl(lastPt.pnl).toFixed(1)}" r="3.5" fill="${pnlColor}"/>
      <!-- 범례 -->
      <line x1="${PAD.left + 4}" y1="${PAD.top + 10}" x2="${PAD.left + 20}" y2="${PAD.top + 10}" stroke="var(--c-purple-45)" stroke-width="2"/>
      <text x="${PAD.left + 24}" y="${PAD.top + 14}" font-size="10" fill="var(--muted)">평가금액</text>
      <line x1="${PAD.left + 74}" y1="${PAD.top + 10}" x2="${PAD.left + 90}" y2="${PAD.top + 10}" stroke="${pnlColor}" stroke-width="2"/>
      <text x="${PAD.left + 94}" y="${PAD.top + 14}" font-size="10" fill="var(--muted)">손익</text>
    </svg>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-top:10px;font-variant-numeric:tabular-nums">
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">현재 평가금액</div>
        <div style="font-size:.88rem;font-weight:700;color:var(--c-purple-45)">${fmt(lastPt.eval)}</div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">현재 손익</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${pSign(lastPt.pnl)}${fmt(lastPt.pnl)}</div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">수익률</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${lastPt.cost > 0 ? (pSign(lastPt.pnl) + (lastPt.pnl/lastPt.cost*100).toFixed(1) + '%') : '-'}</div>
      </div>
    </div>`;
}

function _drawHistoryTable(wrap, snapshots) {
  const fmt = _fmtKrw;
  const recent = [...snapshots].reverse().slice(0, 20);
  const diagnostics = _buildHistoryDiagnostics(snapshots);
  window._histDebugByDate = diagnostics;
  let html = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:6px">최근 스냅샷 (최대 20개)</div>
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
        <button onclick="_toggleHistDebug('${date}')" style="border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:.7rem">닫기</button>
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
  const toWeekKey = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay();
    const toFri = dow <= 5 ? 5 - dow : 6;
    const fri = new Date(dt);
    fri.setDate(dt.getDate() + toFri);
    return `${fri.getFullYear()}-${String(fri.getMonth()+1).padStart(2,'0')}-${String(fri.getDate()).padStart(2,'0')}`;
  };
  const weekMap = {};
  snapshots.forEach(s => {
    const wk = toWeekKey(s.date || '');
    if (!weekMap[wk] || (s.date || '') > (weekMap[wk].date || '')) weekMap[wk] = s;
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

function _fmtHistDateCompact(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return fmtDateDot(v || '');
  return `${m[1]}.${m[2]}.${m[3]}`;
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
        ${isLinked ? `<button onclick="clearGsheetUrl()" class="btn-del-sm" style="margin-left:auto;flex-shrink:0">해제</button>` : ''}
      </div>

      <!-- URL 입력 -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:8px">Apps Script 웹앱 URL</div>
        <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap">
          <input id="gsheetUrlInput" type="text"
            value="${currentUrl.replace(/"/g,'&quot;')}"
            placeholder="https://script.google.com/macros/s/..."
            style="flex:1;background:var(--s1);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:.73rem;min-width:0"
            onkeydown="if(event.key==='Enter') saveGsheetUrlFromUI()" />
          <button onclick="saveGsheetUrlFromUI()" class="btn-purple-sm">저장 · 연결 테스트</button>
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
