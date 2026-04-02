// ════════════════════════════════════════════════════════════════
//  views_history.js — 손익 그래프 (스냅샷 이력 기반)
//  의존: data.js, settings.js, views_system.js
// ════════════════════════════════════════════════════════════════
function renderHistoryView(area) {
  area.innerHTML = `
    <div style="padding:12px 0 8px">
      <!-- 헤더 -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text)">📈 손익 그래프</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <!-- 주간/월간 토글 -->
          <div style="display:flex;background:var(--s2);border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button id="histModeWeek" onclick="_setHistMode('week')"
              style="padding:4px 12px;font-size:.72rem;border:none;cursor:pointer;transition:all .15s">주간</button>
            <button id="histModeMonth" onclick="_setHistMode('month')"
              style="padding:4px 12px;font-size:.72rem;border:none;cursor:pointer;transition:all .15s">월간</button>
          </div>
          <!-- 기간 -->
          <select id="histRangeSelect"
            style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.72rem">
            <option value="90">3개월</option>
            <option value="180">6개월</option>
            <option value="365" selected>1년</option>
            <option value="730">2년</option>
            <option value="0">전체</option>
          </select>
          <input id="histStartMonth" type="month" title="시작 연월"
            style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.72rem"/>
          <button onclick="loadHistoryChart()" class="btn-ghost-sm">🔄</button>
        </div>
      </div>
      <div id="histStatusMsg" style="font-size:.70rem;color:var(--muted);margin-bottom:10px;min-height:1.2em"></div>
      <div id="histChartWrap" style="width:100%"></div>
      <div id="histTableWrap" style="margin-top:20px"></div>
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
  const statusEl  = $el('histStatusMsg');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  if (!chartWrap) return;

  if (!GSHEET_API_URL) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--amber)">⚠️ 재동기화 설정 후 이용 가능합니다.</span>';
    chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    return;
  }

  if (statusEl) statusEl.innerHTML = '⏳ 불러오는 중...';
  chartWrap.innerHTML = '<div style="height:220px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.78rem">⏳</div>';
  if (tableWrap) tableWrap.innerHTML = '';

  try {
    const days = parseInt($el('histRangeSelect')?.value || '365');
    const startMonth = String($el('histStartMonth')?.value || '').trim();
    let fromStr = '';
    if (/^\d{4}-\d{2}$/.test(startMonth)) {
      fromStr = `${startMonth}-01`;
    } else if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      fromStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');
    }
    const url = GSHEET_API_URL + '?action=getHistory' + (fromStr ? '&from=' + fromStr : '');
    const res  = await fetchWithTimeout(url, 15000);
    const data = await res.json();
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      chartWrap.innerHTML = '';
      if (statusEl) statusEl.innerHTML = '스냅샷 데이터가 없습니다. 데이터가 쌓이면 자동으로 표시됩니다.';
      return;
    }

    snapshots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const mode = window._histMode || 'week';
    snapshots = mode === 'week' ? _filterWeeklyFriday(snapshots) : _filterMonthEnd(snapshots);

    if (!snapshots.length) {
      chartWrap.innerHTML = '';
      if (statusEl) statusEl.innerHTML = '선택한 기간에 데이터가 없습니다.';
      return;
    }

    const modeLabel = mode === 'week' ? `${snapshots.length}주` : `${snapshots.length}개월`;
    const monthLabel = /^\d{4}-\d{2}$/.test(startMonth) ? ` · 시작 ${startMonth}` : '';
    if (statusEl) statusEl.innerHTML =
      `총 ${modeLabel}${monthLabel} · 최근: <b>${_fmtHistDateCompact(snapshots[snapshots.length-1].date || '')}</b> · KST 기준`;

    snapshots = _mergeTradeBasedCost(snapshots);
    _drawHistoryChart(chartWrap, snapshots, mode);
    _drawHistoryTable(tableWrap, snapshots);

  } catch(e) {
    chartWrap.innerHTML = '';
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${e.message}</span>`;
  }
}

