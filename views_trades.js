function renderTradesView(area) {
  const list     = _getFilteredTrades();
  const acctList = getAcctList();

  area.innerHTML = `
  <div class="p-0-4">
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

// ── 종목별 거래내역 그룹 뷰
let _tgFilter = { name: '' };
let _tgFilterTimer = null;
function _tgFilterDebounce() {
  clearTimeout(_tgFilterTimer);
  _tgFilterTimer = setTimeout(() => {
    // 포커스 유지한 채로 카드 목록만 재렌더링
    const area = document.querySelector('[data-view="tradegroup"]') || document.getElementById('main-area');
    if (area) renderTradeGroupView(area);
    else renderView();
    // 검색 입력창 포커스 복원
    const inp = document.getElementById('tgFilterName');
    if (inp) { const v = inp.value; inp.focus(); inp.setSelectionRange(v.length, v.length); }
  }, 120);
}

function renderTradeGroupView(area) {
  // 종목명 기준으로 그룹핑
  const nameList = [...new Set(rawTrades.map(t => t.name).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
  const filtered = _tgFilter.name
    ? nameList.filter(n => n.includes(_tgFilter.name))
    : nameList;

  // 각 종목별 통계 계산
  function calcGroup(name) {
    const trades = rawTrades
      .filter(t => t.name === name)
      .sort((a,b) => (a.date||'').localeCompare(b.date||''));
    let qty = 0, totalCost = 0, realizedPnl = 0, buyCount = 0, sellCount = 0;
    trades.forEach(t => {
      if (t.tradeType === 'buy') {
        qty       += (t.qty || 0);
        totalCost += (t.qty || 0) * (t.price || 0);
        buyCount++;
      } else if (t.tradeType === 'sell') {
        const avgCost = qty > 0 ? totalCost / qty : 0;
        const sellQty = Math.min(t.qty || 0, qty);
        realizedPnl  += (t.price - avgCost) * sellQty;
        totalCost    -= sellQty * avgCost;
        qty          -= sellQty;
        sellCount++;
      }
    });
    const avgCost = qty > 0 ? totalCost / qty : 0;
    const ep      = getEP(name);
    const code    = (ep && ep.code) || '';
    const sector  = (ep && ep.sector) || '기타';
    const type = getEPType(ep, trades[0]?.assetType || '주식');
    return { trades, qty, avgCost, realizedPnl, buyCount, sellCount, code, sector, type };
  }

  area.innerHTML = `
  <div class="p-0-4">
    <div class="flex-between-mb14">
      <div>
        <h3 class="h3-section">📊 종목별 거래내역</h3>
        <p class="mt-3-muted-72">종목 클릭 → 거래 상세 펼치기</p>
      </div>
      <input id="tgFilterName" placeholder="🔍 종목명 검색" value="${_tgFilter.name}"
        oninput="_tgFilter.name=this.value; _tgFilterDebounce()"
        style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--text);font-size:.75rem;width:150px"/>
    </div>

    ${rawTrades.length === 0 ? `
    <div class="info-box-blue-lg">
      <div class="emoji-lg">📋</div>
      <div class="txt-blue-700">거래 이력이 없어요</div>
      <div class="txt-muted-75">거래 이력 탭에서 먼저 거래를 입력해주세요</div>
    </div>` : filtered.length === 0 ? `
    <div class="empty-msg">검색 결과가 없어요</div>
    ` : `
    <div class="flex-col-gap8">
      ${filtered.map(name => {
        const g = calcGroup(name);
        const isHolding = g.qty > 0;
        const pnlColor  = g.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
        const pnlSign   = g.realizedPnl >= 0 ? '+' : '';
        return `
        <div class="tg-group" style="background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <!-- 종목 요약 헤더 (클릭으로 토글) -->
          <div onclick="tgToggle(this)" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none">
            <span style="font-size:.65rem;color:var(--muted);transform:rotate(0deg);transition:transform .2s;display:inline-block" class="tg-arrow">▶</span>
            <div style="flex:1;min-width:0">
              <div class="flex-ac-g8-wrap">
                <span class="tg-name" style="font-weight:700;font-size:.85rem">${name}</span>
                ${g.code ? `<span class="txt-mono-muted">${g.code}</span>` : ''}
                <span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:var(--c-purple2-10);color:var(--purple-lt)">${g.type}</span>
                <span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:var(--c-muted-10);color:var(--muted)">${g.sector}</span>
                ${isHolding
                  ? `<span style="font-size:.65rem;padding:2px 7px;border-radius:10px;background:rgba(74,222,128,.12);color:var(--green-lt);font-weight:600">보유중 ${g.qty.toLocaleString()}주</span>`
                  : `<span style="font-size:.65rem;padding:2px 7px;border-radius:10px;background:var(--c-muted-10);color:var(--muted)">청산완료</span>`}
              </div>
              <div style="display:flex;gap:14px;margin-top:4px;font-size:.70rem;color:var(--muted)">
                <span>매수 <b class="c-text">${g.buyCount}</b>건</span>
                <span>매도 <b class="c-text">${g.sellCount}</b>건</span>
                ${isHolding ? `<span>평균단가 <b class="c-text">${Math.round(g.avgCost).toLocaleString()}원</b></span>` : ''}
                ${g.sellCount > 0 ? `<span>실현손익 <b style="color:${pnlColor}">${pnlSign}${Math.round(g.realizedPnl).toLocaleString()}원</b></span>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-shrink:0" onclick="event.stopPropagation()">
              <span style="font-size:.70rem;color:var(--muted);white-space:nowrap;margin-right:4px">${g.trades.length}건</span>
              <button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'buy')" title="매수 추가" class="btn-buy-sm">＋ 매수</button>
              ${isHolding ? `<button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'sell')" title="매도 추가" class="btn-sell-sm">－ 매도</button>` : ''}
            </div>
          </div>

          <!-- 거래 상세 테이블 (기본 숨김) -->
          <div class="tg-detail" style="display:none;border-top:1px solid var(--border);overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:.72rem;min-width:400px">
              <thead>
                <tr class="s2-muted">
                  <th class="th-left-500">날짜</th>
                  <th class="td-p7-center-500">구분</th>
                  <th class="th-left-500">계좌</th>
                  <th class="th-right-500">수량</th>
                  <th class="th-right-500">단가</th>
                  <th class="th-right-500">금액</th>
                  <th class="th-left-500">메모</th>
                  <th class="td-p7-center-500">수정</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  let runQty = 0, runCost = 0;
                  return g.trades.map(t => {
                    const isBuy  = t.tradeType === 'buy';
                    const isSell = t.tradeType === 'sell';
                    const price  = t.price || 0;
                    const qty    = t.qty   || 0;
                    const amount = price * qty;
                    let pnlCell  = '';
                    if (isBuy) {
                      runQty  += qty;
                      runCost += qty * price;
                    } else if (isSell) {
                      const avg = runQty > 0 ? runCost / runQty : 0;
                      const pnl = (price - avg) * Math.min(qty, runQty);
                      const pct = avg > 0 ? ((price - avg) / avg * 100) : 0;
                      const pc  = pnl >= 0 ? 'var(--green)' : 'var(--red)';
                      const ps  = pnl >= 0 ? '+' : '';
                      pnlCell   = `<div style="color:${pc};font-weight:600">${ps}${Math.round(pnl).toLocaleString()}원</div>
                                   <div style="font-size:.65rem;color:${pc}">${ps}${pct.toFixed(1)}%</div>`;
                      runCost  -= Math.min(qty, runQty) * avg;
                      runQty   -= Math.min(qty, runQty);
                    }
                    return `<tr style="border-bottom:1px solid var(--border);background:${isSell?'rgba(239,68,68,.03)':'transparent'}">
                      <td style="padding:7px 12px;color:var(--muted);white-space:nowrap">${t.date||'⚠️없음'}</td>
                      <td class="td-p7-center">
                        ${isSell ? `<span class="trade-badge-sell">📉 매도</span>` : `<span class="trade-badge-hold">📈 매수</span>`}
                      </td>
                      <td style="padding:7px 12px;white-space:nowrap">
                        <span class="adot" style="background:${ACCT_COLORS[t.acct]||'var(--muted)'}"></span>${t.acct}
                      </td>
                      <td style="padding:7px 12px;text-align:right">${qty.toLocaleString()}</td>
                      <td style="padding:7px 12px;text-align:right;white-space:nowrap;color:${isSell?'var(--red-lt)':'var(--green-lt)'}">
                        ${price.toLocaleString()}원
                      </td>
                      <td style="padding:7px 12px;text-align:right;white-space:nowrap">${amount.toLocaleString()}원</td>
                      <td style="padding:7px 12px;color:var(--muted);font-size:.70rem">${t.memo||''}</td>
                      <td class="td-p7-center">
                        <button onclick="editTrade('${t.id}')"
                          class="btn-edit-sm">✏️</button>
                      </td>
                    </tr>`;
                  }).join('');
                })()}
              </tbody>
            </table>
            <!-- 이 종목 거래 추가 버튼 -->
            <div style="display:flex;gap:8px;padding:9px 12px;border-top:1px solid var(--border);background:var(--s2)">
              <button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'buy')" class="btn-buy-lg">📈 매수 추가</button>
              ${isHolding ? `<button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'sell')" class="btn-sell-lg">📉 매도 추가</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>`;
}

