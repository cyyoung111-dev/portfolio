// ── 거래이력 HTML 빌더 (data.js에서 이동)
let _tradeNameFilterTimer = null;
let _tradeNameComposing = false;

function tradeFilterNameInput(el) {
  _tradeFilter.name = el?.value || '';
  if (_tradeNameComposing) return;
  clearTimeout(_tradeNameFilterTimer);
  _tradeNameFilterTimer = setTimeout(() => {
    renderView();
    const inp = document.querySelector('input[placeholder="종목 검색..."]');
    if (inp) {
      const v = inp.value;
      inp.focus();
      inp.setSelectionRange(v.length, v.length);
    }
  }, 120);
}

function tradeFilterNameCompStart() { _tradeNameComposing = true; }
function tradeFilterNameCompEnd(el) {
  _tradeNameComposing = false;
  tradeFilterNameInput(el);
}

function _buildTradesSummaryHTML() {
  const { totalPnl: realizedPnl, totalCost: realizedCost, pct: realizedPct } = calcRealizedPnl();
  const holdingCount = rawTrades.filter(t => t.tradeType === 'buy').length;
  const sellCount    = rawTrades.filter(t => t.tradeType === 'sell').length;
  const pC = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
  const pS = realizedPnl >= 0 ? '+' : '';
  return `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px;min-width:0;overflow-x:auto">
      <div class="trade-stat-card">
        <div class="trade-stat-label">전체 거래</div>
        <div class="trade-stat-value">${rawTrades.length}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">매수 건수</div>
        <div class="trade-stat-value">${holdingCount}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">매도 건수</div>
        <div class="trade-stat-value">${sellCount}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">실현손익</div>
        <div class="trade-stat-value" style="color:${pC}">${pS}${Math.round(realizedPnl).toLocaleString()}</div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">수익률</div>
        <div class="trade-stat-value" style="color:${pC}">${pS}${realizedPct.toFixed(1)}<span class="txt-70-400">%</span></div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
      <div class="txt-muted-68">(단위:원)</div>
      <div></div>
    </div>`;
}

// ── 거래이력: 테이블 HTML 생성 (행별 평균단가 계산 포함)

