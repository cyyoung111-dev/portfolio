// ════════════════════════════════════════════════════════════════
//  views_misc.js — 공통 뷰 헬퍼 (요약카드·뷰라우터·탭바·계좌순서·날짜뱃지)
//  의존: data.js, views_portfolio.js, views_trades.js,
//        views_div_asset.js, views_system.js
// ════════════════════════════════════════════════════════════════

// ── 상단 요약 카드
function renderSummary() {
  const total = rows.reduce((s,r) => s+r.evalAmt, 0);
  const cost  = rows.reduce((s,r) => s+r.costAmt, 0);
  const pnl = total - cost, pct = cost > 0 ? pnl/cost*100 : 0;
  if ($el('s-total'))     $el('s-total').textContent = fmt(total);
  if ($el('s-total-sub')) $el('s-total-sub').textContent = fmtW(Math.round(total));
  if ($el('s-cost'))      $el('s-cost').textContent = fmt(cost);
  if ($el('s-pnl'))       $el('s-pnl').innerHTML = `<span style="color:${pColor(pnl)}">${pSign(pnl)}${fmt(pnl)}</span>`;
  if ($el('s-pnl-pct'))   $el('s-pnl-pct').innerHTML = `<span style="color:${pColor(pnl)}">${pSign(pnl)}${pct.toFixed(1)}%</span>`;

  const loanBal  = LOAN.balance;
  const reVal    = REAL_ESTATE.currentValue || 0;
  const netAsset = total + reVal - loanBal;
  if ($el('s-net')) {
    $el('s-net').textContent = fmt(netAsset);
    $el('s-net').className   = netAsset >= 0 ? 'val c-cyan' : 'val c-red';
  }
  const netSub = reVal > 0
    ? `투자 ${fmt(total)} + 부동산 ${fmt(reVal)} - 대출 ${fmt(loanBal)}`
    : `투자 ${fmt(total)} - 대출 ${fmt(loanBal)}`;
  if ($el('s-net-sub')) $el('s-net-sub').textContent = netSub;

  const reCard = $el('s-realestate');
  const reSub  = $el('s-realestate-sub');
  if (reCard) {
    reCard.textContent = reVal > 0 ? fmt(reVal) : '미입력';
    reCard.style.color = reVal > 0 ? 'var(--amber)' : 'var(--muted)';
  }
  if (reSub) {
    const rePnl = reVal > 0 && REAL_ESTATE.purchasePrice > 0 ? reVal - REAL_ESTATE.purchasePrice : null;
    reSub.textContent = rePnl !== null
      ? `${REAL_ESTATE.name} · ${pSign(rePnl)}${fmt(rePnl)}`
      : REAL_ESTATE.name || '부동산 실거래가 입력 필요';
  }

  const loanBalEl = $el('loan-summary-bal');
  const loanSub   = $el('loan-summary-sub');
  if (loanBalEl) {
    if (LOAN.balance > 0) {
      loanBalEl.textContent = fmt(LOAN.balance);
      loanBalEl.style.color = 'var(--red)';
    } else {
      loanBalEl.textContent = '미입력';
      loanBalEl.style.color = 'var(--muted)';
    }
  }
  if (loanSub) {
    loanSub.textContent = LOAN.balance > 0
      ? `고정 ${LOAN.annualRate}% · ${LOAN.remainingMonths}개월 남음`
      : '부동산 탭에서 입력';
  }
}

