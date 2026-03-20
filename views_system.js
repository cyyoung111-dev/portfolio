// ════════════════════════════════════════════════════════════════
//  views_system.js — 탭·뷰라우터·요약카드·계좌순서·날짜뱃지·백업/복원/초기화
//  의존: core_storage.js(lsGet/lsSave/lsRemove), data.js(각종 KEY 상수)
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
//  탭 정의 — stocks/gsheet 제외 (오른쪽 고정 버튼으로만 존재)
// ════════════════════════════════════════════════════════════════
const TAB_DEFAULTS = [
  {id:'acct',       label:'계좌별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2M12 12v3M8 12v3"/></svg>'},
  {id:'sector',     label:'섹터별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>'},
  {id:'merge',      label:'종목별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'},
  {id:'trades',     label:'거래 이력',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'},
  {id:'tradegroup', label:'종목별 거래', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>'},
  {id:'history',    label:'손익 그래프', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'},
  {id:'div',        label:'배당',       icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'},
  {id:'asset',      label:'부동산',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'},
];

// TAB_ORDER: localStorage 복원 (새 탭이 추가돼도 안전하게 병합)
let TAB_ORDER = (function() {
  const saved = lsGet(TAB_ORDER_KEY, null);
  if (saved) {
    // 구버전(id 배열) 또는 신버전({id,hidden} 배열) 모두 지원
    const items = Array.isArray(saved) ? saved.map(v => typeof v === 'string' ? { id: v, hidden: false } : v) : [];
    const filtered = items.filter(item => item.id !== 'stocks' && item.id !== 'gsheet');
    const ordered = filtered.map(item => {
      const def = TAB_DEFAULTS.find(t => t.id === item.id);
      return def ? { ...def, hidden: item.hidden || false } : null;
    }).filter(Boolean);
    TAB_DEFAULTS.forEach(t => { if (!ordered.find(o => o.id === t.id)) ordered.push({ ...t, hidden: false }); });
    return ordered;
  }
  return TAB_DEFAULTS.map(t => ({ ...t, hidden: false }));
})();

function saveTabOrder() {
  // id와 hidden 상태 함께 저장
  lsSave(TAB_ORDER_KEY, TAB_ORDER.map(t => ({ id: t.id, hidden: t.hidden || false })));
}

// ── 탭바 렌더링
function buildTabBar() {
  const vs = $el('viewSwitcher');
  if (!vs) return;
  vs.innerHTML = '';

  // 오른쪽 고정 버튼(stocks/gsheet) active 처리
  ['stocks', 'gsheet'].forEach(function(key) {
    const btn = $el('fixed-btn-' + key);
    if (btn) btn.classList.toggle('active', currentView === key);
  });

  TAB_ORDER.forEach(tab => {
    if (tab.hidden) return; // 숨김 탭 제외
    const isActive = currentView === tab.id;
    const btn = document.createElement('button');
    btn.className = 'vs-btn v-' + tab.id + (isActive ? ' active' : '');
    btn.dataset.tabId = tab.id;
    btn.setAttribute('draggable', true);
    btn.innerHTML = `<span class="vs-btn-icon">${tab.icon || ''}</span><span class="vs-btn-label">${tab.label}</span>`;
    btn.addEventListener('click', () => switchView(tab.id));
    btn.addEventListener('dragstart', e => { e.dataTransfer.setData('tabId', tab.id); btn.classList.add('dragging'); });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    btn.addEventListener('dragover', e => { e.preventDefault(); btn.classList.add('drag-over'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', e => {
      e.preventDefault(); btn.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('tabId');
      if (fromId === tab.id) return;
      const fi = TAB_ORDER.findIndex(t => t.id === fromId);
      const ti = TAB_ORDER.findIndex(t => t.id === tab.id);
      if (fi === -1 || ti === -1) return;
      const [moved] = TAB_ORDER.splice(fi, 1);
      TAB_ORDER.splice(ti, 0, moved);
      saveTabOrder(); buildTabBar();
    });
    vs.appendChild(btn);
  });
}

// ── 탭 순서 설정 패널
function openTabSettings() {
  renderTabSettingsBody();
  const ov = $el('tabSettingsOverlay');
  if (ov) ov.style.display = 'flex';
}
function closeTabSettings() {
  const ov = $el('tabSettingsOverlay');
  if (ov) ov.style.display = 'none';
}
function resetTabOrder() {
  TAB_ORDER.length = 0;
  TAB_DEFAULTS.forEach(t => TAB_ORDER.push({ ...t, hidden: false }));
  saveTabOrder();
  buildTabBar();
  renderTabSettingsBody();
}
function toggleTabHidden(idx) {
  if (TAB_ORDER[idx]) {
    TAB_ORDER[idx].hidden = !TAB_ORDER[idx].hidden;
    // 숨긴 탭이 현재 뷰이면 첫 번째 보이는 탭으로 이동
    if (TAB_ORDER[idx].hidden && currentView === TAB_ORDER[idx].id) {
      const first = TAB_ORDER.find(t => !t.hidden);
      if (first) switchView(first.id);
    }
    saveTabOrder();
    buildTabBar();
    renderTabSettingsBody();
  }
}
function moveTab(idx, dir) {
  const ni = idx + dir;
  if (ni < 0 || ni >= TAB_ORDER.length) return;
  [TAB_ORDER[idx], TAB_ORDER[ni]] = [TAB_ORDER[ni], TAB_ORDER[idx]];
  saveTabOrder();
  buildTabBar();
  renderTabSettingsBody();
}
function renderTabSettingsBody() {
  const body = $el('tabSettingsBody');
  if (!body) return;
  let html = '';
  TAB_ORDER.forEach((tab, i) => {
    const isFirst = i === 0, isLast = i === TAB_ORDER.length - 1;
    html += `<div class="tab-setting-row" draggable="true" data-idx="${i}"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;background:var(--s2);cursor:grab;transition:background .12s;opacity:${tab.hidden?'.45':'1'}">
      <span style="font-size:.75rem;color:var(--muted);cursor:grab;user-select:none">⠿</span>
      <span style="display:flex;align-items:center;gap:8px;flex:1;font-size:.80rem"><span style="width:16px;height:16px;display:inline-flex;align-items:center">${tab.icon||''}</span>${tab.label}${tab.hidden?'<span style="font-size:.60rem;color:var(--muted);margin-left:4px">(숨김)</span>':''}</span>
      <button onclick="moveTab(${i},-1)" ${isFirst?'disabled':''} class="btn-move-icon">↑</button>
      <button onclick="moveTab(${i},1)" ${isLast?'disabled':''} class="btn-move-icon">↓</button>
      <button onclick="toggleTabHidden(${i})" class="btn-move-icon" title="${tab.hidden?'표시':'숨김'}"
        style="color:${tab.hidden?'var(--muted)':'var(--text)'};border-color:${tab.hidden?'var(--border)':'var(--c-amber-40)'}">
        ${tab.hidden?'🙈':'👁'}
      </button>
    </div>`;
  });
  body.innerHTML = html;

  let dragSrcIdx = null;
  body.querySelectorAll('.tab-setting-row').forEach(row => {
    row.addEventListener('dragstart', e => { dragSrcIdx = parseInt(row.dataset.idx); row.style.opacity = '.4'; });
    row.addEventListener('dragend', () => { row.style.opacity = ''; });
    row.addEventListener('dragover', e => { e.preventDefault(); row.style.background = 'var(--s1)'; });
    row.addEventListener('dragleave', () => { row.style.background = 'var(--s2)'; });
    row.addEventListener('drop', e => {
      e.preventDefault(); row.style.background = 'var(--s2)';
      const toIdx = parseInt(row.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === toIdx) return;
      const [moved] = TAB_ORDER.splice(dragSrcIdx, 1);
      TAB_ORDER.splice(toIdx, 0, moved);
      saveTabOrder(); buildTabBar(); renderTabSettingsBody();
    });
  });
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
  if (!area) return;
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
//  데이터 백업/복원
// ════════════════════════════════════════════════════════════════
function exportData() {
  const data = {
    version: 'pf_v6',
    exportedAt: new Date().toISOString(),
    rawTrades,
    STOCK_CODE,
    ACCT_COLORS,
    ACCT_ORDER,
    LOAN,
    REAL_ESTATE,
    EDITABLE_PRICES,
    SECTOR_COLORS,
    gsheetUrl: GSHEET_API_URL || '',
    savedPrices,
    savedPriceDates,
    lastUpdated,
    DIVDATA,
    fundDirect,
    LOAN_SCHEDULE,
    RE_VALUE_HIST,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `portfolio_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.version !== 'pf_v6') {
        showToast('이 파일은 호환되지 않는 버전이에요 (version: ' + (data.version||'?') + ')', 'error');
        return;
      }
      if (!confirm(`📂 "${file.name}" 파일로 데이터를 복원할까요?\n현재 데이터가 덮어씌워집니다.`)) return;

      if (Array.isArray(data.rawTrades)) { rawTrades.length = 0; data.rawTrades.forEach(t => rawTrades.push(t)); }
      if (data.STOCK_CODE) Object.assign(STOCK_CODE, data.STOCK_CODE);
      if (data.ACCT_COLORS) { Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]); Object.assign(ACCT_COLORS, data.ACCT_COLORS); }
      if (Array.isArray(data.ACCT_ORDER)) { ACCT_ORDER.length = 0; data.ACCT_ORDER.forEach(a => ACCT_ORDER.push(a)); }
      if (data.LOAN) Object.assign(LOAN, data.LOAN);
      if (data.REAL_ESTATE) Object.assign(REAL_ESTATE, data.REAL_ESTATE);
      if (Array.isArray(data.EDITABLE_PRICES)) { EDITABLE_PRICES.length = 0; data.EDITABLE_PRICES.forEach(e => EDITABLE_PRICES.push(e)); }
      if (data.SECTOR_COLORS) {
        Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
        Object.entries(data.SECTOR_COLORS).forEach(([k, v]) => {
          SECTOR_COLORS[k] = (typeof v === 'string' && v.startsWith('var(')) ? resolveColor(v) : v;
        });
        lsSave(SECTOR_COLORS_KEY, SECTOR_COLORS);
      }
      if (data.gsheetUrl) { saveGsheetUrl(data.gsheetUrl); }
      if (data.savedPrices) Object.assign(savedPrices, data.savedPrices);
      if (data.savedPriceDates) Object.assign(savedPriceDates, data.savedPriceDates);
      if (data.lastUpdated) lastUpdated = data.lastUpdated;
      if (data.DIVDATA && typeof data.DIVDATA === 'object') { Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]); Object.assign(DIVDATA, data.DIVDATA); }
      if (data.fundDirect && typeof data.fundDirect === 'object') { Object.keys(fundDirect).forEach(k => delete fundDirect[k]); Object.assign(fundDirect, data.fundDirect); }
      if (Array.isArray(data.LOAN_SCHEDULE)) { LOAN_SCHEDULE.length = 0; data.LOAN_SCHEDULE.forEach(r => LOAN_SCHEDULE.push(r)); }
      if (Array.isArray(data.RE_VALUE_HIST)) { RE_VALUE_HIST.length = 0; data.RE_VALUE_HIST.forEach(r => RE_VALUE_HIST.push(r)); }

      syncHoldingsFromTrades();
      saveHoldings();
      syncAcctOrder();
      saveAcctColors();
      saveAcctOrder();
      saveRealEstate();
      saveSchedule();
      lsSave(LOAN_KEY, LOAN);

      refreshAll();
      if (typeof _mgmtRefresh === 'function') _mgmtRefresh();
      if (typeof buildSectorMgmt === 'function') buildSectorMgmt();
      if (data.lastUpdated) updateDateBadge(data.lastUpdated, false);
      input.value = '';
      showToast(`복원 완료! 거래 ${rawTrades.length}건 · 계좌 ${ACCT_ORDER.length-1}개`, 'ok');
    } catch(err) {
      showToast('파일 파싱 오류: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ── 데이터 초기화 다이얼로그
function openResetDialog() {
  if ($el('resetOverlay')) {
    $el('resetOverlay').style.display = 'flex';
    return;
  }
  document.body.insertAdjacentHTML('beforeend', `
  <div id="resetOverlay"
    style="display:flex;position:fixed;inset:0;background:var(--c-black-82);z-index:9900;justify-content:center;align-items:center;padding:clamp(8px,4vw,16px)">
    <div style="background:var(--s1);border:1px solid var(--c-red-40);border-radius:14px;width:100%;max-width:440px">
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--border)">
        <h3 style="margin:0 0 4px;font-size:1rem;font-weight:700;color:var(--red-lt)">🗑 데이터 초기화</h3>
        <p class="txt-73-muted">초기화할 항목을 선택하세요. 이 작업은 되돌릴 수 없어요.</p>
      </div>
      <div style="padding:16px 22px;display:flex;flex-direction:column;gap:10px">
        <label class="list-item-row"><input type="checkbox" id="rst-trades" checked class="checkbox-red"/><div><div class="fw-600">거래 이력</div><div class="txt-muted-68">rawTrades 전체 · 보유종목(rawHoldings)도 함께 초기화</div></div></label>
        <label class="list-item-row"><input type="checkbox" id="rst-stocks" checked class="checkbox-red"/><div><div class="fw-600">종목 목록 &amp; 종목코드</div><div class="txt-muted-68">EDITABLE_PRICES · STOCK_CODE 전체</div></div></label>
        <label class="list-item-row"><input type="checkbox" id="rst-sectors" checked class="checkbox-red"/><div><div class="fw-600">섹터 색상 설정</div><div class="txt-muted-68">커스텀 섹터 색상 → 기본값으로 복원</div></div></label>
        <label class="list-item-row"><input type="checkbox" id="rst-accts" checked class="checkbox-red"/><div><div class="fw-600">계좌 목록 &amp; 색상</div><div class="txt-muted-68">ACCT_COLORS · ACCT_ORDER 전체</div></div></label>
        <label class="list-item-row"><input type="checkbox" id="rst-realestate" class="checkbox-red"/><div><div class="fw-600">부동산 &amp; 대출 데이터</div><div class="txt-muted-68">REAL_ESTATE · LOAN · LOAN_SCHEDULE · RE_VALUE_HIST</div></div></label>
        <label class="list-item-row"><input type="checkbox" id="rst-prices" class="checkbox-red"/><div><div class="fw-600">현재가 캐시</div><div class="txt-muted-68">savedPrices · savedPriceDates · lastUpdated</div></div></label>
        <div id="rst-confirm-wrap" style="display:none;margin-top:4px">
          <div style="background:var(--c-red-08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px 14px;font-size:.75rem;color:var(--red-lt);margin-bottom:10px">
            ⚠️ 선택한 데이터가 영구 삭제됩니다. 계속하려면 아래에 <b>초기화</b> 를 입력하세요.
          </div>
          <input id="rst-confirm-input" type="text" placeholder="초기화"
            style="width:100%;background:var(--s2);border:1px solid var(--c-red-40);border-radius:6px;padding:8px 12px;color:var(--text);font-size:.85rem"/>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 22px 16px;border-top:1px solid var(--border);gap:8px">
        <button onclick="$el('rst-confirm-wrap').style.display='block';$el('rst-confirm-input').focus()" class="btn-amber">다음 →</button>
        <div class="flex-gap8">
          <button onclick="$el('resetOverlay').style.display='none'" class="btn-ghost-muted">취소</button>
          <button onclick="applyReset()" class="btn-danger-lg">🗑 초기화 실행</button>
        </div>
      </div>
    </div>
  </div>`);
}

function applyReset() {
  const confirmInput = $el('rst-confirm-input');
  if (!confirmInput || confirmInput.value.trim() !== '초기화') {
    showToast('"초기화" 를 정확히 입력해야 실행됩니다.', 'warn');
    $el('rst-confirm-wrap').style.display = 'block';
    if (confirmInput) confirmInput.focus();
    return;
  }

  const keys = {
    trades:     $el('rst-trades')?.checked,
    stocks:     $el('rst-stocks')?.checked,
    sectors:    $el('rst-sectors')?.checked,
    accts:      $el('rst-accts')?.checked,
    realestate: $el('rst-realestate')?.checked,
    prices:     $el('rst-prices')?.checked,
  };

  if (keys.trades) {
    rawTrades.length = 0; rawHoldings.length = 0;
    Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
    lsRemove(TRADES_KEY); lsRemove(HOLDINGS_KEY); lsRemove(DIVDATA_KEY);
  }
  if (keys.stocks) {
    EDITABLE_PRICES.length = 0;
    Object.keys(STOCK_CODE).forEach(k => delete STOCK_CODE[k]);
    Object.keys(fundDirect).forEach(k => delete fundDirect[k]);
    lsRemove(EDITABLES_KEY); lsRemove(STOCKCODE_KEY); lsRemove(FUNDDIRECT_KEY);
  }
  if (keys.sectors) {
    lsRemove(SECTOR_COLORS_KEY);
    Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
  }
  if (keys.accts) {
    Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]);
    ACCT_ORDER.length = 0;
    lsRemove(ACCT_COLORS_KEY); lsRemove(ACCT_ORDER_KEY);
  }
  if (keys.trades && keys.stocks && keys.sectors && keys.accts && keys.realestate && keys.prices) {
    lsRemove(TAB_ORDER_KEY);
    TAB_ORDER.length = 0;
    TAB_DEFAULTS.forEach(t => TAB_ORDER.push({...t}));
  }
  if (keys.prices) {
    Object.keys(savedPrices).forEach(k => delete savedPrices[k]);
    Object.keys(savedPriceDates).forEach(k => delete savedPriceDates[k]);
    lastUpdated = null;
    lsRemove(PRICES_KEY); lsRemove(PRICE_DATES_KEY); localStorage.removeItem(LAST_UPDATED_KEY);
  }
  if (keys.realestate) {
    Object.keys(REAL_ESTATE).forEach(k => delete REAL_ESTATE[k]);
    Object.keys(LOAN).forEach(k => delete LOAN[k]);
    LOAN_SCHEDULE.length = 0; RE_VALUE_HIST.length = 0;
    lsRemove(REALESTATE_KEY); lsRemove(LOAN_KEY); lsRemove(LOAN_SCHEDULE_KEY); lsRemove(RE_VALUE_KEY);
  }

  $el('resetOverlay').style.display = 'none';

  const labels = [];
  if (keys.trades)     labels.push('거래이력');
  if (keys.stocks)     labels.push('종목목록');
  if (keys.sectors)    labels.push('섹터색상');
  if (keys.accts)      labels.push('계좌목록');
  if (keys.realestate) labels.push('부동산/대출');
  if (keys.prices)     labels.push('현재가캐시');

  recomputeRows();
  refreshAll();
  showToast('초기화 완료: ' + labels.join(', '), 'ok');
}

// ════════════════════════════════════════════════════════════════
//  renderHistoryView — 손익 그래프 (스냅샷 이력 기반)
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
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px">
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
        <div style="display:flex;gap:6px;align-items:stretch">
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
          <div style="display:flex;gap:6px">
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
          <div style="display:flex;gap:6px">
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