// ── 주간 필터: 각 주(월~일)에서 금요일 또는 그 이전 가장 최신 스냅샷
function _filterWeeklyFriday(snapshots) {
  // 해당 날짜가 속한 주의 금요일(KST) 키 반환
  const toWeekKey = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d); // 로컬 시간
    const dow = dt.getDay(); // 0=일,1=월,...,5=금,6=토
    // 이 날짜가 속한 주의 금요일 = 현재일 + (5 - dow) if dow<=5, else +6
    const toFri = dow <= 5 ? 5 - dow : 6;
    const fri = new Date(dt);
    fri.setDate(dt.getDate() + toFri);
    return fri.getFullYear() + '-' + String(fri.getMonth()+1).padStart(2,'0') + '-' + String(fri.getDate()).padStart(2,'0');
  };

  const weekMap = {};
  snapshots.forEach(s => {
    const wk = toWeekKey(s.date || '');
    if (!weekMap[wk] || (s.date || '') > (weekMap[wk].date || '')) weekMap[wk] = s;
  });
  return Object.keys(weekMap).sort().map(k => weekMap[k]);
}

// ── 월말 필터: 각 월의 가장 마지막 날짜 스냅샷
function _filterMonthEnd(snapshots) {
  const monthMap = {};
  snapshots.forEach(s => {
    const m = String(s.date || '').match(/^(\d{4})[.-](\d{2})/);
    if (!m) return;
    const key = m[1] + '-' + m[2];
    if (!monthMap[key] || (s.date || '') > (monthMap[key].date || '')) monthMap[key] = s;
  });
  return Object.keys(monthMap).sort().map(k => monthMap[k]);
}