function tgToggle(header) {
  const group  = header.closest('.tg-group');
  const detail = group.querySelector('.tg-detail');
  const arrow  = header.querySelector('.tg-arrow');
  const open   = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
}

// 거래이력 탭 → 종목명 클릭 시 종목별 거래 뷰로 이동 + 해당 종목 필터
function goToTradeGroup(name) {
  _tgFilter.name = name;
  switchView('tradegroup');
  // 뷰 전환 후 해당 그룹 자동 펼치기
  requestAnimationFrame(() => {
    const groups = document.querySelectorAll('.tg-group');
    groups.forEach(g => {
      const title = g.querySelector('.tg-name');
      if (title && title.textContent.trim() === name) {
        const header = g.querySelector('[onclick^="tgToggle"]');
        const detail = g.querySelector('.tg-detail');
        const arrow  = g.querySelector('.tg-arrow');
        if (detail && detail.style.display === 'none') {
          detail.style.display = 'block';
          if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
      }
    });
  });
}

// ── 체크박스 선택 관련 함수들
function tradeSetSort(key) {
  if (_tradeSort.key === key) {
    _tradeSort.dir *= -1; // 같은 컬럼 재클릭 → 방향 토글
  } else {
    _tradeSort.key = key;
    _tradeSort.dir = key === 'date' ? -1 : 1; // 날짜는 기본 최신순, 나머지는 오름차순
  }
  renderView();
}
function tradeCheckChange() {
  _updateTradeSelBar();
  // 전체선택 체크박스 상태 동기화
  const all  = document.querySelectorAll('.trade-check');
  const checked = document.querySelectorAll('.trade-check:checked');
  const allCb = $el('tradeCheckAll');
  if (allCb) allCb.checked = all.length > 0 && all.length === checked.length;
  // 선택된 행 하이라이트
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
  // confirm 전에 ids 미리 수집 (DOM 변경 전)
  const ids = [...checked].map(cb => String(cb.dataset.id)).filter(id => id && id !== 'undefined');
  if (ids.length === 0) { showToast('선택 항목의 ID를 읽을 수 없어요. 페이지를 새로고침 후 다시 시도해보세요.', 'error'); return; }
  if (!confirm(`선택한 ${ids.length}건을 삭제할까요?`)) return;
  const idSet = new Set(ids);
  const before = rawTrades.length;
  for (let i = rawTrades.length - 1; i >= 0; i--) {
    // id가 없는 레코드는 날짜+종목+수량 조합으로 방어 매칭
    const rid = rawTrades[i].id != null ? String(rawTrades[i].id) : null;
    if (rid && idSet.has(rid)) {
      rawTrades.splice(i, 1);
    }
  }
  const deleted = before - rawTrades.length;
  if (deleted === 0) {
    showToast('삭제된 항목이 없어요. 페이지를 새로고침 후 다시 시도해보세요.', 'warn');
    return;
  }
  _commitTrades();
}
let _editingTradeId = null;

function openAddTrade(prefill, forceTradeType) {
  _editingTradeId = prefill?.id || null;
  const t = prefill || {};

  // DOM이 없으면 새로 생성
  if (!$el('tradeEditOverlay')) {
    document.body.insertAdjacentHTML('beforeend', buildTradeEditOverlayHTML());
    // 이벤트 위임 등록
    $el('tradeEditOverlay').addEventListener('click', e => {
      if (e.target === $el('tradeEditOverlay')) closeTradeEdit();
    });
  }

  const el = $el('tradeEditOverlay');
  el.style.display = 'flex';

  // 거래 구분 설정 (매수/매도)
  const tradeType = forceTradeType || t.tradeType || 'buy';
  const f = id => $el(id);
  f('te-tradetype-buy').classList.toggle('active', tradeType === 'buy');
  f('te-tradetype-sell').classList.toggle('active', tradeType === 'sell');
  _teSetTradeType(tradeType);

  _refreshTeAcctList(t.acct);
  _refreshTeCodeList(t.name, t.code);

  // 우선순위 ①: EDITABLE_PRICES.assetType/type  ②: 거래이력.assetType  ③: '주식'
  const _teEp = getEP(normName(t.name) || t.name);
  const _teAssetType = getEPType(_teEp, t.assetType || t.type || '주식');
  f('te-assettype').value = _teAssetType;
  // 자산구분 버튼 그룹 렌더링
  (function(){
    const types=['주식','ETF','ISA','IRP','연금','펀드','TDF'];
    const grp=$el('te-assettype-group'); if(!grp) return;
    grp.innerHTML=types.map(t=>
      `<button type="button" onclick="_tePickAssetType('${t}')" class="${_fBtnClass(_teAssetType===t)}">${t}</button>`
    ).join('');
  })();
  f('te-qty').value       = t.qty   || '';
  f('te-price').value     = t.price ?? '';
  f('te-date').value      = t.date  || '';
  f('te-memo').value      = t.memo  || '';
  f('te-title').textContent = _editingTradeId ? '거래 수정' : '거래 추가';
  f('te-error').style.display = 'none';
  f('te-code-status').textContent = '';
}

function _teSetTradeType(type) {
  const f = id => $el(id);
  const isSell = type === 'sell';
  f('te-tradetype-buy').classList.toggle('active', !isSell);
  f('te-tradetype-sell').classList.toggle('active', isSell);
  // 레이블 색상 변경
  const priceLabel = f('te-price-label');
  if (priceLabel) priceLabel.textContent = isSell ? '매도단가 (원) *' : '매수단가 (원) *';
  const dateLabel = f('te-date-label');
  if (dateLabel) dateLabel.textContent = isSell ? '매도일자 *' : '매수일자 *';
  window._currentTradeType = type;
}

// 계좌 목록 갱신
function _refreshTeAcctList(selectedAcct) {
  const acctList = getAcctList();
  const inp = $el('te-acct');
  const grp = $el('te-acct-group');
  if (!inp || !grp) return;
  const active = selectedAcct || acctList[0] || '';
  inp.value = active;
  _renderTeAcctBtns(active, acctList);
}
function _renderTeAcctBtns(active, acctList) {
  const grp = $el('te-acct-group');
  if (!grp) return;
  grp.innerHTML = acctList.map(a =>
    `<button type="button" onclick="_tePickAcct('${a.replace(/'/g,"\\'")}')"`+
    ` class="${_fBtnClass(a===active)}">${a}</button>`
  ).join('');
}
function _tePickAcct(val) {
  const inp = $el('te-acct'); if(inp) inp.value = val;
  const list = getAcctList();
  _renderTeAcctBtns(val, list);
}

// 등록된 종목 datalist 갱신
function _refreshTeCodeList(selectedName, selectedCode) {
  // 등록된 모든 종목 수집
  const names = [...new Set([
    ...EDITABLE_PRICES.map(i => i.name),
    ...rawTrades.map(t => t.name),
    ...rawHoldings.map(h => h.name)
  ])].filter(Boolean).sort();

  // datalist 갱신
  const dl = $el('te-name-list');
  if (dl) dl.innerHTML = names.map(n => {
    const c = STOCK_CODE[n] || '';
    return `<option value="${n}">${n}${c?' ('+c+')':''}</option>`;
  }).join('');

  // 종목명 버튼 그룹 렌더링
  const grp = $el('te-name-btns');
  if (grp) {
    grp.innerHTML = names.map(n =>
      `<button type="button" onclick="_tePickName('${n.replace(/'/g,"\\'")}')"`+
      ` class="${_fBtnClass(n===selectedName)} f-btn-sm">${n}</button>`
    ).join('');
  }

  $el('te-name').value = selectedName || '';
  $el('te-code').value = selectedCode || (selectedName ? STOCK_CODE[selectedName]||'' : '');
}

function _tePickName(name) {
  $el('te-name').value = name;
  const code = STOCK_CODE[name] || '';
  $el('te-code').value = code;
  const status = $el('te-code-status');
  if (code) {
    status.textContent = '✅ ' + name + (code ? ' (' + code + ')' : '');
    status.style.color = 'var(--green)';
  } else {
    // STOCK_CODE에 없으면 EDITABLE_PRICES / GSheet API로 코드 조회
    const ep = EDITABLE_PRICES.find(e => e.name === name);
    const epCode = ep?.code || '';
    if (epCode) {
      $el('te-code').value = epCode;
      status.textContent = '✅ ' + name + ' (' + epCode + ')';
      status.style.color = 'var(--green)';
    } else if (name.trim().length >= 2) {
      teCodeLookup(name);
    } else {
      status.textContent = '';
    }
  }
  // 버튼 활성화 상태 갱신
  const grp = $el('te-name-btns');
  if (!grp) return;
  grp.querySelectorAll('button').forEach(btn => {
    const isActive = btn.textContent === name;
    btn.className = _fBtnClass(isActive) + ' f-btn-sm';
  });
}

// 종목코드 입력 → 종목명 자동조회
async function teCodeLookup(code) {
  const status = $el('te-code-status');
  const nameEl = $el('te-name');
  if (!code || code.length < 4) { status.textContent=''; return; }
  const trimCode = code.trim();

  // 1. EDITABLE_PRICES에서 코드 역방향 검색 (최우선)
  const epItem = getEPByCode(trimCode);
  if (epItem) {
    nameEl.value = epItem.name;
    status.textContent = '✅ ' + epItem.name;
    status.style.color = 'var(--green)';
    return;
  }

  // 2. STOCK_CODE 역방향 검색
  const localName = Object.entries(STOCK_CODE).find(([n,c]) => c.trim() === trimCode)?.[0];
  if (localName) {
    nameEl.value = localName;
    status.textContent = '✅ ' + localName;
    status.style.color = 'var(--green)';
    return;
  }

  // 3. 구글시트 연동 시 API 조회
  if (!GSHEET_API_URL) {
    status.textContent = '⚠️ 기초정보 탭에 코드를 등록하거나 종목명을 직접 입력하세요';
    status.style.color = 'var(--amber)';
    return;
  }
  status.textContent = '⏳ 조회 중...'; status.style.color = 'var(--blue-lt)';
  try {
    const name = await lookupNameByCode(trimCode);
    if (name) {
      nameEl.value = name;
      status.textContent = '✅ ' + name;
      status.style.color = 'var(--green)';
      STOCK_CODE[name] = trimCode;
      saveHoldings();
    } else {
      status.textContent = '⚠️ 코드를 찾을 수 없어요 — 아래 종목명란에 직접 입력해주세요';
      status.style.color = 'var(--amber)';
    }
  } catch(e) {
    status.textContent = '⚠️ 조회 중 오류가 발생했어요 — 아래 종목명란에 직접 입력해주세요';
    status.style.color = 'var(--amber)';
  }
}

// 종목명 선택 → 코드 자동완성
function teNameChange(name) {
  const code = STOCK_CODE[name] || '';
  $el('te-code').value = code;
  const status = $el('te-code-status');
  if (code) {
    status.textContent = '✅ ' + name + ' (' + code + ')';
    status.style.color = 'var(--green)';
  } else {
    status.textContent = '';
  }
  // 버튼 활성화 상태 갱신
  const grp = $el('te-name-btns');
  if (!grp) return;
  grp.querySelectorAll('button').forEach(btn => {
    const isActive = btn.textContent === name;
    btn.className = _fBtnClass(isActive) + ' f-btn-sm';
  });
}

function buildTradeEditOverlayHTML() {
  const inp = (id,ph,tp='text') =>
    `<input id="${id}" type="${tp}" placeholder="${ph}"
      class="input-full-82"/>`;
  const lbl = (txt,req) =>
    `<label class="form-label">${txt}${req?'<span class="c-red"> *</span>':''}</label>`;

  return `<div id="tradeEditOverlay"
    style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;justify-content:center;align-items:center;padding:16px">
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;width:100%;max-width:480px;max-height:92vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 22px 12px;border-bottom:1px solid var(--border)">
        <h3 id="te-title" class="h3-95">거래 추가</h3>
        <button onclick="closeTradeEdit()" class="btn-close-icon">✕</button>
      </div>
      <div style="padding:16px 22px;display:flex;flex-direction:column;gap:11px">
        <div id="te-error" style="display:none;background:var(--c-red-10);border:1px solid var(--c-red-30);border-radius:6px;padding:8px 12px;font-size:.75rem;color:var(--red-lt)"></div>

        <!-- 매수 / 매도 탭 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <button id="te-tradetype-buy" onclick="_teSetTradeType('buy')"
            style="padding:9px;font-size:.80rem;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted);transition:all .15s"
            class="te-type-btn">📈 매수</button>
          <button id="te-tradetype-sell" onclick="_teSetTradeType('sell')"
            style="padding:9px;font-size:.80rem;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted);border-left:1px solid var(--border);transition:all .15s"
            class="te-type-btn">📉 매도</button>
        </div>

        <!-- 계좌 + 자산구분 -->
        <div class="grid-2col">
          <div>
            ${lbl('계좌',true)}
            <input type="hidden" id="te-acct" value=""/>
            <div id="te-acct-group" class="flex-wrap-gap4-mt"></div>
          </div>
          <div>
            ${lbl('자산 구분',false)}
            <input type="hidden" id="te-assettype" value="주식"/>
            <div id="te-assettype-group" class="flex-wrap-gap4-mt"></div>
          </div>
        </div>

        <!-- 종목명 선택 -->
        <div>
          ${lbl('종목명',true)}
          <div id="te-name-btns" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
          <div class="flex-gap6-ai">
            <input id="te-name" type="text" placeholder="직접 입력 또는 위에서 선택"
              list="te-name-list"
              oninput="teNameChange(this.value)"
              class="input-full-82" style="flex:1"/>
            <datalist id="te-name-list"></datalist>
          </div>
          <input type="hidden" id="te-code" value=""/>
          <div id="te-code-status" style="margin-top:4px;font-size:.70rem;min-height:16px"></div>
        </div>

        <!-- 수량 + 날짜 -->
        <div class="grid-2col">
          <div>
            ${lbl('수량',true)}
            ${inp('te-qty','100','number')}
          </div>
          <div>
            <label id="te-date-label" class="form-label">매수일자 *</label>
            ${inp('te-date','','date')}
          </div>
        </div>

        <!-- 단가 -->
        <div>
          <label id="te-price-label" class="form-label">매수단가 (원) *</label>
          ${inp('te-price','58000','number')}
        </div>

        <div>${lbl('메모',false)}${inp('te-memo','선택사항')}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 22px 16px;border-top:1px solid var(--border)">
        <button onclick="closeTradeEdit()" class="btn-ghost-muted">취소</button>
        <button onclick="saveTrade()" class="btn-amber">💾 저장</button>
      </div>
    </div>
  </div>`;
}

function closeTradeEdit() {
  const el = $el('tradeEditOverlay');
  if (el) el.style.display = 'none';
  _editingTradeId = null;
}

function saveTrade() {
  const f = id => $el(id);
  const err = f('te-error');
  const name  = f('te-name').value.trim();
  const qty   = parseInt(f('te-qty').value);
  const date  = f('te-date').value;
  const price = parseFloat(f('te-price').value);
  const tradeType = window._currentTradeType || 'buy';

  if (!name)                      { err.textContent='❌ 종목명을 입력하세요'; err.style.display='block'; return; }
  if (!qty || qty <= 0)           { err.textContent='❌ 수량을 입력하세요 (양수)'; err.style.display='block'; return; }
  if (!date)                      { err.textContent='❌ 날짜를 입력하세요'; err.style.display='block'; return; }
  if (isNaN(price) || price < 0) { err.textContent='❌ 단가를 입력하세요'; err.style.display='block'; return; }

  const code  = f('te-code').value.trim();
  const normN = normName(name) || name;

  const trade = {
    id: _editingTradeId || genTradeId(),
    tradeType,
    acct:      f('te-acct').value,
    assetType: f('te-assettype').value,
    name: normN, code, qty, price, date,
    memo: f('te-memo').value.trim(),
  };

  // 펀드/TDF 플래그
  if (trade.assetType === '펀드' || trade.assetType === 'TDF') trade.fund = true;

  if (_editingTradeId) {
    const idx = rawTrades.findIndex(t => t.id === _editingTradeId);
    if (idx !== -1) rawTrades[idx] = trade;
  } else {
    rawTrades.push(trade);
  }

  // 기초정보 동기화 — EDITABLE_PRICES 우선 원칙:
  // 기존 항목 있으면 code만 보완, 없으면 신규 추가 (sector/assetType 덮어쓰지 않음)
  const epIdx = EDITABLE_PRICES.findIndex(e => e.name === normN);
  if (epIdx === -1) {
    // 신규: assetType과 '기타' sector로 등록 (사용자가 기초정보탭에서 수정)
    epPush(normN, code, trade.assetType);
    if (code) STOCK_CODE[normN] = code;
  } else {
    // 기존: code만 보완, sector/assetType은 기초정보 우선 유지
    if (!EDITABLE_PRICES[epIdx].code && code) {
      EDITABLE_PRICES[epIdx].code = code;
      STOCK_CODE[normN] = code;
    }
    // assetType도 기초정보에 없으면 거래이력에서 보완
    if (!EDITABLE_PRICES[epIdx].assetType && !EDITABLE_PRICES[epIdx].type && trade.assetType) {
      EDITABLE_PRICES[epIdx].assetType = trade.assetType;
    }
  }

  _commitTrades();
  closeTradeEdit();
}

function editTrade(id) {
  const t = rawTrades.find(t => t.id === id);
  if (t) openAddTrade(t);
}// 거래일자 없는 항목 일괄 삭제// ── 일괄 입력 팝업 (엑셀 스타일) ─────────────────────────────────────
// 매수 컬럼
const BULK_COLS_BUY = [
  {key:'acct',     label:'계좌',     w:110, type:'acct_select', req:true},
  {key:'type',     label:'유형',     w:70,  type:'select', opts:['주식','ETF','ISA','IRP','연금','펀드','TDF']},
  {key:'name',     label:'종목명',   w:160, type:'name_select', req:true},
  {key:'code',     label:'종목코드', w:90,  type:'text'},
  {key:'qty',      label:'수량',     w:70,  type:'number', req:true},
  {key:'buyDate',  label:'매수일자', w:110, type:'date',   req:true},
  {key:'buyPrice', label:'매수단가', w:90,  type:'number', req:true},
  {key:'memo',     label:'메모',     w:100, type:'text'},
];
// 매도 컬럼
const BULK_COLS_SELL = [
  {key:'acct',      label:'계좌',     w:110, type:'acct_select', req:true},
  {key:'name',      label:'종목명',   w:160, type:'name_select', req:true},
  {key:'qty',       label:'수량',     w:70,  type:'number', req:true},
  {key:'sellDate',  label:'매도일자', w:110, type:'date',   req:true},
  {key:'sellPrice', label:'매도단가', w:90,  type:'number', req:true},
  {key:'memo',      label:'메모',     w:100, type:'text'},
];
// 혼합 컬럼 (매수/매도 구분 선택)
const BULK_COLS_MIX = [
  {key:'tradeType', label:'구분',     w:70,  type:'select', opts:['buy','sell'], labels:['매수','매도'], req:true},
  {key:'acct',      label:'계좌',     w:110, type:'acct_select', req:true},
  {key:'type',      label:'유형',     w:70,  type:'select', opts:['주식','ETF','ISA','IRP','연금','펀드','TDF']},
  {key:'name',      label:'종목명',   w:160, type:'name_select', req:true},
  {key:'code',      label:'종목코드', w:90,  type:'text'},
  {key:'qty',       label:'수량',     w:70,  type:'number', req:true},
  {key:'date',      label:'거래일자', w:110, type:'date',   req:true},
  {key:'price',     label:'단가',     w:90,  type:'number', req:true},
  {key:'memo',      label:'메모',     w:100, type:'text'},
];
let _bulkMode = 'buy';   // 'buy' | 'sell' | 'mix'
let _bulkRows = [];
let _bulkRowsSell = [];
let _bulkRowsMix = [];
function _getBulkCols() {
  if (_bulkMode === 'buy')  return BULK_COLS_BUY;
  if (_bulkMode === 'sell') return BULK_COLS_SELL;
  return BULK_COLS_MIX;
}
function _getBulkRows() {
  if (_bulkMode === 'buy')  return _bulkRows;
  if (_bulkMode === 'sell') return _bulkRowsSell;
  return _bulkRowsMix;
}

function switchBulkTab(mode) {
  _bulkMode = mode;
  const TAB_CFG = {
    buy:  { bg:'var(--c-green2-15)',  color:'var(--green-lt)', applyBg:'rgba(34,197,94,.85)',
            desc:'계좌·유형·종목명·수량·매수일·매수단가 입력',
            hint:'CSV: 계좌,유형,종목명,종목코드,수량,매수일(YYYY-MM-DD),매수단가,메모' },
    sell: { bg:'var(--c-red-12)',  color:'var(--red-lt)', applyBg:'var(--c-red-80)',
            desc:'계좌·종목명·수량·매도일·매도단가 입력',
            hint:'CSV: 계좌,종목명,수량,매도일(YYYY-MM-DD),매도단가,메모' },
    mix:  { bg:'rgba(139,92,246,.15)', color:'var(--purple-lt)', applyBg:'rgba(139,92,246,.85)',
            desc:'매수·매도 구분 선택 후 한번에 입력',
            hint:'CSV: 계좌,구분(buy/sell),유형,종목명,종목코드,수량,거래일(YYYY-MM-DD),단가,메모' },
  };
  const cfg = TAB_CFG[mode] || TAB_CFG.buy;
  ['buy','sell','mix'].forEach(m => {
    const btn = $el('bulkTab_' + m);
    if (!btn) return;
    const active = m === mode;
    btn.style.background = active ? TAB_CFG[m].bg : 'transparent';
    btn.style.color      = active ? TAB_CFG[m].color : 'var(--muted)';
  });
  const desc     = $el('bulkTabDesc');
  const applyBtn = $el('bulkApplyBtn');
  const hint     = $el('bulkCSVHint');
  if (desc)     desc.textContent = cfg.desc;
  if (hint)     hint.textContent = cfg.hint;
  if (applyBtn) { applyBtn.style.background = cfg.applyBg; applyBtn.style.color = 'var(--text)'; }
  renderBulkGrid();
}

function openBulkImport(defaultMode) {
  _bulkMode = defaultMode || 'buy';
  _bulkRows     = _bulkRows.length     ? _bulkRows     : Array.from({length:10}, () => ({}));
  _bulkRowsSell = _bulkRowsSell.length ? _bulkRowsSell : Array.from({length:10}, () => ({}));
  _bulkRowsMix  = _bulkRowsMix.length  ? _bulkRowsMix  : Array.from({length:10}, () => ({tradeType:'buy'}));
  const el = $el('bulkImportOverlay') || (() => {
    document.body.insertAdjacentHTML('beforeend', buildBulkOverlayHTML());
    return $el('bulkImportOverlay');
  })();
  el.style.display = 'flex';
  switchBulkTab(_bulkMode); // 탭 스타일 초기화
}

function buildBulkOverlayHTML() {
  const tabBtn = (mode, label, color) =>
    `<button id="bulkTab_${mode}" onclick="switchBulkTab('${mode}')"
      style="padding:7px 20px;border-radius:8px;font-size:.82rem;font-weight:700;cursor:pointer;border:2px solid ${color};transition:all .15s"
      >${label}</button>`;
  return `<div id="bulkImportOverlay"
    style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9100;justify-content:center;align-items:center;padding:16px">
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;width:100%;max-width:960px;max-height:92vh;display:flex;flex-direction:column">
      <!-- 헤더 -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 22px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div>
          <h3 class="h3-95">📊 거래 이력 일괄 입력</h3>
          <p style="margin:3px 0 0;font-size:.70rem;color:var(--muted)">엑셀처럼 직접 입력하거나 CSV 파일을 붙여넣기 하세요 · Tab키로 셀 이동</p>
        </div>
        <button onclick="closeBulkImport()" class="btn-close-icon">✕</button>
      </div>
      <!-- 매수/매도/혼합 탭 -->
      <div style="padding:12px 22px 0;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${tabBtn('buy',  '📈 매수', 'rgba(34,197,94,.4)')}
        ${tabBtn('sell', '📉 매도', 'var(--c-red-40)')}
        ${tabBtn('mix',  '🔀 혼합',  'var(--c-purple-40)')}
        <span id="bulkTabDesc" style="font-size:.70rem;color:var(--muted);margin-left:6px"></span>
      </div>
      <!-- 툴바 -->
      <div style="padding:10px 22px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button onclick="addBulkRows(5)" class="btn-ghost-sm">+ 5행 추가</button>
        <button onclick="clearBulkGrid()" class="btn-danger-ghost">전체 지우기</button>
        <label style="padding:4px 12px;border-radius:6px;border:1px solid var(--c-blue2-30);background:var(--c-blue2-08);color:var(--blue-lt);font-size:.72rem;cursor:pointer">
          📁 CSV 불러오기<input type="file" accept=".csv,.txt" onchange="loadBulkCSV(event)" class="d-none"/>
        </label>
        <a href="#" onclick="downloadBulkTemplate();return false"
          style="padding:4px 12px;border-radius:6px;border:1px solid var(--c-green-30);background:var(--c-green-08);color:var(--green-md);font-size:.72rem;cursor:pointer;text-decoration:none">
          ⬇ 템플릿 다운로드
        </a>
        <span id="bulkCSVHint" style="font-size:.70rem;color:var(--muted);margin-left:4px"></span>
      </div>
      <!-- 그리드 -->
      <div id="bulkGridWrap" style="flex:1;min-height:0;overflow:auto;padding:0 12px 12px;-webkit-overflow-scrolling:touch"></div>
      <div id="bulkError" style="display:none;padding:8px 22px;background:var(--c-red-10);color:var(--red-lt);font-size:.75rem;flex-shrink:0"></div>
      <!-- 푸터 -->
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 22px 16px;border-top:1px solid var(--border);flex-shrink:0">
        <button onclick="closeBulkImport()"
          class="btn-ghost-muted">취소</button>
        <button id="bulkApplyBtn" onclick="applyBulkImport()" class="btn-amber">✅ 가져오기</button>
      </div>
    </div>
  </div>`;
}

function renderBulkGrid() {
  const wrap = $el('bulkGridWrap');
  if (!wrap) return;
  const COLS = _getBulkCols();
  const ROWS = _getBulkRows();
  const headerCells = COLS.map(c =>
    `<th style="padding:6px 8px;text-align:left;white-space:nowrap;font-size:.70rem;color:var(--muted);font-weight:600;background:var(--s2);position:sticky;top:0;min-width:${c.w}px">
      ${c.label}${c.req?'<span class="c-red">*</span>':''}
    </th>`
  ).join('') + '<th style="padding:6px 8px;background:var(--s2);position:sticky;top:0"></th>';

  const bodyRows = ROWS.map((row, ri) => {
    const cells = COLS.map(col => {
      const val = row[col.key] || '';
      const selStyle = `width:${col.w}px;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:5px 6px;color:var(--text);font-size:.75rem`;

      if (col.type === 'acct_select') {
        const accts = getAcctList();
        const opts = ['', ...accts].map(o => `<option value="${o}" ${val===o?'selected':''}>${o||'-- 계좌 선택 --'}</option>`).join('');
        return `<td class="p-2"><select onchange="bulkCellChange(${ri},'${col.key}',this.value)" style="${selStyle}">${opts}</select></td>`;
      }
      if (col.type === 'name_select') {
        const names = EDITABLE_PRICES.map(i => i.name);
        const opts = ['', ...names].map(o => `<option value="${o}" ${val===o?'selected':''}>${o||'-- 종목 선택 --'}</option>`).join('');
        return `<td class="p-2"><select onchange="bulkNameChange(${ri},this.value)" style="${selStyle}">${opts}</select></td>`;
      }
      if (col.type === 'select') {
        return `<td class="p-2"><select data-row="${ri}" data-col="${col.key}"
          onchange="bulkCellChange(${ri},'${col.key}',this.value)"
          style="${selStyle}">
          ${(col.opts||[]).map((o,oi)=>`<option value="${o}" ${val===o?'selected':''}>${(col.labels&&col.labels[oi])||o}</option>`).join('')}
        </select></td>`;
      }
      return `<td class="p-2"><input type="${col.type==='number'?'number':'text'}" value="${val}"
        data-row="${ri}" data-col="${col.key}"
        onchange="bulkCellChange(${ri},'${col.key}',this.value)"
        ${col.type==='date'?'placeholder="YYYY-MM-DD"':''}
        style="width:${col.w}px;background:${val?'var(--s2)':'var(--c-white-03)'};border:1px solid ${val?'var(--border)':'transparent'};border-radius:4px;padding:5px 6px;color:var(--text);font-size:.75rem"
        onfocus="this.style.border='1px solid var(--amber)'" onblur="this.style.border='1px solid '+(this.value?'var(--border)':'transparent')"/></td>`;
    }).join('');
    // 혼합 탭: 매수/매도 행 색상 구분
    let rowBg = '';
    if (_bulkMode === 'mix') {
      const tt = row.tradeType || 'buy';
      rowBg = tt === 'buy' ? 'background:rgba(34,197,94,.04)' : 'background:var(--c-red-04)';
    }
    return `<tr style="border-bottom:1px solid var(--border);${rowBg}">${cells}
      <td style="padding:2px;text-align:center">
        <button onclick="removeBulkRow(${ri})" class="btn-icon-muted">✕</button>
      </td></tr>`;
  }).join('');

  wrap.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:.75rem">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function bulkCellChange(ri, col, val) {
  _getBulkRows()[ri][col] = val;
  // 혼합 탭: 구분 바꾸면 행 색상 즉시 갱신
  if (_bulkMode === 'mix' && col === 'tradeType') renderBulkGrid();
}
function bulkNameChange(ri, name) {
  const rows = _getBulkRows();
  rows[ri].name = name;
  // 기초정보 관리에서 코드 자동 채우기 (매수 탭에서만)
  if (_bulkMode === 'buy') {
    const item = getEP(name);
    if (item) rows[ri].code = item.code || '';
  }
  renderBulkGrid();
}
function addBulkRows(n) {
  const rows = _getBulkRows();
  for(let i=0;i<n;i++) rows.push({});
  renderBulkGrid();
}
function removeBulkRow(ri) {
  const rows = _getBulkRows();
  rows.splice(ri,1);
  if(!rows.length) rows.push({});
  renderBulkGrid();
}
function clearBulkGrid() {
  if (_bulkMode === 'buy')   _bulkRows     = Array.from({length:10},()=>({}));
  else if (_bulkMode==='sell') _bulkRowsSell = Array.from({length:10},()=>({}));
  else                        _bulkRowsMix  = Array.from({length:10},()=>({tradeType:'buy'}));
  renderBulkGrid();
}

function loadBulkCSV(evt) {
  const file = evt.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l=>l.trim());
    const start = lines[0].startsWith('계좌') ? 1 : 0;
    if (_bulkMode === 'buy') {
      _bulkRows = lines.slice(start).map(line => {
        const c = line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        return { acct:c[0]||'', type:c[1]||'주식', name:c[2]||'', code:c[3]||'',
                 qty:c[4]||'', buyDate:c[5]||'', buyPrice:c[6]||'', memo:c[7]||'' };
      });
      if (!_bulkRows.length) _bulkRows = [{}];
    } else if (_bulkMode === 'sell') {
      _bulkRowsSell = lines.slice(start).map(line => {
        const c = line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        return { acct:c[0]||'', name:c[1]||'', qty:c[2]||'',
                 sellDate:c[3]||'', sellPrice:c[4]||'', memo:c[5]||'' };
      });
      if (!_bulkRowsSell.length) _bulkRowsSell = [{}];
    } else {
      // mix
      _bulkRowsMix = lines.slice(start).map(line => {
        const c = line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        return { acct:c[0]||'', tradeType:c[1]||'buy', type:c[2]||'주식',
                 name:c[3]||'', code:c[4]||'', qty:c[5]||'',
                 date:c[6]||'', price:c[7]||'', memo:c[8]||'' };
      });
      if (!_bulkRowsMix.length) _bulkRowsMix = [{tradeType:'buy'}];
    }
    renderBulkGrid();
  };
  reader.readAsText(file);
}