// ════════════════════════════════════════════════════════════════
//  탭 정의
// ════════════════════════════════════════════════════════════════
const TAB_DEFS = [
  { key: 'acct',       label: '계좌별',   icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2M12 12v3M8 12v3"/></svg>' },
  { key: 'sector',     label: '섹터별',   icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>' },
  { key: 'merge',      label: '통합',     icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
  { key: 'trades',     label: '거래이력', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
  { key: 'tradegroup', label: '종목별',   icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
  { key: 'history',    label: '수익이력', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' },
  { key: 'div',        label: '배당',     icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
  { key: 'asset',      label: '부동산',   icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
];

// 탭 순서 (localStorage 복원, 없으면 기본값)
let _tabOrder = lsGet(TAB_ORDER_KEY, TAB_DEFS.map(t => t.key));
// 새 탭 자동 보완
TAB_DEFS.forEach(t => { if (!_tabOrder.includes(t.key)) _tabOrder.push(t.key); });

function _saveTabOrder() { lsSave(TAB_ORDER_KEY, _tabOrder); }

// ── 탭바 렌더링
function buildTabBar() {
  const switcher = $el('viewSwitcher');
  if (!switcher) return;

  // fixed 버튼(stocks/gsheet) active 처리
  ['stocks', 'gsheet'].forEach(function(key) {
    const btn = $el('fixed-btn-' + key);
    if (btn) btn.classList.toggle('active', currentView === key);
  });

  const orderedDefs = _tabOrder
    .map(function(k) { return TAB_DEFS.find(function(t) { return t.key === k; }); })
    .filter(Boolean);

  switcher.innerHTML = orderedDefs.map(function(tab) {
    return '<button'
      + ' onclick="switchView(\'' + tab.key + '\')"'
      + ' class="vs-btn' + (currentView === tab.key ? ' active' : '') + '"'
      + ' draggable="true"'
      + ' data-tab-key="' + tab.key + '"'
      + ' ondragstart="_tabDragStart(event)"'
      + ' ondragover="_tabDragOver(event)"'
      + ' ondrop="_tabDrop(event)"'
      + ' ondragend="_tabDragEnd(event)"'
      + '>'
      + '<span class="vs-btn-icon">' + tab.icon + '</span>'
      + '<span class="vs-btn-label">' + tab.label + '</span>'
      + '</button>';
  }).join('');
}

// ── 드래그 앤 드롭
let _dragKey = null;
function _tabDragStart(e) {
  _dragKey = e.currentTarget.dataset.tabKey;
  e.currentTarget.classList.add('dragging');
}
function _tabDragOver(e) {
  e.preventDefault();
  document.querySelectorAll('#viewSwitcher .vs-btn').forEach(function(b) { b.classList.remove('drag-over'); });
  e.currentTarget.classList.add('drag-over');
}
function _tabDrop(e) {
  e.preventDefault();
  const targetKey = e.currentTarget.dataset.tabKey;
  if (!_dragKey || _dragKey === targetKey) return;
  const fromIdx = _tabOrder.indexOf(_dragKey);
  const toIdx   = _tabOrder.indexOf(targetKey);
  if (fromIdx === -1 || toIdx === -1) return;
  _tabOrder.splice(fromIdx, 1);
  _tabOrder.splice(toIdx, 0, _dragKey);
  _saveTabOrder();
  buildTabBar();
}
function _tabDragEnd(e) {
  document.querySelectorAll('#viewSwitcher .vs-btn').forEach(function(b) {
    b.classList.remove('dragging', 'drag-over');
  });
  _dragKey = null;
}

// ── 탭 순서 설정 오버레이
function openTabSettings() {
  const o = $el('tabSettingsOverlay');
  if (o) o.style.display = 'flex';
  _renderTabSettingsBody();
}
function closeTabSettings() {
  const o = $el('tabSettingsOverlay');
  if (o) o.style.display = 'none';
}
function resetTabOrder() {
  _tabOrder = TAB_DEFS.map(function(t) { return t.key; });
  _saveTabOrder();
  _renderTabSettingsBody();
  buildTabBar();
}
function _renderTabSettingsBody() {
  const body = $el('tabSettingsBody');
  if (!body) return;
  const orderedDefs = _tabOrder
    .map(function(k) { return TAB_DEFS.find(function(t) { return t.key === k; }); })
    .filter(Boolean);
  body.innerHTML = orderedDefs.map(function(tab, i) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--border)">'
      + '<span style="flex:1;font-size:.80rem;color:var(--text)">' + tab.label + '</span>'
      + '<button class="btn-move-icon" onclick="_tabMoveUp(' + i + ')"' + (i===0?' disabled':'') + '>▲</button>'
      + '<button class="btn-move-icon" onclick="_tabMoveDown(' + i + ')"' + (i===orderedDefs.length-1?' disabled':'') + '>▼</button>'
      + '</div>';
  }).join('');
}
function _tabMoveUp(i) {
  if (i === 0) return;
  const tmp = _tabOrder[i-1]; _tabOrder[i-1] = _tabOrder[i]; _tabOrder[i] = tmp;
  _saveTabOrder(); _renderTabSettingsBody(); buildTabBar();
}
function _tabMoveDown(i) {
  if (i >= _tabOrder.length - 1) return;
  const tmp = _tabOrder[i]; _tabOrder[i] = _tabOrder[i+1]; _tabOrder[i+1] = tmp;
  _saveTabOrder(); _renderTabSettingsBody(); buildTabBar();
}

// ════════════════════════════════════════════════════════════════
//  뷰 라우터
// ════════════════════════════════════════════════════════════════
let currentView = 'acct';

const TABS_NO_CHARTS = new Set(['trades','tradegroup','history','div','asset','stocks','gsheet']);

function switchView(v) {
  currentView = v;
  try { buildTabBar(); renderView(); renderDonut(); } catch(e) { console.warn('뷰 전환 실패:', e); buildTabBar(); }
  const charts = $el('chartsRow');
  if (charts) charts.style.display = TABS_NO_CHARTS.has(v) ? 'none' : '';
}

function renderView() {
  const area = $el('view-area');
  if      (currentView === 'acct')       renderAcctView(area);
  else if (currentView === 'sector')     renderSectorView(area);
  else if (currentView === 'merge')      renderMergeView(area);
  else if (currentView === 'trades')     renderTradesView(area);
  else if (currentView === 'tradegroup') renderTradeGroupView(area);
  else if (currentView === 'history')    renderHistoryView(area);
  else if (currentView === 'div')        renderDivView(area);
  else if (currentView === 'asset')      renderAssetView(area);
  else if (currentView === 'stocks')     renderStocksView(area);
  else if (currentView === 'gsheet')     renderGsheetView(area);
}

// ════════════════════════════════════════════════════════════════
//  계좌 순서 관리
// ════════════════════════════════════════════════════════════════
let ACCT_ORDER = lsGet(ACCT_ORDER_KEY, ['전체']);

function saveAcctOrder() { lsSave(ACCT_ORDER_KEY, ACCT_ORDER); }

function syncAcctOrder() {
  [].concat(rawHoldings, rawTrades).forEach(function(h) {
    if (!h.acct) return;
    getOrAssignColor(h.acct);
    if (!ACCT_ORDER.includes(h.acct)) { ACCT_ORDER.push(h.acct); saveAcctOrder(); }
  });
}

// ════════════════════════════════════════════════════════════════
//  날짜 뱃지 업데이트
// ════════════════════════════════════════════════════════════════
function updateDateBadge(dateStr, isToday) {
  const badge = $el('dateBadge');
  if (!badge) return;
  const digits = (dateStr || '').replace(/\D/g, '');
  const normalized = digits.length >= 8
    ? digits.slice(0,4) + '.' + digits.slice(4,6) + '.' + digits.slice(6,8)
    : (dateStr || '').replace(/-/g, '.').slice(0, 10);
  const todayLabel = getDateStr(0).replace(/-/g, '.');
  const _isToday = (isToday === undefined) ? (normalized === todayLabel) : isToday;
  badge.textContent = _isToday ? normalized + ' 실시간' : normalized + ' 종가';
  badge.style.display = 'inline-block';
  badge.className = _isToday ? 'date-badge date-badge-live' : 'date-badge';
}

// ════════════════════════════════════════════════════════════════
//  앱 초기화 (모든 JS 로드 완료 후 실행)
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  const dateInput = $el('quickDateInput');
  if (dateInput) dateInput.value = getDateStr(0);

  syncAcctOrder();
  buildTabBar();
  switchView('acct');

  if (typeof initGsheet === 'function') initGsheet();
});