// ── 그래프 렌더링
function _drawHistoryChart(wrap, snapshots, mode) {
  if (!snapshots.length) return;

  const W   = Math.min((wrap.clientWidth || 360), 860);
  const H   = 270;
  const PAD = { top: 28, right: 66, bottom: 44, left: 68 };
  const CW  = W - PAD.left - PAD.right;
  const CH  = H - PAD.top - PAD.bottom;
  const n   = snapshots.length;

  const pts = snapshots.map(s => ({
    label:    mode === 'week' ? _fmtHistDateShortWeek(s.date || '') : _fmtHistDateShortMonth(s.date || ''),
    fullDate: _fmtHistDateCompact(s.date || ''),
    eval: parseFloat(s.evalAmt || s.total || s.eval || 0),
    cost: parseFloat(s.costAmt || s.cost || 0),
  }));
  pts.forEach(p => {
    p.pnl = p.eval - p.cost;
  });

  const eVals = pts.map(p => p.eval), pVals = pts.map(p => p.pnl);
  const minE = Math.min(...eVals), maxE = Math.max(...eVals);
  const minP = Math.min(...pVals), maxP = Math.max(...pVals);

  const ePad = Math.max((maxE - minE) * 0.12, maxE * 0.05, 1000000);
  const pPad = Math.max(Math.max(Math.abs(maxP), Math.abs(minP)) * 0.18, 1000000);
  const yEMin = minE - ePad, yEMax = maxE + ePad;
  const yPMin = minP - pPad, yPMax = maxP + pPad;

  const xS  = i  => PAD.left + (n > 1 ? (i / (n - 1)) * CW : CW / 2);
  const yE  = v  => PAD.top + CH - ((v - yEMin) / ((yEMax - yEMin) || 1)) * CH;
  const yP  = v  => PAD.top + CH - ((v - yPMin) / ((yPMax - yPMin) || 1)) * CH;

  const evalPts = pts.map((p, i) => `${xS(i).toFixed(1)},${yE(p.eval).toFixed(1)}`).join(' ');
  const pnlPts  = pts.map((p, i) => `${xS(i).toFixed(1)},${yP(p.pnl).toFixed(1)}`).join(' ');
  const zero    = yP(0).toFixed(1);
  const evalFill = `M${xS(0).toFixed(1)},${yE(yEMin).toFixed(1)} ` +
    pts.map((p, i) => `L${xS(i).toFixed(1)},${yE(p.eval).toFixed(1)}`).join(' ') +
    ` L${xS(n-1).toFixed(1)},${yE(yEMin).toFixed(1)} Z`;
  const pnlFill = `M${xS(0).toFixed(1)},${zero} ` +
    pts.map((p, i) => `L${xS(i).toFixed(1)},${yP(p.pnl).toFixed(1)}`).join(' ') +
    ` L${xS(n-1).toFixed(1)},${zero} Z`;

  const lastPt    = pts[n - 1];
  const firstPt   = pts[0];
  const pnlColor  = lastPt.pnl  >= 0 ? '#22c55e' : '#ef4444';
  const evalColor = '#a78bfa';

  // x축 레이블 (최대 7개)
  const step = Math.max(1, Math.ceil(n / 7));
  const labeled = new Set();
  let xLabels = '';
  for (let i = 0; i < n; i += step) {
    labeled.add(i);
    xLabels += `<text x="${xS(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--muted)">${pts[i].label}</text>`;
  }
  if (!labeled.has(n - 1)) {
    xLabels += `<text x="${xS(n-1).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--muted)">${pts[n-1].label}</text>`;
  }

  // y축 그리드 + 레이블
  let yGrid = '', yLL = '', yLR = '';
  for (let i = 0; i <= 4; i++) {
    const ev = yEMin + (yEMax - yEMin) * (i / 4);
    const pv = yPMin + (yPMax - yPMin) * (i / 4);
    const y  = yE(ev).toFixed(1);
    yGrid += `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left+CW}" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width="1"/>`;
    yLL   += `<text x="${PAD.left-6}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="rgba(200,200,220,.5)">${_fmtAxisKrw(ev)}</text>`;
    yLR   += `<text x="${PAD.left+CW+6}" y="${y}" dominant-baseline="middle" font-size="9.5" fill="${pv>=0?'rgba(34,197,94,.6)':'rgba(239,68,68,.6)'}">${_fmtAxisKrw(pv)}</text>`;
  }

  // 데이터 점
  let dots = '';
  pts.forEach((p, i) => {
    dots += `<circle cx="${xS(i).toFixed(1)}" cy="${yE(p.eval).toFixed(1)}" r="2.2" fill="${evalColor}" opacity=".65"/>`;
    dots += `<circle cx="${xS(i).toFixed(1)}" cy="${yP(p.pnl).toFixed(1)}"  r="2.2" fill="${pnlColor}"  opacity=".65"/>`;
  });

  // 요약 카드 데이터
  const evalChg     = lastPt.eval - firstPt.eval;
  const evalChgPct  = firstPt.eval > 0 ? (evalChg / firstPt.eval * 100).toFixed(1) : '0.0';
  const evalChgClr  = evalChg >= 0 ? '#22c55e' : '#ef4444';
  const pnlBase     = lastPt.cost;
  const pnlPct      = pnlBase > 0 ? (lastPt.pnl / pnlBase * 100).toFixed(1) : '-';
  const pnlTitle    = '현재 손익';
  const pnlBaseText = `원가 ${_fmtKrw(lastPt.cost)}`;

  wrap.innerHTML = `
    <!-- 요약 카드 3개 -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div style="font-size:.60rem;color:var(--muted);margin-bottom:3px">현재 평가금액</div>
        <div style="font-size:.88rem;font-weight:700;color:${evalColor}">${_fmtKrw(lastPt.eval)}</div>
        <div style="font-size:.60rem;color:${evalChgClr};margin-top:3px">${evalChg>=0?'▲':'▼'} ${_fmtKrw(Math.abs(evalChg))} <span style="opacity:.7">(${evalChg>=0?'+':''}${evalChgPct}%)</span></div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div style="font-size:.60rem;color:var(--muted);margin-bottom:3px">${pnlTitle}</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${lastPt.pnl>=0?'+':''}${_fmtKrw(lastPt.pnl)}</div>
        <div style="font-size:.60rem;color:var(--muted);margin-top:3px">${pnlBaseText}</div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div style="font-size:.60rem;color:var(--muted);margin-bottom:3px">수익률</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${pnlPct!=='-'?(lastPt.pnl>=0?'+':'')+pnlPct+'%':'-'}</div>
        <div style="font-size:.60rem;color:var(--muted);margin-top:3px">${_fmtHistDateCompact(snapshots[0]?.date||'')} 이후</div>
      </div>
    </div>

    <!-- 그래프 -->
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:12px 4px 6px">
      <!-- 범례 -->
      <div style="display:flex;gap:14px;padding:0 0 8px ${PAD.left}px">
        <div style="display:flex;align-items:center;gap:5px">
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="${evalColor}" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="4" r="2" fill="${evalColor}"/></svg>
          <span style="font-size:.64rem;color:var(--muted)">평가금액</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="${pnlColor}" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="4" r="2" fill="${pnlColor}"/></svg>
          <span style="font-size:.64rem;color:var(--muted)">손익</span>
        </div>
        <div style="margin-left:auto;font-size:.60rem;color:rgba(200,200,220,.4);padding-right:8px">좌: 투자 평가금액 · 우: 손익</div>
      </div>
      <svg width="${W}" height="${H}" style="display:block;max-width:100%;overflow:visible">
        <defs>
          <linearGradient id="hEvalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${evalColor}" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="${evalColor}" stop-opacity="0.01"/>
          </linearGradient>
          <linearGradient id="hPnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${pnlColor}" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="${pnlColor}" stop-opacity="0.01"/>
          </linearGradient>
        </defs>
        ${yGrid}${yLL}${yLR}
        <path d="${evalFill}" fill="url(#hEvalGrad)"/>
        <path d="${pnlFill}"  fill="url(#hPnlGrad)"/>
        <line x1="${PAD.left}" y1="${zero}" x2="${PAD.left+CW}" y2="${zero}"
          stroke="${pnlColor}" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.45"/>
        <polyline points="${evalPts}" fill="none" stroke="${evalColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <polyline points="${pnlPts}"  fill="none" stroke="${pnlColor}"  stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <circle cx="${xS(n-1).toFixed(1)}" cy="${yE(lastPt.eval).toFixed(1)}" r="4" fill="${evalColor}" stroke="var(--s2)" stroke-width="1.5"/>
        <circle cx="${xS(n-1).toFixed(1)}" cy="${yP(lastPt.pnl).toFixed(1)}"  r="4" fill="${pnlColor}"  stroke="var(--s2)" stroke-width="1.5"/>
        ${xLabels}
      </svg>
    </div>`;
}