function downloadBulkTemplate() {
  let header, rows, filename;
  if (_bulkMode === 'buy') {
    header = '계좌,유형,종목명,종목코드,수량,매수일(YYYY-MM-DD),매수단가,메모';
    rows = rawHoldings.filter(h=>!h.fund).map(h =>
      [h.acct, h.type||'주식', h.name, STOCK_CODE[h.name]||'', h.qty, '', h.cost, ''].join(',')
    );
    filename = 'bulk_buy_template.csv';
  } else if (_bulkMode === 'sell') {
    header = '계좌,종목명,수량,매도일(YYYY-MM-DD),매도단가,메모';
    rows = rawHoldings.filter(h=>!h.fund && h.qty > 0).map(h =>
      [h.acct, h.name, '', '', '', ''].join(',')
    );
    filename = 'bulk_sell_template.csv';
  } else {
    header = '계좌,구분(buy/sell),유형,종목명,종목코드,수량,거래일(YYYY-MM-DD),단가,메모';
    rows = rawHoldings.filter(h=>!h.fund).map(h =>
      [h.acct, 'buy', h.type||'주식', h.name, STOCK_CODE[h.name]||'', h.qty, '', h.cost, ''].join(',')
    );
    filename = 'bulk_mix_template.csv';
  }
  const csv = [header, ...rows].join('\n');
  const a = Object.assign(document.createElement('a'),
    {href: URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),
     download: filename});
  a.click(); URL.revokeObjectURL(a.href);
}

