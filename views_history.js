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
  loadHistoryChart();
  $el('histRangeSelect')?.addEventListener('change', loadHistoryChart);
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
    const res  = await fetchWithTimeout(GSHEET_API_URL + '?action=getHistory', 15000);
    const data = await res.json();
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">스냅샷 데이터가 없습니다. 데이터가 쌓이면 자동으로 표시됩니다.</span>';
      return;
    }

    // 날짜 기준 정렬
    snapshots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

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
      `<span style="color:var(--muted)">총 ${snapshots.length}개 스냅샷 · 최근: ${fmtDateDot(snapshots[snapshots.length-1].date || '')}</span>`;

    _drawHistoryChart(chartWrap, snapshots);
    _drawHistoryTable(tableWrap, snapshots);

  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red-lt)">❌ 불러오기 실패: ${e.message}</span>`;
  }
}

function _drawHistoryChart(wrap, snapshots) {
  const W = Math.min(wrap.clientWidth || 700, 900);
  const H = 260;
  const PAD = { top: 20, right: 16, bottom: 46, left: 72 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  // 데이터 추출 (evalAmt = 평가금액, pnl = 손익)
  const pts = snapshots.map(s => ({
    date: fmtDateDot(s.date || ''),
    eval: parseFloat(s.evalAmt || s.total || s.eval || 0),
    cost: parseFloat(s.costAmt || s.cost || 0),
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

  // x축 레이블 (최대 6개)
  const labelStep = Math.max(1, Math.floor(pts.length / 6));
  let xLabels = '';
  for (let i = 0; i < pts.length; i += labelStep) {
    const lbl = (pts[i].date || '').slice(5); // MM.DD
    xLabels += `<text x="${xScale(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
  }

  // y축 레이블 (왼쪽: 평가금액 억단위)
  let yLabels = '';
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = yEvalMin + (yEvalMax - yEvalMin) * (i / yTicks);
    const y = yEval(v).toFixed(1);
    const lbl = Math.abs(v) >= 1e8 ? (v/1e8).toFixed(1) + '억' : Math.abs(v) >= 1e4 ? (v/1e4).toFixed(0) + '만' : v.toFixed(0);
    yLabels += `<text x="${PAD.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
    yLabels += `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + CW}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  }

  // 마지막 포인트 표시
  const lastPt = pts[pts.length - 1];
  const lastX  = xScale(pts.length - 1);
  const pnlColor = lastPt.pnl >= 0 ? 'var(--green)' : 'var(--red)';

  wrap.innerHTML = `
    <svg width="${W}" height="${H}" style="display:block;max-width:100%">
      <defs>
        <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lastPt.pnl >= 0 ? '#22c55e' : '#ef4444'}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${lastPt.pnl >= 0 ? '#22c55e' : '#ef4444'}" stop-opacity="0.03"/>
        </linearGradient>
      </defs>
      ${yLabels}
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
      <text x="${PAD.left + 24}" y="${PAD.top + 14}" font-size="9" fill="var(--muted)">평가금액</text>
      <line x1="${PAD.left + 74}" y1="${PAD.top + 10}" x2="${PAD.left + 90}" y2="${PAD.top + 10}" stroke="${pnlColor}" stroke-width="2"/>
      <text x="${PAD.left + 94}" y="${PAD.top + 14}" font-size="9" fill="var(--muted)">손익</text>
    </svg>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-top:10px">
      <div style="background:var(--s2);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">현재 평가금액</div>
        <div style="font-size:.88rem;font-weight:700;color:var(--c-purple-45)">${fmt(lastPt.eval)}</div>
      </div>
      <div style="background:var(--s2);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">현재 손익</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${pSign(lastPt.pnl)}${fmt(lastPt.pnl)}</div>
      </div>
      <div style="background:var(--s2);border-radius:8px;padding:8px 10px">
        <div style="font-size:.62rem;color:var(--muted)">수익률</div>
        <div style="font-size:.88rem;font-weight:700;color:${pnlColor}">${lastPt.cost > 0 ? (pSign(lastPt.pnl) + (lastPt.pnl/lastPt.cost*100).toFixed(1) + '%') : '-'}</div>
      </div>
    </div>`;
}

function _drawHistoryTable(wrap, snapshots) {
  const recent = [...snapshots].reverse().slice(0, 20);
  let html = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:6px">최근 스냅샷 (최대 20개)</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.72rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border);color:var(--muted)">
          <th style="text-align:left;padding:4px 6px;font-weight:600">날짜</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">평가금액</th>
          <th style="text-align:right;padding:4px 6px;font-weight:600">투입원가</th>
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
      <td style="padding:5px 6px;color:var(--muted)">${fmtDateDot(s.date || '')}</td>
      <td style="padding:5px 6px;text-align:right;color:var(--text)">${fmt(ev)}</td>
      <td style="padding:5px 6px;text-align:right;color:var(--muted)">${fmt(co)}</td>
      <td style="padding:5px 6px;text-align:right;color:${c}">${pSign(pnl)}${fmt(pnl)}</td>
      <td style="padding:5px 6px;text-align:right;color:${c}">${pct !== '-' ? pSign(pnl) + pct + '%' : '-'}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
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
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">📋 종목 관리 (기초정보)</div>
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