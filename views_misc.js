// ════════════════════════════════════════════════════════════════
//  views_misc.js — 공통 뷰 헬퍼 (요약카드·뷰라우터·계좌순서·날짜뱃지)
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

  const loanBal = LOAN.balance;
  const reVal   = REAL_ESTATE.currentValue || 0;
  const netAsset = total + reVal - loanBal;
  if ($el('s-net')) {
    $el('s-net').textContent = fmt(netAsset);
    $el('s-net').className   = netAsset >= 0 ? 'val c-cyan' : 'val c-red';
  }
  const netSub = reVal > 0
    ? `투자 ${fmt(total)} + 부동산 ${fmt(reVal)} - 대출 ${fmt(loanBal)}`
    : `투자 ${fmt(total)} - 대출 ${fmt(loanBal)}`;
  if ($el('s-net-sub')) $el('s-net-sub').textContent = netSub;

  // 부동산 카드
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

  // 주담대 카드
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

// ── 뷰 라우터
let currentView = 'acct';

// 자산 비중 카드를 숨기는 탭
const TABS_NO_CHARTS = new Set(['trades','tradegroup','history','div','asset','stocks','gsheet']);

function switchView(v) {
  currentView = v;
  try { buildTabBar(); renderView(); renderDonut(); } catch(e) { console.warn('뷰 전환 실패:', e); buildTabBar(); }
  const charts = $el('chartsRow');
  if (charts) charts.style.display = TABS_NO_CHARTS.has(v) ? 'none' : '';
}

function renderView() {
  const area = $el('view-area');
  if (currentView === 'acct')        renderAcctView(area);
  else if (currentView === 'sector') renderSectorView(area);
  else if (currentView === 'merge')  renderMergeView(area);
  else if (currentView === 'trades')      renderTradesView(area);
  else if (currentView === 'tradegroup')  renderTradeGroupView(area);
  else if (currentView === 'history')     renderHistoryView(area);
  else if (currentView === 'div')         renderDivView(area);
  else if (currentView === 'asset')       renderAssetView(area);
  else if (currentView === 'stocks')      renderStocksView(area);
  else if (currentView === 'gsheet')      renderGsheetView(area);
}

// ── 계좌 순서 관리
let ACCT_ORDER = lsGet(ACCT_ORDER_KEY, ['전체']);

function saveAcctOrder() {
  lsSave(ACCT_ORDER_KEY, ACCT_ORDER);
}

function syncAcctOrder() {
  [...rawHoldings, ...rawTrades].forEach(h => {
    if (!h.acct) return;
    getOrAssignColor(h.acct);
    if (!ACCT_ORDER.includes(h.acct)) { ACCT_ORDER.push(h.acct); saveAcctOrder(); }
  });
}

// ── 날짜 뱃지 업데이트
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