function applyBulkImport() {
  const err = $el('bulkError');
  if (err) err.style.display = 'none';
  const added = [];

  if (_bulkMode === 'buy') {
    // ── 매수 처리 ──
    const valid = _bulkRows.filter(r => r.name && r.acct && r.qty && r.buyDate && r.buyPrice);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·매수일·매수단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN = normName(r.name) || r.name;
      const isFund = (r.type === '펀드' || r.type === 'TDF');
      const trade = {
        id: genTradeId(), tradeType: 'buy',
        acct: r.acct, assetType: r.type||'주식',
        name: normN, code: r.code||'',
        qty: parseInt(r.qty)||0, price: parseFloat(r.buyPrice)||0,
        date: r.buyDate||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
      if (r.code && !STOCK_CODE[normN]) STOCK_CODE[normN] = r.code;
      if (!getEP(normN))
        epPush(normN, r.code, r.type);
    });
    _bulkRows = Array.from({length:10}, () => ({})); // 적용 후 초기화

  } else if (_bulkMode === 'sell') {
    // ── 매도 처리 ──
    const valid = _bulkRowsSell.filter(r => r.name && r.acct && r.qty && r.sellDate && r.sellPrice);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·매도일·매도단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN = normName(r.name) || r.name;
      const ep = getEP(normN);
      const isFund = ep && (ep.assetType === '펀드' || ep.assetType === 'TDF');
      const trade = {
        id: genTradeId(), tradeType: 'sell',
        acct: r.acct, assetType: ep ? ep.assetType : '주식',
        name: normN, code: ep ? ep.code||'' : '',
        qty: parseInt(r.qty)||0, price: parseFloat(r.sellPrice)||0,
        date: r.sellDate||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
    });
    _bulkRowsSell = Array.from({length:10}, () => ({})); // 적용 후 초기화

  } else {
    // ── 혼합 처리 ──
    const valid = _bulkRowsMix.filter(r => r.name && r.acct && r.qty && r.date && r.price);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·거래일·단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN    = normName(r.name) || r.name;
      const tt       = r.tradeType === 'sell' ? 'sell' : 'buy';
      const ep       = getEP(normN);
      const assetType = ep ? ep.assetType : (r.type || '주식');
      const isFund   = (assetType === '펀드' || assetType === 'TDF');
      const trade = {
        id: genTradeId(), tradeType: tt,
        acct: r.acct, assetType,
        name: normN, code: r.code || (ep ? ep.code||'' : ''),
        qty: parseInt(r.qty)||0, price: parseFloat(r.price)||0,
        date: r.date||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
      if (r.code && !STOCK_CODE[normN]) STOCK_CODE[normN] = r.code;
      if (!ep && tt === 'buy')
        epPush(normN, r.code, assetType);
    });
    _bulkRowsMix = Array.from({length:10}, () => ({tradeType:'buy'}));
  }

  _commitTrades();
  closeBulkImport();
  const label = _bulkMode === 'buy' ? '매수' : _bulkMode === 'sell' ? '매도' : '혼합';
  showToast(`${label} ${added.length}건 가져오기 완료`, 'ok');
}

