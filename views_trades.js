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
        <div id="tradesHeaderBtns" style="display:flex;gap:6px;flex-shrink:0">
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
      <input type="text" placeholder="종목명 검색..." value="${_tradeFilter.name||''}"
        oninput="_tradeFilter.name=this.value;renderView()"
        style="flex:1;min-width:120px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 9px;color:var(--text);font-size:.72rem">
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