function _buildTradesTableHTML(list) {
  const { key, dir } = _tradeSort;
  const headerCols = [
    {k:'acct',  label:'계좌',   align:'left',  cls:''},
    {k:'name',  label:'종목명', align:'left',  cls:''},
    {k:null,    label:'구분',   align:'center',cls:''},
    {k:'qty',   label:'수량',   align:'right', cls:''},
    {k:'date',  label:'날짜',   align:'left',  cls:'col-hide-mobile'},
    {k:'price', label:'단가',   align:'right', cls:''},
    {k:null,    label:'손익',   align:'right', cls:''},
  ];
  const headerHTML = headerCols.map(col => {
    if (!col.k) return `<th style="padding:9px 10px;text-align:center;font-size:.68rem;font-weight:600;color:var(--muted)"${col.cls?` class="${col.cls}"`:''} >${col.label}</th>`;
    const active = _tradeSort.key === col.k;
    const arrow  = active ? (_tradeSort.dir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    const color  = active ? 'color:var(--purple-lt)' : 'color:var(--muted)';
    return `<th${col.cls?` class="${col.cls}"`:''}
      style="padding:9px 10px;text-align:center;font-size:.68rem;font-weight:600;white-space:nowrap;cursor:pointer;user-select:none;${color}"
      onclick="tradeSetSort('${col.k}')">${col.label}<span style="font-size:.60rem;opacity:.7">${arrow}</span></th>`;
  }).join('');

  const avgMap = {};
  const rowsHTML = list.map((t) => {
    const mapKey = t.acct + '||' + t.name;
    if (!avgMap[mapKey]) avgMap[mapKey] = { qty: 0, totalCost: 0 };
    const isBuy  = t.tradeType === 'buy';
    const isSell = t.tradeType === 'sell';
    const price  = t.price ?? 0;
    const date   = t.date  || '';
    let pnl = null, pct = null;
    if (isBuy) {
      avgMap[mapKey].qty       += (t.qty || 0);
      avgMap[mapKey].totalCost += (t.qty || 0) * price;
    } else if (isSell) {
      const avgCost = avgMap[mapKey].qty > 0 ? avgMap[mapKey].totalCost / avgMap[mapKey].qty : 0;
      pnl = (price - avgCost) * (t.qty || 0);
      pct = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : 0;
      const sellQty = Math.min(t.qty || 0, avgMap[mapKey].qty);
      avgMap[mapKey].qty       -= sellQty;
      avgMap[mapKey].totalCost -= sellQty * avgCost;
    }
    const pC = pnl === null ? '' : pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pS = pnl === null ? '' : pnl >= 0 ? '+' : '';
    const noDate = !date;
    const acctColor = ACCT_COLORS[t.acct] || 'var(--muted)';
    return `
      <tr style="border-bottom:1px solid var(--border);background:${noDate?'var(--c-red-04)':'transparent'};cursor:pointer"
          onclick="editTrade('${t.id}')">
        <td style="padding:8px 10px;text-align:center;width:36px" onclick="event.stopPropagation()">
          <input type="checkbox" class="trade-cb trade-check" data-id="${t.id}"
            onchange="tradeCheckChange()" title="선택"/>
        </td>
        <td style="padding:8px 10px;text-align:left" onclick="editTrade('${t.id}')">
          <span class="adot" style="background:${acctColor}" title="${t.acct}"></span>
          <span style="font-size:.72rem;color:var(--muted)">${t.acct||'-'}</span>
        </td>
        <td style="padding:8px 10px;text-align:left" onclick="editTrade('${t.id}')">
          <div style="font-weight:600;font-size:.78rem">${t.name||'-'}</div>
          ${t.code ? `<span style="display:block;font-size:.65rem;color:var(--muted);margin-top:1px;font-variant-numeric:tabular-nums">${t.code}</span>` : ''}
          ${t.memo ? `<div style="font-size:.60rem;color:var(--muted);margin-top:1px">📝 ${t.memo}</div>` : ''}
        </td>
        <td style="text-align:center" onclick="editTrade('${t.id}')">
          <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:.65rem;font-weight:700;
            background:${isBuy?'var(--c-green2-15)':'var(--c-red-12)'};
            color:${isBuy?'var(--green-lt)':'var(--red-lt)'}">
            ${isBuy?'매수':'매도'}
          </span>
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums" onclick="editTrade('${t.id}')">${(t.qty||0).toLocaleString()}</td>
        <td class="col-hide-mobile" style="padding:8px 10px;text-align:center;font-size:.70rem;color:var(--muted);white-space:nowrap" onclick="editTrade('${t.id}')">
          ${date || '<span style="color:var(--red-lt);font-size:.60rem">날짜없음</span>'}
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums" onclick="editTrade('${t.id}')">
          ${price.toLocaleString()}
        </td>
        <td style="padding:8px 10px;text-align:right" onclick="editTrade('${t.id}')">
          ${pnl !== null ? `
            <div style="color:${pC};font-weight:600;font-size:.78rem;font-variant-numeric:tabular-nums">${pS}${Math.round(pnl).toLocaleString()}</div>
            <div style="font-size:.65rem;color:${pC}">${pS}${pct!==null?pct.toFixed(1):'0.0'}%</div>
          ` : `<span style="color:var(--muted)">-</span>`}
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px">
      <table class="tbl-inner-sm">
        <thead>
          <tr style="background:var(--s2);color:var(--muted);border-bottom:1px solid var(--border)">
            <th style="padding:9px 10px;text-align:center;width:36px">
              <input type="checkbox" class="trade-cb" id="tradeCheckAll" onchange="tradeToggleAll(this.checked)" title="전체선택"/>
            </th>
            ${headerHTML}
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    ${list.length === 0 ? `<div class="empty-msg">필터 결과가 없어요</div>` : ''}`;
}

// ── 거래이력 뷰 (조합자)

// ── views_trades.js
// 거래이력 메인 뷰 (renderTradesView)
// 체크박스 선택·삭제·정렬 헬퍼
// ─────────────────────────────────────────────────────────────

function renderTradesView(area) {
  const list     = _getFilteredTrades();
  const acctList = getAcctList();

  area.innerHTML = `
  <div class="p-0-4">
    ${renderTabSyncPanel('trades')}

    <!-- 헤더 -->
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h3 class="h3-section" style="margin:0">📋 거래 이력</h3>
        <div id="tradesHeaderBtns" style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="openBulkImport()" class="btn-sm btn-gold">📊 일괄 입력</button>
          <button onclick="openAddTrade(null,'buy')" class="btn-sm-purple">📈 매수</button>
          <button onclick="openAddTrade(null,'sell')" class="btn-sm btn-sell">📉 매도</button>
        </div>
      </div>
      <p class="mt-3-muted-72">매수·매도 전체 기록 · 행 클릭으로 수정 · 체크박스로 선택 삭제</p>
    </div>

    <!-- 요약 카드 -->
    ${_buildTradesSummaryHTML()}

    <!-- 필터 바 -->
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <input type="text" placeholder="종목 검색..." value="${_tradeFilter.name||''}"
        oninput="tradeFilterNameInput(this)" oncompositionstart="tradeFilterNameCompStart()" oncompositionend="tradeFilterNameCompEnd(this)"
        style="flex:1;min-width:80px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 9px;color:var(--text);font-size:.72rem">
      <select onchange="_tradeFilter.acct=this.value;renderView()"
        style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.72rem">
        <option value="">전체 계좌</option>
        ${acctList.filter(a=>a!=='합계').map(a=>`<option value="${a}"${_tradeFilter.acct===a?' selected':''}>${a}</option>`).join('')}
      </select>
      <div style="display:flex;gap:4px">
        ${['all','buy','sell'].map(t=>`
          <button onclick="_tradeFilter.type='${t}';renderView()"
            class="btn-sort-toggle${_tradeFilter.type===t?' active':''}">${t==='all'?'전체':t==='buy'?'매수':'매도'}</button>
        `).join('')}
      </div>
    </div>

    <!-- 선택 액션바 -->
    <div id="tradeSelBar" style="display:none;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--c-amber-08);border:1px solid var(--c-amber-30);border-radius:8px;margin-bottom:8px">
      <span id="tradeSelCount" style="font-size:.78rem;font-weight:600;color:var(--gold)">0건 선택됨</span>
      <div class="flex-gap6">
        <button onclick="tradeToggleAll(true)" class="btn-outline-sm">전체선택</button>
        <button onclick="tradeToggleAll(false)" class="btn-outline-sm">선택해제</button>
        <button onclick="deleteSelectedTrades()" class="btn-danger">🗑 선택 삭제</button>
      </div>
    </div>

    <!-- 거래 테이블 -->
    ${_buildTradesTableHTML(list)}
  </div>`;

  // 액션바 초기 상태 반영
  _updateTradeSelBar();
}

// ── 체크박스·정렬·삭제 ──────────────────────────────────────────

function tradeSetSort(key) {
  if (_tradeSort.key === key) {
    _tradeSort.dir *= -1;
  } else {
    _tradeSort.key = key;
    _tradeSort.dir = key === 'date' ? -1 : 1;
  }
  renderView();
}

function tradeCheckChange() {
  _updateTradeSelBar();
  const all     = document.querySelectorAll('.trade-check');
  const checked = document.querySelectorAll('.trade-check:checked');
  const allCb   = $el('tradeCheckAll');
  if (allCb) allCb.checked = all.length > 0 && all.length === checked.length;
  all.forEach(cb => {
    const row = cb.closest('tr');
    if (row) row.classList.toggle('selected', cb.checked);
  });
}

function tradeToggleAll(checked) {
  document.querySelectorAll('.trade-check').forEach(cb => {
    cb.checked = checked;
    const row = cb.closest('tr');
    if (row) row.classList.toggle('selected', checked);
  });
  _updateTradeSelBar();
}

function _updateTradeSelBar() {
  const checked = document.querySelectorAll('.trade-check:checked');
  const bar = $el('tradeSelBar');
  const cnt = $el('tradeSelCount');
  if (!bar) return;
  if (checked.length > 0) {
    bar.style.display = 'flex';
    if (cnt) cnt.textContent = checked.length + '건 선택됨';
  } else {
    bar.style.display = 'none';
  }
}

function deleteSelectedTrades() {
  const checked = document.querySelectorAll('.trade-check:checked');
  if (checked.length === 0) { showToast('삭제할 항목을 선택해주세요', 'warn'); return; }
  const ids = [...checked].map(cb => String(cb.dataset.id)).filter(id => id && id !== 'undefined');
  if (ids.length === 0) { showToast('선택 항목의 ID를 읽을 수 없어요. 페이지를 새로고침 후 다시 시도해보세요.', 'error'); return; }
  if (!confirm(`선택한 ${ids.length}건을 삭제할까요?`)) return;
  const idSet  = new Set(ids);
  const before = rawTrades.length;
  for (let i = rawTrades.length - 1; i >= 0; i--) {
    const rid = rawTrades[i].id != null ? String(rawTrades[i].id) : null;
    if (rid && idSet.has(rid)) rawTrades.splice(i, 1);
  }
  const deleted = before - rawTrades.length;
  if (deleted === 0) {
    showToast('삭제된 항목이 없어요. 페이지를 새로고침 후 다시 시도해보세요.', 'warn');
    return;
  }
  _commitTrades();
}
