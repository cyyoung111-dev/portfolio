// ── 거래이력 HTML 빌더 (data.js에서 이동)
let _tradeNameFilterTimer = null;
let _tradeNameComposing = false;

function _tradeNameInputIsComposing(evt) {
  return !!(_tradeNameComposing || evt?.isComposing || evt?.inputType === 'insertCompositionText');
}

function _scheduleTradeNameFilterRender(el) {
  clearTimeout(_tradeNameFilterTimer);
  const caretStart = Number.isFinite(el?.selectionStart) ? el.selectionStart : null;
  const caretEnd = Number.isFinite(el?.selectionEnd) ? el.selectionEnd : caretStart;
  _tradeNameFilterTimer = setTimeout(() => {
    if (_tradeNameComposing) return;
    renderView(true);
    const inp = document.getElementById('tradeNameFilter');
    if (inp) {
      const v = inp.value;
      const start = caretStart === null ? v.length : Math.min(caretStart, v.length);
      const end = caretEnd === null ? start : Math.min(caretEnd, v.length);
      inp.focus();
      inp.setSelectionRange(start, end);
    }
  }, 260);
}

function tradeFilterNameInput(el, evt) {
  _tradeFilter.name = el?.value || '';
  clearTimeout(_tradeNameFilterTimer);
  if (_tradeNameInputIsComposing(evt)) return;
  _scheduleTradeNameFilterRender(el);
}