// ── 표 렌더링
function _drawHistoryTable(wrap, snapshots) {
  if (!wrap) return;
  const recent = [...snapshots].reverse().slice(0, 20);
  const diagnostics = _buildHistoryDiagnostics(snapshots);
  window._histDebugByDate = diagnostics;
  let html = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:6px">최근 내역 (최대 20개)</div>
    <div style="font-size:.65rem;color:var(--muted);margin-bottom:8px">※ 원가와 평가금액 차이 원인을 빠르게 보도록 진단 컬럼을 추가했습니다.</div>
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
    <table style="width:100%;border-collapse:collapse;font-size:.72rem;font-variant-numeric:tabular-nums">
      <thead>
        <tr style="background:var(--s2)">
          <th style="text-align:center;padding:8px 10px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)">평가금액</th>
          <th style="text-align:center;padding:8px 10px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)">매입원가</th>
          <th style="text-align:center;padding:8px 10px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)">손익</th>
          <th style="text-align:center;padding:8px 10px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)">수익률</th>
          <th style="text-align:center;padding:8px 10px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)">진단</th>
        </tr>
      </thead><tbody>`;

  recent.forEach((s, idx) => {
    const ev  = parseFloat(s.evalAmt || s.total || s.eval || 0);
    const co  = parseFloat(s.costAmt || s.cost || 0);
    const pnl = ev - co;
    const pct = co > 0 ? (pnl / co * 100).toFixed(1) : '-';
    const c = pnl >= 0 ? '#22c55e' : '#ef4444';
    const d = diagnostics[s.date] || {};
    const noteColor = d.level === 'warn' ? 'var(--amber)' : 'var(--muted)';
    html += `<tr style="background:${idx%2===0?'transparent':'rgba(255,255,255,.015)'};border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:7px 10px;text-align:right;color:var(--text)">
        <div>${_fmtKrw(ev)}</div>
        <div style="font-size:.60rem;color:var(--muted);margin-top:2px">${_fmtHistDateCompact(s.date||'')}</div>
      </td>
      <td style="padding:7px 10px;text-align:right;color:var(--muted)">${_fmtKrw(co)}</td>
      <td style="padding:7px 10px;text-align:right;color:${c};font-weight:600">${pnl>=0?'+':''}${_fmtKrw(pnl)}</td>
      <td style="padding:7px 10px;text-align:right;color:${c};font-weight:600">${pct!=='-'?(pnl>=0?'+':'')+pct+'%':'-'}</td>
      <td style="padding:7px 10px;color:${noteColor};font-size:.66rem;white-space:nowrap">
        ${d.note ? `<button onclick="_toggleHistDebug('${s.date}')" style="border:1px solid var(--border);background:var(--s2);color:${noteColor};border-radius:6px;padding:2px 6px;font-size:.62rem;cursor:pointer;margin-right:4px">디버그</button>${d.note}` : '-'}
      </td>
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
        curEval, prevEval, curCost, prevCost, dEval, dCost, evalJumpPct,
      };
    } else if (absEval >= 500000000 && absCost <= Math.max(100000000, absEval * 0.12)) {
      out[cur.date] = {
        level: 'warn',
        note: `가격 영향 큼 (평가 ${dEval>=0?'+':''}${_fmtKrw(dEval)}, 원가 ${dCost>=0?'+':''}${_fmtKrw(dCost)})`,
        curEval, prevEval, curCost, prevCost, dEval, dCost, evalJumpPct,
      };
    } else if (absCost >= 300000000) {
      out[cur.date] = {
        level: 'info',
        note: `매수/매도 영향 (원가 ${dCost>=0?'+':''}${_fmtKrw(dCost)})`,
        curEval, prevEval, curCost, prevCost, dEval, dCost, evalJumpPct,
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
        <div>• 평가 변동률(직전 대비): ${(d.evalJumpPct*100).toFixed(1)}%</div>
      </div>
    </div>`;
}

// ── 거래이력 기반 원가 재계산
function _mergeTradeBasedCost(snapshots) {
  if (!Array.isArray(snapshots) || !snapshots.length) return snapshots;
  if (!Array.isArray(rawTrades) || !rawTrades.length) return snapshots;
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

  const posMap = {};
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
        p.qty += t.qty; p.totalCost += t.qty * t.price;
      } else if (t.tradeType === 'sell') {
        const avg = p.qty > 0 ? p.totalCost / p.qty : 0;
        const sq  = Math.min(t.qty, p.qty);
        p.qty -= sq; p.totalCost -= avg * sq;
        if (p.qty <= 0) { p.qty = 0; p.totalCost = 0; }
      }
    }
    out[target] = Math.max(0, totalCost());
  }
  return out;
}

// ── 날짜/포맷 유틸

function _histDateKey(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

// x축: 주간 "03.28", 월간 "26.03"
function _fmtHistDateShortWeek(v) {
  const m = String(v || '').match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  return m ? `${m[2]}.${m[3]}` : '';
}
function _fmtHistDateShortMonth(v) {
  const m = String(v || '').match(/^(\d{4})[.-](\d{2})/);
  return m ? `${m[1].slice(2)}.${m[2]}` : '';
}

// 표 날짜: "2026.03.31"
function _fmtHistDateCompact(v) {
  const m = String(v || '').trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
  if (!m) return typeof fmtDateDot === 'function' ? fmtDateDot(v || '') : (v || '');
  return `${m[1]}.${m[2]}.${m[3]}`;
}

// y축: "13.7억", "8,262만"
function _fmtAxisKrw(v) {
  const abs = Math.abs(v), sign = v < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만';
  return Math.round(v).toLocaleString();
}

// 요약/표: "13억 7,708만"
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

// ════════════════════════════════════════════════════════════════
//  renderGsheetView — 구글시트 연동 설정 탭
// ════════════════════════════════════════════════════════════════
function renderGsheetView(area) {
  const currentUrl = GSHEET_API_URL || '';
  const isLinked = !!currentUrl;
  area.innerHTML = `
    <div style="padding:12px 0 8px">
      <div style="font-size:.80rem;font-weight:700;color:var(--text);margin-bottom:16px">🔗 구글시트 연동</div>
      <div style="background:${isLinked?'var(--c-green-08)':'var(--s2)'};border:1px solid ${isLinked?'var(--c-green-30)':'var(--border)'};border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <div style="font-size:1.3rem">${isLinked?'✅':'⭕'}</div>
        <div>
          <div style="font-size:.78rem;font-weight:700;color:${isLinked?'var(--green)':'var(--muted)'}">${isLinked?'연동됨':'연동 안됨'}</div>
          <div style="font-size:.65rem;color:var(--muted);margin-top:2px;word-break:break-all">${isLinked?currentUrl.slice(0,60)+(currentUrl.length>60?'…':''):'구글 Apps Script 웹앱 URL을 입력하세요'}</div>
        </div>
        ${isLinked?`<button onclick="clearGsheetUrl()" class="btn-del-sm" style="margin-left:auto;flex-shrink:0">해제</button>`:''}
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:8px">Apps Script 웹앱 URL</div>
        <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap">
          <input id="gsheetUrlInput" type="text"
            value="${currentUrl.replace(/"/g,'&quot;')}"
            placeholder="https://script.google.com/macros/s/..."
            style="flex:1;background:var(--s1);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:.73rem;min-width:0"
            onkeydown="if(event.key==='Enter') saveGsheetUrlFromUI()"/>
          <button onclick="saveGsheetUrlFromUI()" class="btn-purple-sm">저장 · 연결 테스트</button>
        </div>
        <div id="gsheetTestResult" style="margin-top:8px;font-size:.68rem;color:var(--muted);min-height:1.2em"></div>
      </div>
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
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">🏦 계좌 관리</div>
          <button id="btn-acct-add" class="btn-purple-sm">➕ 계좌 추가</button>
        </div>
        <div id="acctMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <div id="acctMgmtNewWrap" style="display:none;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--amber);font-weight:700;margin-bottom:8px">➕ 새 계좌 추가</div>
          <input id="acctMgmtNewInput" type="text" placeholder="계좌명 입력"
            style="width:100%;background:var(--s1);border:1px solid rgba(251,191,36,.4);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem;margin-bottom:8px;box-sizing:border-box"/>
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:6px">색상 선택</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div id="acctNewColorPreview" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;border:2px solid var(--border)"></div>
            <div id="acctNewColorDots" class="flex-wrap-gap4"></div>
          </div>
          <input type="hidden" id="acctMgmtNewColor"/>
          <div style="display:flex;gap:6px">
            <button id="btn-acct-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-acct-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="acctMgmtList"></div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">📋 종목 관리</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button id="btn-sm-add" class="btn-purple-sm">➕ 종목 추가</button>
            <label class="btn-ghost-sm" style="cursor:pointer">📂 xlsx/csv 업로드<input id="smCsvFileInput" type="file" accept=".xlsx,.csv" style="display:none"/></label>
            <button id="btn-sm-template" class="btn-ghost-sm">⬇️ 양식</button>
          </div>
        </div>
        <div id="smMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <div id="smMgmtNewWrap" style="display:none;background:var(--c-purple-06);border:1px solid var(--c-purple-30);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--c-purple-45);font-weight:700;margin-bottom:8px">➕ 새 종목 추가</div>
          <div style="display:grid;grid-template-columns:1fr 100px;gap:6px;margin-bottom:8px">
            <input id="smMgmtNewName" type="text" placeholder="종목명" style="background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem"/>
            <input id="smMgmtNewCode" type="text" placeholder="종목코드" maxlength="6" style="background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem;font-family:'Courier New',monospace;text-align:center"/>
          </div>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;margin-bottom:4px">유형</div>
          <div id="smTypeGroup" class="flex-wrap-gap3" style="margin-bottom:10px"></div>
          <input type="hidden" id="smMgmtNewType" value="주식"/>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;margin-bottom:4px">섹터</div>
          <div id="smSecGroup" class="flex-wrap-gap3" style="margin-bottom:10px"></div>
          <input type="hidden" id="smMgmtNewSec" value="기타"/>
          <div style="display:flex;gap:6px">
            <button id="btn-sm-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-sm-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="stockMgmtSort"></div>
        <div id="stockMgmtBody" style="max-height:420px;overflow-y:auto"></div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">📂 섹터 관리</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="btn-sec-add" class="btn-purple-sm">➕ 섹터 추가</button>
            <label class="btn-ghost-sm" style="cursor:pointer">📂 xlsx/csv 업로드<input id="secCsvFileInput" type="file" accept=".xlsx,.csv" style="display:none"/></label>
            <button id="btn-sec-template" class="btn-ghost-sm">⬇️ 양식</button>
          </div>
        </div>
        <div id="secMgmtMsg" style="font-size:.70rem;min-height:1.2em;margin-bottom:4px"></div>
        <div id="secMgmtNewWrap" style="display:none;background:var(--c-purple-06);border:1px solid var(--c-purple-30);border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:.68rem;color:var(--c-purple-45);font-weight:700;margin-bottom:8px">➕ 새 섹터 추가</div>
          <input id="secMgmtNewName" type="text" placeholder="섹터명 입력" style="width:100%;background:var(--s1);border:1px solid var(--c-purple-30);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem;margin-bottom:8px;box-sizing:border-box"/>
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:6px">색상 선택</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div id="secNewColorPreview" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;border:2px solid var(--border)"></div>
            <div id="secNewColorDots" class="flex-wrap-gap4"></div>
          </div>
          <input type="hidden" id="secMgmtNewColor"/>
          <div style="display:flex;gap:6px">
            <button id="btn-sec-confirm" class="btn-purple-sm">✅ 추가</button>
            <button id="btn-sec-cancel" class="btn-cancel-sm">✕ 취소</button>
          </div>
        </div>
        <div id="sectorMgmtBody"></div>
      </div>
    </div>`;

  buildAcctMgmt();
  buildStockMgmt();
  buildSectorMgmt();
}