function closeBulkImport() {
  const el = $el('bulkImportOverlay');
  if (el) el.style.display = 'none';
}

//  rawHoldings → rawTrades 마이그레이션
//  rawTrades가 비어있는데 rawHoldings에 데이터 있으면 실행
function checkAndShowMigration() {
  // rawTrades 있으면 정상 상태
  if (rawTrades.length > 0) return;
  // rawHoldings에 펀드 제외 종목이 있으면 마이그레이션 팝업 (구버전 데이터)
  const holdingsToMigrate = rawHoldings.filter(h => !h.fund);
  if (holdingsToMigrate.length > 0) {
    setTimeout(() => {
      if (!$el('migrationOverlay')) {
        document.body.insertAdjacentHTML('beforeend', buildMigrationHTML());
      }
      if($el('migrationOverlay'))$el('migrationOverlay').style.display='flex';
      renderMigrationTable();
    }, 800);
  }
  // rawHoldings도 비어있으면 = 완전 처음 접속 → 거래이력 탭으로 안내
  else if (rawHoldings.length === 0) {
    setTimeout(() => {
      const area = $el('view-area');
      if (area && area.innerHTML.trim() === '') return;
      // 거래이력 탭에 빈 상태 안내 배너는 renderTradesView에서 처리
      switchView('trades');
    }, 600);
  }
}

