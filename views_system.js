// ════════════════════════════════════════════════════════════════
//  views_system.js — 탭 시스템 · 백업/복원 · 초기화
//  의존: data.js (lsGet, lsSave, lsRemove, 각종 KEY 상수)
// ════════════════════════════════════════════════════════════════

// ── 탭 정의
const TAB_DEFAULTS = [
  {id:'acct',       label:'계좌별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'},
  {id:'sector',     label:'섹터별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>'},
  {id:'merge',      label:'종목별',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'},
  {id:'trades',     label:'거래 이력',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'},
  {id:'tradegroup', label:'종목별 거래', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>'},
  {id:'history',    label:'손익 그래프', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'},
  {id:'div',        label:'배당',       icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'},
  {id:'asset',      label:'부동산',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'},
  {id:'stocks',     label:'기초정보',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07M8.46 8.46a5 5 0 000 7.07"/></svg>'},
  {id:'gsheet',     label:'구글시트',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>'},
];

// TAB_ORDER: localStorage 복원 (새 탭이 추가돼도 안전하게 병합)
let TAB_ORDER = (function() {
  const ids = lsGet(TAB_ORDER_KEY, null);
  if (ids) {
    const ordered = ids.map(id => TAB_DEFAULTS.find(t => t.id === id)).filter(Boolean);
    TAB_DEFAULTS.forEach(t => { if (!ordered.find(o => o.id === t.id)) ordered.push(t); });
    return ordered;
  }
  return [...TAB_DEFAULTS];
})();

function saveTabOrder() {
  lsSave(TAB_ORDER_KEY, TAB_ORDER.map(t => t.id));
}

// ── 탭 순서 설정 패널
function openTabSettings() {
  renderTabSettingsBody();
  const ov = $el('tabSettingsOverlay');
  ov.style.display = 'flex';
}
function closeTabSettings() {
  $el('tabSettingsOverlay').style.display = 'none';
}
function resetTabOrder() {
  TAB_ORDER.length = 0;
  TAB_DEFAULTS.forEach(t => TAB_ORDER.push({...t}));
  saveTabOrder();
  buildTabBar();
  renderTabSettingsBody();
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
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;background:var(--s2);cursor:grab;transition:background .12s">
      <span style="font-size:.75rem;color:var(--muted);cursor:grab;user-select:none">⠿</span>
      <span style="display:flex;align-items:center;gap:8px;flex:1;font-size:.80rem"><span style="width:16px;height:16px;display:inline-flex;align-items:center">${tab.icon||''}</span>${tab.label}</span>
      <button onclick="moveTab(${i},-1)" ${isFirst?'disabled':''} class="btn-move-icon">↑</button>
      <button onclick="moveTab(${i},1)" ${isLast?'disabled':''} class="btn-move-icon">↓</button>
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

function buildTabBar() {
  const vs = $el('viewSwitcher');
  if (!vs) return;
  vs.innerHTML = '';
  TAB_ORDER.forEach(tab => {
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
      const [moved] = TAB_ORDER.splice(fi, 1);
      TAB_ORDER.splice(ti, 0, moved);
      saveTabOrder(); buildTabBar();
    });
    vs.appendChild(btn);
  });
}

// ── 데이터 백업/복원
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
      _mgmtRefresh();
      buildSectorMgmt();
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