function tradeFilterNameCompStart() {
  _tradeNameComposing = true;
  clearTimeout(_tradeNameFilterTimer);
}
function tradeFilterNameCompEnd(el) {
  _tradeNameComposing = false;
  // 일부 한글 IME는 compositionend 직후 input 이벤트에서 최종 문자열을 확정한다.
  // 다음 tick에 값을 다시 읽어 렌더링하면 조합 중 DOM 교체로 "증권"이 "중구ㅓ니"처럼
  // 깨지는 현상을 피할 수 있다.
  setTimeout(() => {
    _tradeFilter.name = el?.value || '';
    _scheduleTradeNameFilterRender(el);
  }, 0);
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

function _getTradesMissingDate() {
  return rawTrades.filter(t => t && !t.date);
}

function _buildTradeDateRepairHTML() {
  const missing = _getTradesMissingDate();
  if (missing.length === 0) return '';
  const defaultDate = (typeof _kstTodayStr === 'function') ? _kstTodayStr() : '';
  return `
    <div id="tradeDateRepair" style="background:var(--c-red-08);border:1px solid var(--c-red-30);border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div>
          <div style="font-size:.76rem;font-weight:700;color:var(--red-lt)">⚠️ 날짜 없는 거래 ${missing.length}건</div>
          <div style="font-size:.66rem;color:var(--muted);margin-top:2px">실현손익·스냅샷 원가 계산이 날짜순 정렬에 의존하므로 날짜를 보정해주세요.</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="date" id="tradeMissingDateInput" value="${_escapeHtml(defaultDate)}"
            style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.72rem">
          <button data-trade-action="select-missing-dates" class="btn-outline-sm">날짜없음 선택</button>
          <button data-trade-action="fill-missing-dates" class="btn-danger">날짜 일괄 지정</button>
        </div>
      </div>
    </div>`;
}

// ── 거래이력: 테이블 HTML 생성 (행별 평균단가 계산 포함)

function _buildTradesTableHTML(list) {
  const headerCols = [
    {k:'acct',  label:'계좌',   align:'left',  cls:''},
    {k:'name',  label:'종목명', align:'left',  cls:''},
    {k:null,    label:'구분',   align:'center',cls:''},
    {k:'qty',   label:'수량',   align:'right', cls:''},
    {k:'date',  label:'날짜',   align:'left',  cls:'col-hide-mobile'},
    {k:'price', label:'단가',   align:'right', cls:''},
    {k:null,    label:'손익',   align:'right', cls:''},
    {k:null,    label:'손익분기', align:'right', cls:'col-hide-mobile'},
  ];
  const headerHTML = headerCols.map(col => {
    const clsAttr = col.cls ? ` class="${col.cls}"` : '';
    if (!col.k) return `<th style="padding:9px 10px;text-align:center;font-size:.68rem;font-weight:600;color:var(--muted)"${clsAttr} >${col.label}</th>`;
    const active = _tradeSort.key === col.k;
    const arrow  = active ? (_tradeSort.dir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    const color  = active ? 'color:var(--purple-lt)' : 'color:var(--muted)';
    return `<th${clsAttr}
      data-trade-sort="${col.k}"
      style="padding:9px 10px;text-align:center;font-size:.68rem;font-weight:600;white-space:nowrap;cursor:pointer;user-select:none;${color}">${col.label}<span style="font-size:.60rem;opacity:.7">${arrow}</span></th>`;
  }).join('');

    const avgMap = {};
  const breakevenMap = {}; // mapKey → 현재 평균단가 (현재 보유 포지션 기준)
  const rowsHTML = list.map((t) => {
    const tradeId = String(t.id ?? '');
    const tradeIdEsc = _escapeHtml(tradeId);
    const acct = String(t.acct || '');
    const name = String(t.name || '');
    const code = String(t.code || '');
    const memo = String(t.memo || '');
    const mapKey = acct + '||' + name;
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
    // ★ 손익분기 단가: 현재 포지션의 평균 매수단가
    const currentAvg  = avgMap[mapKey].qty > 0 ? avgMap[mapKey].totalCost / avgMap[mapKey].qty : 0;
    // 현재가 대비 손익분기까지 남은 %
    const currentPrice = (savedPrices[getCode(name)] || savedPrices[name] || 0);
    const beGap = currentAvg > 0 && currentPrice > 0
      ? ((currentAvg - currentPrice) / currentPrice * 100)
      : null;
    const pC = pnl === null ? '' : pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pS = pnl === null ? '' : pnl >= 0 ? '+' : '';
    const noDate = !date;
    const acctColor = ACCT_COLORS[acct] || 'var(--muted)';
    return `
      <tr data-trade-id="${tradeIdEsc}"${noDate ? ' data-trade-no-date="1"' : ''} style="border-bottom:1px solid var(--border);background:${noDate?'var(--c-red-04)':'transparent'};cursor:pointer">
        <td style="padding:8px 10px;text-align:center;width:36px" data-trade-no-edit="1">
          <input type="checkbox" class="trade-cb trade-check" data-id="${tradeIdEsc}" title="선택"/>
        </td>
        <td style="padding:8px 10px;text-align:left">
          <span class="adot" style="background:${acctColor}" title="${_escapeHtml(acct)}"></span>
          <span style="font-size:.72rem;color:var(--muted)">${_escapeHtml(acct || '-')}</span>
        </td>
        <td style="padding:8px 10px;text-align:left">
          <div style="font-weight:600;font-size:.78rem">${_escapeHtml(name || '-')}</div>
          ${code ? `<span style="display:block;font-size:.65rem;color:var(--muted);margin-top:1px;font-variant-numeric:tabular-nums">${_escapeHtml(code)}</span>` : ''}
          ${memo ? `<div style="font-size:.60rem;color:var(--muted);margin-top:1px">📝 ${_escapeHtml(memo)}</div>` : ''}
        </td>
        <td style="text-align:center">
          <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:.65rem;font-weight:700;
            background:${isBuy?'var(--c-green2-15)':'var(--c-red-12)'};
            color:${isBuy?'var(--green-lt)':'var(--red-lt)'}">
            ${isBuy?'매수':'매도'}
          </span>
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums">${(t.qty||0).toLocaleString()}</td>
        <td class="col-hide-mobile" style="padding:8px 10px;text-align:center;font-size:.70rem;color:var(--muted);white-space:nowrap">
          ${date ? _escapeHtml(date) : '<span style="color:var(--red-lt);font-size:.60rem">날짜없음</span>'}
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums">
          ${price.toLocaleString()}
        </td>
        <td style="padding:8px 10px;text-align:right">
          ${pnl !== null ? `
            <div style="color:${pC};font-weight:600;font-size:.78rem;font-variant-numeric:tabular-nums">${pS}${Math.round(pnl).toLocaleString()}</div>
            <div style="font-size:.65rem;color:${pC}">${pS}${pct!==null?pct.toFixed(1):'0.0'}%</div>
          ` : `<span style="color:var(--muted)">-</span>`}
        </td>
        <td class="col-hide-mobile" style="padding:8px 10px;text-align:right">
          ${isBuy && currentAvg > 0 ? `
            <div style="font-size:.75rem;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums">${Math.round(currentAvg).toLocaleString()}</div>
            ${beGap !== null ? `<div style="font-size:.65rem;color:${beGap > 0 ? 'var(--red-lt)' : 'var(--green)'}">
              ${beGap > 0 ? `+${beGap.toFixed(1)}% 필요` : `${Math.abs(beGap).toFixed(1)}% 여유`}
            </div>` : ''}
          ` : `<span style="color:var(--muted);font-size:.72rem">-</span>`}
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px">
      <table class="tbl-inner-sm">
        <thead>
          <tr style="background:var(--s2);color:var(--muted);border-bottom:1px solid var(--border)">
            <th style="padding:9px 10px;text-align:center;width:36px">
              <input type="checkbox" class="trade-cb" id="tradeCheckAll" title="전체선택"/>
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
          <button data-trade-action="bulk" class="btn-sm btn-gold">📊 일괄 입력</button>
          <button data-trade-action="add-buy" class="btn-sm-purple">📈 매수</button>
          <button data-trade-action="add-sell" class="btn-sm btn-sell">📉 매도</button>
        </div>
      </div>
      <p class="mt-3-muted-72">매수·매도 전체 기록 · 행 클릭으로 수정 · 체크박스로 선택 삭제</p>
    </div>

    <!-- 요약 카드 -->
    ${_buildTradesSummaryHTML()}
    ${_buildTradeDateRepairHTML()}

    <!-- 필터 바 -->
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <input id="tradeNameFilter" type="text" placeholder="종목 검색..." value="${_escapeHtml(_tradeFilter.name||'')}"
        data-trade-filter="name"
        style="flex:1;min-width:80px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 9px;color:var(--text);font-size:.72rem">
      <select data-trade-filter="acct"
        style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.72rem">
        <option value="">전체 계좌</option>
        ${acctList.filter(a=>a!=='합계').map(a=>`<option value="${_escapeHtml(a)}"${_tradeFilter.acct===a?' selected':''}>${_escapeHtml(a)}</option>`).join('')}
      </select>
      <div style="display:flex;gap:4px">
        ${['all','buy','sell'].map(t=>`
          <button data-trade-type="${t}"
            class="btn-sort-toggle${_tradeFilter.type===t?' active':''}">${t==='all'?'전체':t==='buy'?'매수':'매도'}</button>
        `).join('')}
      </div>
    </div>

    <!-- 선택 액션바 -->
    <div id="tradeSelBar" style="display:none;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--c-amber-08);border:1px solid var(--c-amber-30);border-radius:8px;margin-bottom:8px">
      <span id="tradeSelCount" style="font-size:.78rem;font-weight:600;color:var(--gold)">0건 선택됨</span>
      <div class="flex-gap6">
        <button data-trade-action="select-all" class="btn-outline-sm">전체선택</button>
        <button data-trade-action="select-none" class="btn-outline-sm">선택해제</button>
        <button data-trade-action="delete-selected" class="btn-danger">🗑 선택 삭제</button>
      </div>
    </div>

    <!-- 거래 테이블 -->
    ${_buildTradesTableHTML(list)}
  </div>`;

  _bindTradesViewEvents(area);
  // 액션바 초기 상태 반영
  _updateTradeSelBar();
}


function _bindTradesViewEvents(area) {
  if (!area || area._tradesDelegatedBound) return;
  area._tradesDelegatedBound = true;

  area.addEventListener('click', function(e) {
    const sort = e.target.closest('[data-trade-sort]');
    if (sort && area.contains(sort)) {
      tradeSetSort(sort.dataset.tradeSort);
      return;
    }

    const typeBtn = e.target.closest('[data-trade-type]');
    if (typeBtn && area.contains(typeBtn)) {
      _tradeFilter.type = typeBtn.dataset.tradeType || 'all';
      renderView();
      return;
    }

    const actionBtn = e.target.closest('[data-trade-action]');
    if (actionBtn && area.contains(actionBtn)) {
      const action = actionBtn.dataset.tradeAction;
      if (action === 'bulk' && typeof openBulkImport === 'function') openBulkImport();
      else if (action === 'add-buy' && typeof openAddTrade === 'function') openAddTrade(null, 'buy');
      else if (action === 'add-sell' && typeof openAddTrade === 'function') openAddTrade(null, 'sell');
      else if (action === 'select-all') tradeToggleAll(true);
      else if (action === 'select-none') tradeToggleAll(false);
      else if (action === 'delete-selected') deleteSelectedTrades();
      else if (action === 'select-missing-dates') tradeSelectMissingDateRows();
      else if (action === 'fill-missing-dates') tradeFillMissingDates();
      return;
    }

    if (e.target.closest('[data-trade-no-edit]')) return;
    const row = e.target.closest('tr[data-trade-id]');
    if (row && area.contains(row) && row.dataset.tradeId) editTrade(row.dataset.tradeId);
  });

  area.addEventListener('change', function(e) {
    if (e.target.id === 'tradeCheckAll') {
      tradeToggleAll(e.target.checked);
      return;
    }
    if (e.target.classList?.contains('trade-check')) {
      tradeCheckChange();
      return;
    }
    if (e.target.dataset?.tradeFilter === 'acct') {
      _tradeFilter.acct = e.target.value;
      renderView();
    }
  });

  area.addEventListener('input', function(e) {
    if (e.target.dataset?.tradeFilter === 'name') tradeFilterNameInput(e.target, e);
  });

  area.addEventListener('compositionstart', function(e) {
    if (e.target.dataset?.tradeFilter === 'name') tradeFilterNameCompStart();
  });

  area.addEventListener('compositionend', function(e) {
    if (e.target.dataset?.tradeFilter === 'name') tradeFilterNameCompEnd(e.target);
  });
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

function tradeSelectMissingDateRows() {
  document.querySelectorAll('.trade-check').forEach(cb => {
    const row = cb.closest('tr');
    const checked = !!row?.dataset?.tradeNoDate;
    cb.checked = checked;
    if (row) row.classList.toggle('selected', checked);
  });
  _updateTradeSelBar();
}

function tradeFillMissingDates() {
  const date = String($el('tradeMissingDateInput')?.value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast('지정할 날짜를 선택해주세요', 'warn');
    return;
  }
  const checkedIds = [...document.querySelectorAll('.trade-check:checked')]
    .map(cb => String(cb.dataset.id || ''))
    .filter(Boolean);
  const checkedSet = new Set(checkedIds);
  const missing = _getTradesMissingDate();
  const targets = checkedSet.size > 0
    ? missing.filter(t => checkedSet.has(String(t.id ?? '')))
    : missing;
  if (targets.length === 0) {
    showToast('날짜를 지정할 거래가 없습니다', 'warn');
    return;
  }
  if (targets.length > 1) {
    const scope = checkedSet.size > 0 ? '선택한 날짜 없는 거래' : '모든 날짜 없는 거래';
    if (!confirm(`${scope} ${targets.length}건의 날짜를 ${date}로 일괄 지정할까요?`)) return;
  }
  targets.forEach(t => { t.date = date; });
  _commitTrades();
  showToast(`날짜 없는 거래 ${targets.length}건에 ${date}를 지정했습니다`, 'ok');
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