function buildMigrationHTML() {
  return `<div id="migrationOverlay"
    style="display:none;position:fixed;inset:0;background:var(--c-black-82);z-index:9500;justify-content:center;align-items:center;padding:16px">
    <div style="background:var(--s1);border:1px solid var(--c-amber-40);border-radius:14px;width:100%;max-width:680px;max-height:92vh;display:flex;flex-direction:column">

      <div style="padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
        <h3 class="h3-1rem-mb4">🔄 기존 보유 종목 → 거래 이력으로 변환</h3>
        <p class="txt-73-muted">
          현재 하드코딩된 보유 종목을 거래 이력 시스템으로 가져와요.<br>
          <b class="c-amber">매수일자</b>를 입력하면 정확한 이력 관리가 가능해요. 모르면 비워두셔도 돼요.
        </p>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 24px">
        <div id="migrationTableWrap"></div>
      </div>

      <div style="padding:12px 24px 16px;border-top:1px solid var(--border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="txt-muted-72">
          💡 나중에 하려면 닫기 · 거래이력 탭 → 📊 일괄 입력에서도 가능해요
        </div>
        <div class="flex-gap8">
          <button onclick="closeMigration()"
            class="btn-ghost-muted">
            나중에
          </button>
          <button onclick="applyMigration()" class="btn-amber">
            ✅ 거래 이력으로 가져오기
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

let _migrationRows = [];

function renderMigrationTable() {
  _migrationRows = rawHoldings.filter(h => !h.fund).map(h => ({
    acct: h.acct, type: h.type||'주식', name: h.name,
    code: STOCK_CODE[h.name] || '',
    qty: h.qty, buyPrice: h.cost,
    buyDate: '',   // 사용자가 입력
    include: true
  }));

  const wrap = $el('migrationTableWrap');
  if (!wrap) return;

  wrap.innerHTML = `
  <div class="overflow-x-auto">
  <table style="width:100%;border-collapse:collapse;font-size:.75rem;min-width:400px">
    <thead>
      <tr style="background:var(--s2)">
        <th style="padding:7px 8px;text-align:center;width:32px">
          <input type="checkbox" id="mig-all" onchange="migToggleAll(this.checked)" checked/>
        </th>
        <th class="th-left-muted">계좌</th>
        <th class="th-left-muted">종목명</th>
        <th class="th-left-muted">코드</th>
        <th class="th-right-muted">수량</th>
        <th class="th-right-muted">평균단가(원)</th>
        <th style="padding:7px 8px;text-align:left;color:var(--amber);font-weight:600">매수일자 <span style="color:var(--muted);font-weight:400">(선택)</span></th>
      </tr>
    </thead>
    <tbody>
      ${_migrationRows.map((r,i) => `
      <tr class="bd-bottom">
        <td class="td-center-p6">
          <input type="checkbox" data-mig-idx="${i}" onchange="_migrationRows[${i}].include=this.checked" checked/>
        </td>
        <td class="td-p6">
          <span class="adot" style="background:${ACCT_COLORS[r.acct]||'var(--muted)'}"></span>${r.acct}
        </td>
        <td style="padding:6px 8px;font-weight:600">${r.name}</td>
        <td style="padding:6px 8px;color:var(--muted)">${r.code||'-'}</td>
        <td class="td-right-p6">${r.qty.toLocaleString()}</td>
        <td class="td-right-p6">${r.buyPrice.toLocaleString()}</td>
        <td class="td-p6">
          <input type="date" value="${r.buyDate}"
            onchange="_migrationRows[${i}].buyDate=this.value"
            style="background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;color:var(--text);font-size:.72rem;width:130px"/>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
  <div style="margin-top:10px;font-size:.70rem;color:var(--muted)">
    📌 체크 해제한 항목은 가져오지 않아요 · 매수일자 없이 가져오면 날짜만 비워서 저장돼요
  </div>`;
}

function migToggleAll(checked) {
  _migrationRows.forEach((r,i) => {
    r.include = checked;
    const cb = document.querySelector(`[data-mig-idx="${i}"]`);
    if (cb) cb.checked = checked;
  });
}

function applyMigration() {
  const selected = _migrationRows.filter(r => r.include);
  if (selected.length === 0) { showToast('가져올 항목을 선택해주세요', 'warn'); return; }

  selected.forEach(r => {
    const normN = normName(r.name) || r.name;
    // ★ 신형 tradeType:'buy' 형식으로 직접 생성 (구형 키 buyDate/buyPrice 사용 금지)
    rawTrades.push({
      id:        genTradeId(),
      tradeType: 'buy',
      acct:      r.acct,
      assetType: r.type || '주식',
      name:      normN,
      code:      r.code || '',
      qty:       r.qty,
      price:     r.buyPrice,
      date:      r.buyDate || '',
      memo:      '기존 보유 종목에서 변환',
    });
    // ★ EDITABLE_PRICES 자동 등록 (기초정보에 없으면 추가)
    if (!getEP(normN)) {
      epPush(normN, r.code || '', r.type);
      if (r.code) STOCK_CODE[normN] = r.code;
    }
  });

  _commitTrades();
  closeMigration();
  showToast(`${selected.length}개 종목을 거래 이력으로 가져왔어요! 거래이력 탭에서 확인하세요.`, 'ok');
}

function closeMigration() {
  const el = $el('migrationOverlay');
  if (el) el.style.display = 'none';
}

