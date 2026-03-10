function renderSummary(){
  const total=rows.reduce((s,r)=>s+r.evalAmt,0);
  const cost=rows.reduce((s,r)=>s+r.costAmt,0);
  const pnl=total-cost, pct=cost>0?pnl/cost*100:0;
  if($el('s-total')) $el('s-total').textContent=fmt(total);
  if($el('s-total-sub')) $el('s-total-sub').textContent=fmtW(Math.round(total));
  if($el('s-cost')) $el('s-cost').textContent=fmt(cost);
  if($el('s-pnl')) $el('s-pnl').innerHTML=`<span style="color:${pColor(pnl)}">${pSign(pnl)}${fmt(pnl)}</span>`;
  if($el('s-pnl-pct')) $el('s-pnl-pct').innerHTML=`<span style="color:${pColor(pnl)}">${pSign(pnl)}${pct.toFixed(1)}%</span>`;
  const loanBal = LOAN.balance;
  const reVal = REAL_ESTATE.currentValue || 0;
  const netAsset = total + reVal - loanBal;
  if($el('s-net')) {
    if($el('s-net')){$el('s-net').textContent=fmt(netAsset);}
    if($el('s-net')){$el('s-net').className=netAsset>=0?'val c-cyan':'val c-red';}
  }
  const netSub = reVal > 0
    ? `투자 ${fmt(total)} + 부동산 ${fmt(reVal)} - 대출 ${fmt(loanBal)}`
    : `투자 ${fmt(total)} - 대출 ${fmt(loanBal)}`;
  if($el('s-net-sub')) $el('s-net-sub').textContent = netSub;

  // 부동산 카드 업데이트
  const reCard = $el('s-realestate');
  const reSub  = $el('s-realestate-sub');
  if(reCard) {
    reCard.textContent = reVal > 0 ? fmt(reVal) : '미입력';
    reCard.style.color = reVal > 0 ? 'var(--amber)' : 'var(--muted)';
  }
  if(reSub) {
    const pnl = reVal > 0 && REAL_ESTATE.purchasePrice > 0
      ? reVal - REAL_ESTATE.purchasePrice : null;
    reSub.textContent = pnl !== null
      ? `${REAL_ESTATE.name} · ${pSign(pnl)}${fmt(pnl)}`
      : REAL_ESTATE.name || '부동산 실거래가 입력 필요';
  }
  // 주담대 카드 업데이트
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

// ── 테이블 컬럼 필터 상태
// 각 테이블 인스턴스별로 상태 관리
const tableState = {};  // {tableId: {sortCol, sortDir, filters: {col: Set<val>}}}

function getTableState(tableId) {
  if (!tableState[tableId]) {
    tableState[tableId] = { sortCol: null, sortDir: 'asc', filters: {} };
  }
  return tableState[tableId];
}

// 컬럼 정의
const TABLE_COLS = [
  { key: 'sector', label: '섹터',     type: 'filter' },  // extraCol일 때만
  { key: 'acct',   label: '계좌',     type: 'filter' },
  { key: 'type',   label: '구분',     type: 'filter' },
  { key: 'name',   label: '종목명',   type: 'filter' },
  { key: 'qty',    label: '수량',     type: 'sort',   num: true },
  { key: 'cost',   label: '매수단가', type: 'sort',   num: true },
  { key: 'price',  label: '현재가',   type: 'sort',   num: true },
  { key: 'eval',   label: '평가금액', type: 'sort',   num: true },
  { key: 'pnl',    label: '손익',     type: 'sort',   num: true },
  { key: 'pct',    label: '수익률',   type: 'sort',   num: true },
];

// 현재 열린 드롭다운
let openDropdownId = null;

function closeAllDropdowns() {
  document.querySelectorAll('.col-filter-dropdown').forEach(d => d.remove());
  openDropdownId = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.th-filter') && !e.target.closest('.col-filter-dropdown')) {
    closeAllDropdowns();
  }
});

function applyTableFilter(tableId, col, checkedVals) {
  const st = getTableState(tableId);
  if (checkedVals === null || checkedVals.size === 0) {
    delete st.filters[col];
  } else {
    st.filters[col] = checkedVals;
  }
  rerenderTable(tableId);
  closeAllDropdowns();
}

function clearTableFilter(tableId, col) {
  const st = getTableState(tableId);
  delete st.filters[col];
  rerenderTable(tableId);
}

function clearAllTableFilters(tableId) {
  const st = getTableState(tableId);
  st.filters = {};
  st.sortCol = null;
  rerenderTable(tableId);
}

function setTableSort(tableId, col) {
  const st = getTableState(tableId);
  if (st.sortCol === col) {
    st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    st.sortCol = col;
    st.sortDir = col === 'pct' || col === 'pnl' || col === 'eval' ? 'desc' : 'asc';
  }
  rerenderTable(tableId);
  closeAllDropdowns();
}

// 테이블 전체 재렌더링 (state 기반)
function rerenderTable(tableId) {
  const container = $el('tc_' + tableId);
  if (!container) return;
  const rawData = window._tableData.get(tableId);
  const extraCol = window._tableExtra.get(tableId);
  if (!rawData) return;
  container.innerHTML = buildTableInner(rawData, tableId, extraCol);
}

// 전역 테이블 데이터 저장소
window._tableData = new Map();
window._tableExtra = new Map();

// SMALL POSITION FILTER
const SMALL_THRESHOLD = 100000; // 10만원

function makeSmallToggleBar(smallRows, tableId) {
  if(smallRows.length === 0) return '';
  return `<div class="small-toggle-bar" id="stb_${tableId}" onclick="toggleSmall('${tableId}')">
    <div class="st-left">
      <span>👁 소액 종목 숨김 (10만원 미만)</span>
      <span class="st-cnt">${smallRows.length}개 · ${fmt(smallRows.reduce((s,r)=>s+r.evalAmt,0))} 숨겨짐 (합산엔 포함)</span>
    </div>
    <span class="st-arrow">▼</span>
  </div>`;
}

// 소액 토글 상태 기억
const _smallOpen = {};
function toggleSmall(tableId) {
  const bar = $el('stb_' + tableId);
  const smalls = document.querySelectorAll('.small-pos-row-' + tableId);
  bar.classList.toggle('open');
  const isOpen = bar.classList.contains('open');
  _smallOpen[tableId] = isOpen;
  bar.querySelector('.st-left span:first-child').textContent = isOpen ? '👁 소액 종목 표시 중 (10만원 미만)' : '👁 소액 종목 숨김 (10만원 미만)';
  smalls.forEach(el => { el.style.display = isOpen ? '' : 'none'; });
}

// 필터 드롭다운 열기
function openColFilterDropdown(tableId, col, thEl) {
  const dropId = `cfd_${tableId}_${col}`;

  // 이미 열려 있으면 닫기
  if (openDropdownId === dropId) {
    closeAllDropdowns();
    return;
  }
  closeAllDropdowns();
  openDropdownId = dropId;

  const rawData = window._tableData.get(tableId) || [];
  const st = getTableState(tableId);
  const currentFilter = st.filters[col] || null;

  // 유니크 값 수집
  const vals = [...new Set(rawData.map(r => {
    if (col === 'acct')   return r.acct;
    if (col === 'type')   return r.type;
    if (col === 'name')   return r.name;
    if (col === 'sector') return r.sector || '기타';
    return '';
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

  let searchHtml = vals.length > 6
    ? `<input class="cfd-search" placeholder="검색..." oninput="cfdSearch(this,'${dropId}')" />`
    : '';

  const itemsHtml = vals.map(v => {
    const checked = !currentFilter || currentFilter.has(v) ? 'checked' : '';
    const dot = col === 'acct' && ACCT_COLORS[v]
      ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ACCT_COLORS[v]};flex-shrink:0"></span>` : '';
    const colorStyle = col === 'sector' && SECTOR_COLORS[v] ? `color:${SECTOR_COLORS[v]}` : '';
    return `<label data-cfd-item="${v}">
      <input type="checkbox" value="${v}" ${checked} />
      ${dot}<span style="${colorStyle}">${v}</span>
    </label>`;
  }).join('');

  const div = document.createElement('div');
  div.className = 'col-filter-dropdown';
  div.id = dropId;
  div.innerHTML = `
    ${searchHtml}
    <div class="cfd-items">${itemsHtml}</div>
    <div class="cfd-actions">
      <button class="cfd-btn" onclick="cfdToggleAll('${dropId}',true)">전체선택</button>
      <button class="cfd-btn" onclick="cfdToggleAll('${dropId}',false)">전체해제</button>
      <button class="cfd-btn apply" onclick="cfdApply('${tableId}','${col}','${dropId}')">적용</button>
    </div>
  `;

  thEl.style.position = 'relative';
  thEl.appendChild(div);
}

function cfdSearch(input, dropId) {
  const q = input.value.toLowerCase();
  const drop = $el(dropId);
  if (!drop) return;
  drop.querySelectorAll('[data-cfd-item]').forEach(label => {
    const val = label.dataset.cfdItem || '';
    label.style.display = val.toLowerCase().includes(q) ? '' : 'none';
  });
}

function cfdToggleAll(dropId, checked) {
  document.querySelectorAll(`#${dropId} input[type=checkbox]`).forEach(cb => cb.checked = checked);
}

function cfdApply(tableId, col, dropId) {
  const checked = new Set();
  document.querySelectorAll(`#${dropId} input[type=checkbox]:checked`).forEach(cb => checked.add(cb.value));
  const rawData = window._tableData.get(tableId) || [];
  const allVals = [...new Set(rawData.map(r => {
    if (col === 'acct')   return r.acct;
    if (col === 'type')   return r.type;
    if (col === 'name')   return r.name;
    if (col === 'sector') return r.sector || '기타';
    return '';
  }).filter(Boolean))];
  // 전부 체크됐으면 필터 없음으로 처리
  const allChecked = allVals.every(v => checked.has(v));
  applyTableFilter(tableId, col, allChecked ? null : checked);
}

// 필터 + 정렬 적용된 데이터 반환
function applyFiltersAndSort(rawData, tableId) {
  const st = getTableState(tableId);
  let data = [...rawData];

  // 필터 적용
  Object.entries(st.filters).forEach(([col, vals]) => {
    data = data.filter(r => {
      let v = '';
      if (col === 'acct')   v = r.acct;
      if (col === 'type')   v = r.type;
      if (col === 'name')   v = r.name;
      if (col === 'sector') v = r.sector || '기타';
      return vals.has(v);
    });
  });

  // 정렬 적용
  if (st.sortCol) {
    const dir = st.sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      let va, vb;
      if (st.sortCol === 'qty')   { va = a.qty || 0;      vb = b.qty || 0; }
      if (st.sortCol === 'cost')  { va = a.cost || 0;     vb = b.cost || 0; }
      if (st.sortCol === 'price') { va = a.price || 0;    vb = b.price || 0; }
      if (st.sortCol === 'eval')  { va = a.evalAmt || 0;  vb = b.evalAmt || 0; }
      if (st.sortCol === 'pnl')   { va = a.pnl || 0;      vb = b.pnl || 0; }
      if (st.sortCol === 'pct')   { va = a.pct || 0;      vb = b.pct || 0; }
      if (st.sortCol === 'name')  { return dir * a.name.localeCompare(b.name, 'ko'); }
      return dir * ((va || 0) - (vb || 0));
    });
  }

  return data;
}

// 활성 필터 칩 렌더링
function buildActiveFiltersBar(tableId) {
  const st = getTableState(tableId);
  const entries = Object.entries(st.filters);
  if (entries.length === 0) return '';

  const colLabels = { acct:'계좌', type:'구분', name:'종목명', sector:'섹터' };
  const chips = entries.map(([col, vals]) => {
    const label = colLabels[col] || col;
    const valStr = vals.size <= 3 ? [...vals].join(', ') : `${vals.size}개 선택`;
    return `<span class="active-filter-chip">
      ${label}: <strong>${valStr}</strong>
      <button onclick="clearTableFilter('${tableId}','${col}')">✕</button>
    </span>`;
  }).join('');

  return `<div class="active-filters-bar">
    <span class="txt-muted-68">🔍 활성 필터:</span>
    ${chips}
    <button onclick="clearAllTableFilters('${tableId}')" class="btn-link">전체 해제</button>
  </div>`;
}

// 테이블 내부 HTML 빌더 (필터/정렬 상태 반영)
function buildTableInner(rawData, tableId, extraCol) {
  const st = getTableState(tableId);
  const data = applyFiltersAndSort(rawData, tableId);

  const totalEval = data.reduce((s,r)=>s+r.evalAmt,0);
  const totalCost = data.reduce((s,r)=>s+r.costAmt,0);
  const totalPnl  = totalEval - totalCost;
  const totalPct  = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
  const pC = pColor(totalPnl), pS = pSign(totalPnl);

  const hasFilters = Object.keys(st.filters).length > 0;
  const filteredBadge = hasFilters
    ? `<span class="filter-active-badge">🔍 ${data.length}/${rawData.length}</span>` : '';

  // 컬럼 헤더 빌더
  const filterCols = ['acct','type','name'];
  if (extraCol === '섹터') filterCols.unshift('sector');
  const sortCols = ['qty','cost','price','eval','pnl','pct'];

  function thFilter(col, label) {
    const isFiltered = !!st.filters[col];
    const badge = isFiltered ? `<span class="c-amber">▼</span>` : `<span style="opacity:.35">▼</span>`;
    return `<th class="th-filter" onclick="openColFilterDropdown('${tableId}','${col}',this)">
      ${label} ${badge}
    </th>`;
  }
  function thSort(col, label, num) {
    const cls = st.sortCol === col ? ' ' + st.sortDir : '';
    return `<th class="th-filter num${cls}" onclick="setTableSort('${tableId}','${col}')">
      ${label} <span class="sort-icon"></span>
    </th>`;
  }

  const headerCols = [
    extraCol === '섹터' ? thFilter('sector','섹터') : '',
    thFilter('acct','계좌'),
    thFilter('type','구분'),
    thFilter('name','종목명'),
    thSort('qty','수량',true),
    thSort('cost','매수단가',true),
    thSort('price','현재가',true),
    thSort('eval','평가금액',true),
    thSort('pnl','손익',true),
    thSort('pct','수익률',true),
  ].join('');

  let html = `${buildActiveFiltersBar(tableId)}
  <div class="tbl-wrap">
    <div class="tbl-head">
      <h3>종목 목록 ${filteredBadge}</h3>
      <div class="tsum">평가 <b>${fmt(totalEval)}</b> &nbsp; 손익 <span style="color:${pC}">${pS}${fmt(totalPnl)} (${pS}${totalPct.toFixed(1)}%)</span></div>
    </div>
    <div class="overflow-x-auto"><table><thead><tr>${headerCols}</tr></thead><tbody>`;

  const smallRows = data.filter(r => r.evalAmt < SMALL_THRESHOLD && !r.fund);
  data.forEach(r => {
    const isSmall = r.evalAmt < SMALL_THRESHOLD && !r.fund;
    const pC2 = pColor(r.pnl), pS2 = pSign(r.pnl);
    const priceCell = r.fund
      ? `<span style='color:var(--cyan)'>${r.price.toLocaleString()}원</span>`
      : r.price ? r.price.toLocaleString()+'원' : '<span class="c-muted">-</span>';
    const qtyCell  = r.qty  != null ? r.qty.toLocaleString()  : '-';
    const costCell = r.cost != null ? r.cost.toLocaleString()+'원' : '-';
    let sectorCell = '';
    if (extraCol === '섹터') {
      sectorCell = `<td><span style="font-size:.70rem;padding:2px 8px;border-radius:4px;background:${SECTOR_COLORS[r.sector]||'var(--muted)'}22;color:${SECTOR_COLORS[r.sector]||'var(--muted)'}">${r.sector}</span></td>`;
    }
    html += `<tr class="${isSmall ? `small-pos-row small-pos-row-${tableId}" style="display:none` : ''}">
      ${sectorCell}
      <td><span class="adot" style="background:${ACCT_COLORS[r.acct]||'var(--muted)'}"></span>${r.acct}</td>
      <td><span class="tag tg-${r.type}">${r.type}</span></td>
      <td class="fw6"><span data-gname="${r.name}" onclick="goToTradeGroup(this.dataset.gname)" class="dotted-link" title="종목별 거래 보기">${r.name}</span>${r.code?`<span class="lbl-62-mt2">${r.code}</span>`:''}</td>
      <td class="num">${qtyCell}</td>
      <td class="num">${costCell}</td>
      <td class="num">${priceCell}</td>
      <td class="num">${fmtW(r.evalAmt)}</td>
      <td class="num" style="color:${pC2}">${pS2}${fmt(r.pnl)}</td>
      <td class="num" style="color:${pC2}">${pS2}${r.pct.toFixed(1)}%</td>
    </tr>`;
  });

  html += `</tbody></table></div></div>`;

  // 소액 토글
  if (smallRows.length > 0) {
    html = `${makeSmallToggleBar(smallRows, tableId)}` + html;
  }

  return html;
}



// VIEWS
let currentView='acct';
let acctFilter='전체';
let typeFilter='전체';

// 자산 비중 카드를 숨기는 탭
const TABS_NO_CHARTS = new Set(['trades','tradegroup','history','div','asset','stocks','gsheet']);

function switchView(v){
  currentView=v;
  try { buildTabBar(); renderView(); renderDonut(); } catch(e) { console.warn('뷰 전환 실패:',e); buildTabBar(); }
  const charts = $el('chartsRow');
  if (charts) charts.style.display = TABS_NO_CHARTS.has(v) ? 'none' : '';
}

// ── ETF 이름 패턴 판별 공통 함수 (renderAcctView · renderDonut 공용)
const ETF_PREFIXES = ['KODEX','TIGER','ACE','TIME','SOL','KBSTAR','HANARO','ARIRANG','PLUS','RISE'];
function isEtfByName(name) {
  return ETF_PREFIXES.some(p => name.startsWith(p));
}

function renderView(){
  const area=$el('view-area');
  if(currentView==='acct') renderAcctView(area);
  else if(currentView==='sector') renderSectorView(area);
  else if(currentView==='merge') renderMergeView(area);
  else if(currentView==='trades')  renderTradesView(area);
  else if(currentView==='tradegroup') renderTradeGroupView(area);
  else if(currentView==='history') renderHistoryView(area);
  else if(currentView==='div') renderDivView(area);
  else if(currentView==='asset') renderAssetView(area);
  else if(currentView==='stocks') renderStocksView(area);
  else if(currentView==='gsheet') renderGsheetView(area);
}

// ACCOUNT + TYPE VIEW (통합)
function renderAcctView(area){
  const accts = ACCT_ORDER.filter(a => a !== '전체');
  const acctOpts = ['전체',...accts].map(a =>
    `<button onclick="setAcctFilter('${a.replace(/'/g,"\\'")}')" class="${_fBtnClass(acctFilter===a)}">${a}</button>`).join('');

  const typeList=['전체','주식','ETF','ISA','IRP','연금','펀드','TDF'];
  const classify = r => {
    const ep = getEP(r.name);
    const epType = getEPType(ep, null);
    if (epType) return epType;
    if (r.type==='ISA'||r.type==='IRP'||r.type==='연금'||r.type==='펀드'||r.type==='TDF') return r.type;
    if (!r.fund && isEtfByName(r.name)) return 'ETF';
    return '주식';
  };
  const typeOpts = typeList.map(t =>
    `<button onclick="setTypeFilter('${t}')" class="${_fBtnClass(typeFilter===t)}">${t}</button>`).join('');

  let html = `<div class="flex-col-g8-mb12">
    <div class="flex-ac-g8-wrap">
      <span class="txt-muted-72">🏦 계좌</span>
      <div class="flex-wrap-gap4">${acctOpts}</div>
    </div>
    <div class="flex-ac-g8-wrap">
      <span class="txt-muted-72">📂 종류</span>
      <div class="flex-wrap-gap4">${typeOpts}</div>
    </div>
  </div>`;

  const enriched = rows.map(r => ({...r, classType: classify(r)}));
  let data = acctFilter === '전체' ? enriched : enriched.filter(r => r.acct === acctFilter);
  data = typeFilter === '전체' ? data : data.filter(r => r.classType === typeFilter);

  const tableId = 'tbl_acct';
  window._tableData.set(tableId, data);
  window._tableExtra.set(tableId, null);
  html += `<div id="tc_${tableId}">${buildTableInner(data, tableId, null)}</div>`;
  area.innerHTML = html;
}
function setAcctFilter(f){ acctFilter=f; renderView(); }
function setTypeFilter(f){ typeFilter=f; renderView(); }

// SECTOR VIEW
function renderSectorView(area){
  const sectors={};
  rows.forEach(r=>{
    const s=r.sector||'기타';
    if(!sectors[s]) sectors[s]={rows:[],eval:0,cost:0};
    sectors[s].rows.push(r); sectors[s].eval+=r.evalAmt; sectors[s].cost+=r.costAmt;
  });
  let html=`<div class="sector-grid">`;
  Object.entries(sectors).sort((a,b)=>b[1].eval-a[1].eval).forEach(([sec,d])=>{
    const pnl=d.eval-d.cost, pct=d.cost>0?pnl/d.cost*100:0;
    const pC=pColor(pnl), pS=pSign(pnl);
    const color=SECTOR_COLORS[sec]||'var(--muted)';
    html+=`<div class="sector-card">
      <div class="sector-hdr" style="border-left:3px solid ${color};flex-wrap:wrap;gap:6px">
        <h4 style="color:${color}">${sec} <span style="color:var(--muted);font-size:.72rem;font-weight:400">${Object.keys((() => { const m={}; d.rows.forEach(r=>m[r.name]=1); return m; })()).length}종목</span></h4>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div class="td-right">
            <div class="lbl-62-muted">평가금액</div>
            <div class="sval">${fmt(d.eval)}</div>
          </div>
          <div class="td-right">
            <div class="lbl-62-muted">손익</div>
            <div class="sval" style="color:${pC}">${pS}${fmt(pnl)}</div>
          </div>
          <div class="td-right">
            <div class="lbl-62-muted">수익률</div>
            <div class="sval" style="color:${pC};font-weight:700">${pS}${pct.toFixed(1)}%</div>
          </div>
        </div>
      </div>`;
    html+=`<div class="overflow-x-auto">
      <table style="width:100%;border-collapse:collapse;margin-top:6px">
        <thead><tr class="bd-bottom">
          <th class="txt-muted-68-left">종목명</th>
          <th class="txt-muted-68-left">계좌</th>
          <th class="txt-muted-68-right">평가금액</th>
          <th class="txt-muted-68-right">손익</th>
          <th class="txt-muted-68-right">수익률</th>
        </tr></thead>
        <tbody>`;
    // 같은 종목명 합산
    const secMerged = {};
    d.rows.forEach(r => {
      if(!secMerged[r.name]) secMerged[r.name] = {
        name:r.name, code:r.code||'', evalAmt:0, costAmt:0, pnl:0,
        accts:[], totalQty:0
      };
      const m = secMerged[r.name];
      m.evalAmt  += r.evalAmt;
      m.costAmt  += r.costAmt;
      m.pnl      += r.pnl;
      m.totalQty += (r.qty||0);
      if(!m.accts.includes(r.acct)) m.accts.push(r.acct);
    });
    const secList = Object.values(secMerged).sort((a,b)=>b.evalAmt-a.evalAmt);
    secList.forEach(m => {
      const mPct = m.costAmt > 0 ? m.pnl/m.costAmt*100 : 0;
      const rC=pColor(m.pnl), rS=pSign(m.pnl);
      const acctDots = m.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>`).join('');
      html+=`<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:7px 8px;font-size:.78rem;font-weight:600">
          ${m.name}
          ${m.code?`<span style="display:block;font-size:.65rem;color:var(--muted);margin-top:1px">${m.code}</span>`:''}
        </td>
        <td style="padding:7px 8px;font-size:.72rem">
          <div class="flex-wrap-gap6">
            ${m.accts.map(a=>`
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                <span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>
                <span class="txt-60-muted">${a}</span>
              </div>`).join('')}
          </div>
        </td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right">${fmtW(m.evalAmt)}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;color:${rC}">${rS}${fmt(m.pnl)}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;color:${rC};font-weight:700">${rS}${mPct.toFixed(1)}%</td>
      </tr>`;
    });
    html+=`</tbody></table></div></div>`;
  });
  html+=`</div>`;
  area.innerHTML=html;
}

// DONUT (섹터별)
function renderDonut(){
  const canvas = $el('donut-canvas');
  if (!canvas) return;

  // 탭에 따라 분류 기준 결정
  const TYPE_CLASSIFY = r => {
    if (r.type==='펀드'||r.type==='TDF') return '펀드/TDF';
    if (r.type==='ISA'||r.type==='IRP'||r.type==='연금') return '절세계좌';
    if (!r.fund && isEtfByName(r.name)) return 'ETF';
    return '개별주식';
  };
  const TYPE_COLORS = {'개별주식':'var(--green)','ETF':'var(--blue)','펀드/TDF':'var(--purple)','절세계좌':'var(--amber)'};
  const ACCT_PALETTE_FALLBACK = ['var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)','var(--pink)','var(--cyan)','var(--gold2)'];

  // 종목별: 상위 8개 + 나머지는 '기타'로 묶기
  const collapseToTop = (raw, n=8) => {
    const sorted = Object.entries(raw).sort((a,b)=>b[1]-a[1]);
    if (sorted.length <= n) return raw;
    const top = sorted.slice(0, n);
    const etcVal = sorted.slice(n).reduce((s,[,v])=>s+v, 0);
    const result = Object.fromEntries(top);
    if (etcVal > 0) result['기타'] = etcVal;
    return result;
  };

  let totals = {}, getColor, title;
  if (currentView === 'acct') {
    // 계좌별 탭 → 종류(개별주식/ETF/펀드/절세계좌)로 구분
    title = '종류별 자산 비중';
    rows.forEach(r => { const k = TYPE_CLASSIFY(r); totals[k] = (totals[k]||0) + r.evalAmt; });
    getColor = k => TYPE_COLORS[k] || 'var(--muted)';
  } else if (currentView === 'sector') {
    // 섹터별 탭 → 섹터로 구분
    title = '섹터별 자산 비중';
    rows.forEach(r => { const k = r.sector||'기타'; totals[k] = (totals[k]||0) + r.evalAmt; });
    getColor = k => SECTOR_COLORS[k] || 'var(--muted)';
  } else if (currentView === 'merge') {
    // 종목별 합산 탭 → 종목으로 구분 (상위 8개 + 기타)
    title = '종목별 자산 비중';
    rows.forEach(r => { const k = r.name; totals[k] = (totals[k]||0) + r.evalAmt; });
    totals = collapseToTop(totals, 8);
    const mergeKeys = Object.keys(totals);
    getColor = k => k === '기타' ? 'var(--muted)' : ACCT_PALETTE_FALLBACK[mergeKeys.indexOf(k) % ACCT_PALETTE_FALLBACK.length];
  } else {
    // 그 외 탭(거래이력·배당·부동산 등) → 섹터로 구분 (기본값)
    title = '섹터별 자산 비중';
    rows.forEach(r => { const k = r.sector||'기타'; totals[k] = (totals[k]||0) + r.evalAmt; });
    getColor = k => SECTOR_COLORS[k] || 'var(--muted)';
  }

  const leg = $el('donut-legend');  // ★ 선언을 상단으로 이동 (데이터 없을 때도 참조)

  const titleEl = $el('donut-title');
  if (titleEl) titleEl.textContent = title;

  const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,[,v])=>s+v, 0);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,120,120);

  // 데이터 없으면 빈 원만 그리고 종료
  if (!entries.length || total <= 0) {
    ctx.beginPath(); ctx.arc(60,60,52,0,2*Math.PI);
    ctx.fillStyle = resolveColor('var(--s2)'); ctx.fill();
    ctx.beginPath(); ctx.arc(60,60,28,0,2*Math.PI);
    ctx.fillStyle = resolveColor('var(--s1)'); ctx.fill();
    if (leg) leg.innerHTML = '<div class="legend-label" style="padding:8px">데이터 없음</div>';
    return;
  }

  let start = -Math.PI/2;
  entries.forEach(([k, val]) => {
    const resolvedColor = resolveColor(getColor(k)); // ★ getColor → 반드시 resolveColor 통과
    const slice = val/total*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(60,60); ctx.arc(60,60,52,start,start+slice); ctx.closePath();
    ctx.fillStyle = resolvedColor; ctx.fill(); start += slice;
  });
  ctx.beginPath(); ctx.arc(60,60,28,0,2*Math.PI);
  ctx.fillStyle = resolveColor('var(--s1)'); ctx.fill();

  if (!leg) return;
  // ★ innerHTML+= 금지 원칙 → 배열 조합 후 한 번에 할당
  leg.innerHTML = entries.map(([k, val]) => {
    const rc = resolveColor(getColor(k)); // ★ 항상 resolveColor 통과
    const pct = (val/total*100).toFixed(1);
    return `<div class="legend-item"><div class="legend-dot" style="background:${rc}"></div><div class="legend-label">${k}</div><div class="legend-val" style="color:${rc}">${pct}% · ${fmt(val)}</div></div>`;
  }).join('');
}

// TYPE BAR// MERGE VIEW
function renderMergeView(area){
  // 동일 종목명 합산
  const merged = {};
  rows.forEach(r => {
    const key = r.name;
    if (!merged[key]) {
      merged[key] = {
        name: r.name, type: r.type, sector: r.sector, code: r.code||'',
        evalAmt: 0, costAmt: 0, pnl: 0,
        accts: [], totalQty: 0, breakdown: []
      };
    }
    const m = merged[key];
    m.evalAmt  += r.evalAmt;
    m.costAmt  += r.costAmt;
    m.pnl      += r.pnl;
    m.totalQty += (r.qty || 0);
    if (!m.accts.includes(r.acct)) m.accts.push(r.acct);
    m.breakdown.push(r);
  });

  const list = Object.values(merged).map(m => ({
    ...m,
    pct: m.costAmt > 0 ? m.pnl / m.costAmt * 100 : 0
  }));

  // sort options
  const sortOpts = [{k:'eval',l:'평가금액순'},{k:'pct',l:'수익률순'},{k:'pnl',l:'손익순'},{k:'name',l:'이름순'}];
  const sortLabel = sortOpts.find(o=>o.k===mergeSortKey)?.l || '평가금액순';

  const sorted = [...list].sort((a,b)=>{
    if(mergeSortKey==='eval') return b.evalAmt - a.evalAmt;
    if(mergeSortKey==='pct')  return b.pct - a.pct;
    if(mergeSortKey==='pnl')  return b.pnl - a.pnl;
    if(mergeSortKey==='name') return a.name.localeCompare(b.name,'ko');
    return 0;
  });

  const grandEval = sorted.reduce((s,r)=>s+r.evalAmt,0);
  const grandCost = sorted.reduce((s,r)=>s+r.costAmt,0);
  const grandPnl  = grandEval - grandCost;
  const grandPct  = grandCost > 0 ? grandPnl/grandCost*100 : 0;
  const gC = pColor(grandPnl), gS = pSign(grandPnl);

  // 컬럼 헤더 정렬 아이콘 헬퍼
  const thSort = (key, label, isNum=false) => {
    const active = mergeSortKey === key;
    const icon = active ? (key==='name' ? ' ▲' : ' ▼') : '';
    return `<th class="${isNum?'num':''}" style="cursor:pointer;user-select:none;${active?'color:var(--amber)':''}"
      onclick="setMergeSortKey('${key}')">${label}${icon}</th>`;
  };

  let html = `<div class="tbl-wrap">
    <div class="tbl-head">
      <h3>🔀 종목별 합산 <span style="color:var(--muted);font-size:.75rem;font-weight:400">(${sorted.length}개 종목)</span>
        <span style="font-size:.70rem;color:var(--amber);margin-left:8px;font-weight:400">▸ ${sortLabel}</span>
      </h3>
      <div class="tsum">평가 <b>${fmt(grandEval)}</b> &nbsp; 손익 <span style="color:${gC}">${gS}${fmt(grandPnl)} (${gS}${grandPct.toFixed(1)}%)</span></div>
    </div>
    <div class="overflow-x-auto"><table><thead><tr>
      ${thSort('name','종목명')}
      <th>구분</th><th>보유 계좌</th><th class="num">총 수량</th>
      ${thSort('eval','총 평가금액',true)}
      <th class="num">총 원금</th>
      ${thSort('pnl','합산 손익',true)}
      ${thSort('pct','수익률',true)}
      <th class="num">비중</th>
    </tr></thead><tbody>`;

  sorted.forEach((m,idx) => {
    const pC = pColor(m.pnl), pS = pSign(m.pnl);
    const weight = grandEval > 0 ? (m.evalAmt/grandEval*100).toFixed(1) : '0.0';
    const acctDots = m.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>`).join('');
    const acctNames = m.accts.join(' · ');
    const rowId = 'merge-row-'+idx;
    const detailId = 'merge-detail-'+idx;
    const isMulti = m.breakdown.length > 1;

    html += `<tr style="cursor:${isMulti?'pointer':'default'}" onclick="${isMulti?`toggleMergeDetail('${detailId}')`:''}" title="${isMulti?'클릭하면 계좌별 상세 보기':''}">
      <td class="fw6"><span data-gname="${m.name}" onclick="event.stopPropagation();goToTradeGroup(this.dataset.gname)" class="dotted-link" title="종목별 거래 보기">${m.name}</span>${isMulti?` <span style="font-size:.65rem;color:var(--pink);margin-left:4px">▸ ${m.breakdown.length}계좌</span>`:''}${m.code?`<span class="lbl-62-mt2">${m.code}</span>`:''}</td>
      <td><span class="tag tg-${m.type}">${m.type}</span></td>
      <td>${acctDots} <span class="txt-muted-72">${acctNames}</span></td>
      <td class="num">${m.totalQty > 0 ? m.totalQty.toLocaleString() : '-'}</td>
      <td class="num">${fmtW(m.evalAmt)}</td>
      <td class="num">${fmtW(m.costAmt)}</td>
      <td class="num" style="color:${pC}">${pS}${fmt(m.pnl)}</td>
      <td class="num" style="color:${pC}">${pS}${m.pct.toFixed(1)}%</td>
      <td>
        <div class="flex-center-gap8">
          <span class="mono" style="font-size:.85rem;font-weight:600;color:var(--pink);min-width:42px">${weight}%</span>
          <div style="width:50px;height:4px;background:var(--s2);border-radius:3px;flex-shrink:0">
            <div style="width:${Math.min(parseFloat(weight),100)}%;height:100%;background:var(--pink);border-radius:3px"></div>
          </div>
        </div>
      </td>
    </tr>`;

    // breakdown rows (hidden by default)
    if (isMulti) {
      html += `<tr id="${detailId}" class="d-none"><td colspan="9" style="padding:0">
        <table style="width:100%;background:var(--s2)"><thead><tr>
          <th class="p-8-14">계좌</th><th class="num">수량</th><th class="num">매수단가</th><th class="num">현재가</th><th class="num">평가금액</th><th class="num">손익</th><th class="num">수익률</th>
        </tr></thead><tbody>`;
      m.breakdown.forEach(r => {
        const rC = pColor(r.pnl), rS = pSign(r.pnl);
        const priceCell = r.fund ? `<span class="c-cyan">${r.price.toLocaleString()}원</span>` : r.price ? r.price.toLocaleString()+'원' : '-';
        html += `<tr style="border-top:1px solid var(--border)">
          <td class="p-8-14"><span class="adot" style="background:${ACCT_COLORS[r.acct]}"></span>${r.acct}</td>
          <td class="mono">${r.qty!=null?r.qty.toLocaleString():'-'}</td>
          <td class="mono">${r.cost!=null?r.cost.toLocaleString()+'원':'-'}</td>
          <td class="mono">${priceCell}</td>
          <td class="mono">${fmtW(r.evalAmt)}</td>
          <td class="mono" style="color:${rC}">${rS}${fmt(r.pnl)}</td>
          <td class="mono" style="color:${rC}">${rS}${r.pct.toFixed(1)}%</td>
        </tr>`;
      });
      html += `</tbody></table></td></tr>`;
    }
  });

  html += `</tbody></table></div></div>`;
  area.innerHTML = html;
}

function toggleMergeDetail(id){
  const el = $el(id);
  if(el) el.style.display = el.style.display==='none' ? 'table-row' : 'none';
}

let mergeSortKey = 'eval';
function setMergeSortKey(k){
  mergeSortKey = k;
  renderView();
}

// DIVIDEND DATA & VIEW
// 배당 데이터: {name, perShare(주당배당금), freq(월배당/분기/반기/연간), months(지급월 배열), note}
// 출처: 공시 및 검색 수집 (추정값 포함, ★ = 확정공시)
let DIVDATA = {
  // 월배당 ETF
  'ACE 미국배당퀄리티':       {perShare:65,  freq:'월배당', months:[1,2,3,4,5,6,7,8,9,10,11,12], note:'매월 15일 내외 지급, 25년 평균 ~65원'},
  'TIMEFOLIO Korea플러스배당액티브':{perShare:120, freq:'월배당', months:[1,2,3,4,5,6,7,8,9,10,11,12], note:'매월 중순 지급, 추정'},
  'TIGER 미국배당다우존스':   {perShare:55,  freq:'월배당', months:[1,2,3,4,5,6,7,8,9,10,11,12], note:'매월 15일 내외, 배당률 약 3.19%'},
  // 분기배당 주식/ETF
  '삼성전자':   {perShare:365, freq:'분기', months:[5,8,11], note:'★ 26년 1Q 365원(5월20일), 2Q 367원(8월20일), 3Q 365원(11월20일) / 4Q(25년결산) 566원→4월지급'},
  'SK하이닉스': {perShare:375, freq:'분기', months:[4,7,10], note:'★ 25년 결산 1305원(4월25일), 이후 분기 375원 / 26년 2Q 예상(7월)'},
  // 연배당 주식
  'SK텔레콤':      {perShare:1050, freq:'연간', months:[4], note:'★ 25년 결산 1050원, 기준일 2월28일, 4월 지급'},
  '우리금융지주':  {perShare:660,  freq:'연간', months:[4], note:'★ 25년 결산 660원, 기준일 2월28일, 4월 지급'},
  '기업은행':      {perShare:590,  freq:'연간', months:[4], note:'25년 결산 추정 590원, 4월 지급'},
  'SK':            {perShare:5500, freq:'반기', months:[5,11], note:'★ 24년 기말 5500원(4월1일 기준), 중간배당 포함 반기'},
  'LG디스플레이':  {perShare:0,    freq:'-',   months:[], note:'25년 적자로 무배당'},
  '파라다이스':    {perShare:400,  freq:'연간', months:[4], note:'25년 결산 추정 400원, 4월 지급'},
  'GKL':           {perShare:600,  freq:'연간', months:[4], note:'25년 결산 추정 600원, 4월 지급'},
  'SK스퀘어':      {perShare:0,    freq:'-',   months:[], note:'배당 없음'},
  '카카오페이':    {perShare:0,    freq:'-',   months:[], note:'배당 없음'},
  // ETF (연/반기 분배)
  'KODEX 은행':         {perShare:200, freq:'분기', months:[4,7,10,1], note:'분기배당 ETF, 분기당 약 200원 추정'},
  'KODEX 반도체':       {perShare:0,   freq:'-',   months:[], note:'성장형 ETF, 배당 없음'},
  'KODEX 자동차':       {perShare:150, freq:'연간', months:[1], note:'연간 분배, 약 150원 추정'},
  'KODEX 200 건설':     {perShare:50,  freq:'연간', months:[1], note:'연간 분배, 약 50원 추정'},
  'TIGER 증권':         {perShare:80,  freq:'연간', months:[1], note:'연간 분배, 약 80원 추정'},
  'TIGER 화장품':       {perShare:40,  freq:'연간', months:[1], note:'연간 분배, 약 40원 추정'},
  'TIGER 지주회사':     {perShare:100, freq:'연간', months:[1], note:'연간 분배, 약 100원 추정'},
  'TIGER 코스닥 150':   {perShare:0,   freq:'-',   months:[], note:'배당 없음'},
  'TIGER 코리아TOP10':  {perShare:60,  freq:'연간', months:[1], note:'연간 분배 추정'},
  'KODEX 2차전지':      {perShare:0,   freq:'-',   months:[], note:'성장형, 배당 없음'},
  'KODEX 방산TOP10':    {perShare:30,  freq:'연간', months:[1], note:'연간 분배 추정'},
  'KODEX AI전력핵심설비':{perShare:0,  freq:'-',   months:[], note:'성장형, 배당 없음'},
  'KODEX 미국나스닥100':{perShare:0,   freq:'-',   months:[], note:'성장형, 배당 없음'},
  'KODEX 미국나스닥 100':{perShare:0,  freq:'-',   months:[], note:'성장형, 배당 없음'},
  'TIGER 미국나스닥100':{perShare:0,   freq:'-',   months:[], note:'성장형, 배당 없음'},
  'SOL 조선TOP3플러스': {perShare:50,  freq:'연간', months:[1], note:'연간 분배 추정'},
  'KODEX 증권':         {perShare:60,  freq:'연간', months:[1], note:'연간 분배 추정'},
  'HD현대중공업':       {perShare:2000,freq:'연간', months:[4], note:'25년 결산 추정 2000원, 4월 지급'},
  'SK아이이테크놀로지': {perShare:0,   freq:'-',   months:[], note:'배당 없음'},
};

const MONTHS_KR = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const NOW_MONTH = new Date().getMonth() + 1; // 현재 월 동적 계산

function calcDividends() {
  // holdings 기반으로 배당금 계산 (중복 종목은 합산)
  const merged = {};
  rawHoldings.forEach(h => {
    if (h.fund) return; // 펀드/TDF는 배당 제외
    const dd = DIVDATA[h.name];
    if (!dd || dd.perShare === 0) return;
    const _ep = getEP(h.name);
    const _type = getEPType(_ep, h.type);
    if (!merged[h.name]) merged[h.name] = {name:h.name, type:_type, totalQty:0, dd, accts:[]};
    merged[h.name].totalQty += (h.qty||0);
    if (!merged[h.name].accts.includes(h.acct)) merged[h.name].accts.push(h.acct);
  });
  return Object.values(merged).map(m => ({
    ...m,
    annualDiv: m.dd.perShare * m.totalQty * m.dd.months.length,
    monthlyDiv: m.dd.months.length > 0 ? (m.dd.perShare * m.totalQty * m.dd.months.length) / 12 : 0,
  }));
}

//  📈 손익 그래프 뷰
let _historyRange   = '3m';
let _historyCustom  = false;
let _historyFromDate = '';
let _historyToDate   = '';

function renderHistoryView(area) {
  const hasGsheet = !!GSHEET_API_URL;

  // ── 오늘 스냅샷 저장 (연동 시 자동)
  if (hasGsheet) scheduleSnapshotSave();

  area.innerHTML = `
  <div class="tbl-wrap">
    <!-- 헤더 -->
    <div class="tbl-head">
      <div>
        <h3 class="h3-section">📈 손익 변동 그래프</h3>
        <p class="mt-3-muted-72">구글 시트 스냅샷 기반 · 날짜별 평가금액·손익 추이</p>
      </div>
      <div class="flex-gap6-wrap">
        ${['1m','3m','6m','1y','전체'].map(r =>
          `<button onclick="setHistoryRange('${r}')" id="hr_${r}"
            class="btn-trade-type${_historyRange===r&&!_historyCustom?' active':''}">${r}</button>`
        ).join('')}
        <span style="display:flex;align-items:center;gap:4px">
          <input type="date" id="historyFrom" value="${_historyFromDate}"
            onchange="_historyFromDate=this.value;_historyCustom=true;loadHistoryChart()"
            style="background:var(--s2);border:1px solid ${_historyCustom?'var(--amber)':'var(--border)'};border-radius:6px;padding:3px 8px;color:var(--text);font-size:.70rem"/>
          <span class="c-muted txt-muted-72">~</span>
          <input type="date" id="historyTo" value="${_historyToDate}"
            onchange="_historyToDate=this.value;_historyCustom=true;loadHistoryChart()"
            style="background:var(--s2);border:1px solid ${_historyCustom?'var(--amber)':'var(--border)'};border-radius:6px;padding:3px 8px;color:var(--text);font-size:.70rem"/>
        </span>
        <button onclick="saveSnapshotNow()" class="btn-add-green">💾 오늘 저장</button>
      </div>
    </div>

    <div style="padding:16px 20px">
    ${!hasGsheet ? `
    <div style="background:var(--c-amber-08);border:1px solid var(--c-amber-20);border-radius:10px;padding:20px;text-align:center">
      <div style="font-size:1.5rem;margin-bottom:8px">🔗</div>
      <div style="font-weight:700;color:var(--gold);margin-bottom:4px">구글 시트 연동 필요</div>
      <div class="txt-muted-75">현재가 편집 → 구글 시트 탭에서 URL을 입력하면 스냅샷이 자동 저장돼요</div>
    </div>` : `
    <div id="historyChartWrap">
      <div style="text-align:center;padding:40px;color:var(--muted);font-size:.85rem" id="historyLoading">
        ⏳ 그래프 불러오는 중...
      </div>
    </div>`}
    </div>
  </div>`;

  if (hasGsheet) loadHistoryChart();
}

function setHistoryRange(r) {
  _historyRange   = r;
  _historyCustom  = false;
  _historyFromDate = '';
  _historyToDate   = '';
  // 39회차: renderView() 전체 재렌더 대신 버튼 active 상태만 갱신 후 차트 재로드
  ['1m','3m','6m','1y','전체'].forEach(k => {
    const b = $el('hr_' + k);
    if (b) { b.classList.toggle('active', k === r); }
  });
  // 커스텀 날짜 입력 테두리도 초기화
  ['historyFrom','historyTo'].forEach(id => {
    const el = $el(id);
    if (el) { el.value = ''; el.style.borderColor = 'var(--border)'; }
  });
  loadHistoryChart();
}

// 오늘 스냅샷을 구글시트에 저장
async function saveSnapshotNow() {
  if (!GSHEET_API_URL) { showToast('구글 시트 연동이 필요해요', 'warn'); return; }
  const btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ 저장 중...';
  try {
    await _doSaveSnapshot();
    btn.textContent = '✅ 저장됨';
    setTimeout(() => { btn.disabled = false; btn.textContent = '💾 오늘 저장'; }, 2000);
  } catch(e) {
    btn.textContent = '❌ 실패'; btn.disabled = false;
    console.error('스냅샷 저장 실패:', e);
  }
}

let _snapshotScheduled = false;
function scheduleSnapshotSave() {
  if (_snapshotScheduled) return;
  _snapshotScheduled = true;
  // 페이지 로드 후 3초 뒤 자동 저장 (가격 로드 완료 후)
  setTimeout(() => _doSaveSnapshot().catch(()=>{}), 3000);
}

async function _doSaveSnapshot() {
  if (!GSHEET_API_URL || !rows || rows.length === 0) return;
  const today = getDateStr(0);
  const snapData = rows
    .filter(r => !r.fund)
    .map(r => ({
      code:    r.code || STOCK_CODE[r.name] || '',
      name:    r.name,
      qty:     r.qty  || 0,
      costAmt: r.costAmt || 0,
      evalAmt: r.evalAmt || 0,
      pnl:     r.pnl    || 0,
      pct:     r.pct    || 0,
    }));
  if (snapData.length === 0) return;
  try {
    const body = 'action=saveSnapshot&date=' + encodeURIComponent(today)
               + '&data=' + encodeURIComponent(JSON.stringify(snapData));
    const res = await fetchWithTimeout(GSHEET_API_URL, 30000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || '저장 실패');
    return json;
  } catch (e) {
    console.warn('_doSaveSnapshot 실패:', e.message);
    throw e;  // caller(saveSnapshotNow / scheduleSnapshotSave)에서 처리
  }
}

async function loadHistoryChart() {
  const wrap = $el('historyChartWrap');
  if (!wrap) return;

  // 기간 계산 (커스텀 날짜 우선)
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  let fromStr, toStr;
  if (_historyCustom && _historyFromDate) {
    fromStr = _historyFromDate;
    toStr   = _historyToDate || fmt(new Date());
  } else {
    const toDate   = new Date();
    const fromDate = new Date();
    if      (_historyRange === '1m') fromDate.setMonth(fromDate.getMonth()-1);
    else if (_historyRange === '3m') fromDate.setMonth(fromDate.getMonth()-3);
    else if (_historyRange === '6m') fromDate.setMonth(fromDate.getMonth()-6);
    else if (_historyRange === '1y') fromDate.setFullYear(fromDate.getFullYear()-1);
    else fromDate.setFullYear(2000);
    fromStr = fmt(fromDate);
    toStr   = fmt(toDate);
  }

  try {
    const url = GSHEET_API_URL + '?action=getHistory&from=' + fromStr + '&to=' + toStr;
    const res  = await fetchWithTimeout(url, 20000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);
    const history = json.history || [];
    renderHistoryChart(wrap, history);
  } catch(e) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">❌ 불러오기 실패: ${e.message}</div>`;
  }
}

function renderHistoryChart(wrap, history) {
  if (!history || history.length === 0) {
    wrap.innerHTML = `
      <div class="info-box-blue-lg">
        <div class="emoji-lg">📊</div>
        <div class="txt-blue-700">아직 데이터가 없어요</div>
        <div class="txt-muted-75">💾 오늘 저장 버튼을 눌러 첫 번째 스냅샷을 저장하세요<br>이후 매일 자동으로 저장돼요</div>
      </div>`;
    return;
  }

  const labels = history.map(d => d.date.slice(5));
  const evals  = history.map(d => d.evalAmt);
  const costs  = history.map(d => d.costAmt);
  const pnls   = history.map(d => d.pnl);
  const pcts   = history.map(d => d.pct);
  const n      = evals.length;

  const latestPnl = pnls[n-1] || 0, latestPct = pcts[n-1] || 0;
  const maxPnl = Math.max(...pnls), minPnl = Math.min(...pnls);
  const pC = latestPnl >= 0 ? 'var(--green)' : 'var(--red)';
  const pS = latestPnl >= 0 ? '+' : '';

  function yLbl(v) {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    return a >= 1e8 ? s+(a/1e8).toFixed(1)+'억' : a >= 1e4 ? s+Math.round(a/1e4)+'만' : s+a.toLocaleString();
  }

  // 평가금액 그래프
  const W = 800, H = 260, PL = 72, PR = 20, PT = 20, PB = 36;
  const gW = W-PL-PR, gH = H-PT-PB;
  const eMin = Math.min(...evals)*0.995, eMax = Math.max(...evals)*1.005;
  const toX  = i  => PL + (n<=1 ? gW/2 : i/(n-1)*gW);
  const toY  = v  => PT + (1-(v-eMin)/(eMax-eMin||1))*gH;
  const pts  = arr => arr.map((v,i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const xStep = Math.max(1, Math.floor(n/5));
  const xLbls = labels.map((l,i) => (i%xStep&&i!==n-1)?'' :
    `<text x="${toX(i).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="10" fill="var(--muted)">${l}</text>`).join('');
  const yLbls = Array.from({length:5},(_,i)=>eMin+(eMax-eMin)*i/4).map(v =>
    `<text x="${PL-6}" y="${(toY(v)+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${yLbl(v)}</text>` +
    `<line x1="${PL}" y1="${toY(v).toFixed(1)}" x2="${PL+gW}" y2="${toY(v).toFixed(1)}" stroke="var(--s1)" stroke-width="1"/>`).join('');
  const evalPts = pts(evals), costPts = pts(costs);

  // 손익 그래프
  const H2 = 120, PL2 = 72, PT2 = 10, PB2 = 28;
  const gH2 = H2-PT2-PB2;
  const pMax = Math.max(Math.abs(maxPnl), Math.abs(minPnl))*1.05 || 1;
  const toY2  = v  => PT2 + (1-(v+pMax)/(2*pMax))*gH2;
  const zero2 = toY2(0);
  const barW  = Math.max(2, Math.min(12, gW/n-2));
  const xLbls2 = labels.map((l,i) => (i%xStep&&i!==n-1)?'' :
    `<text x="${toX(i).toFixed(1)}" y="${H2-4}" text-anchor="middle" font-size="10" fill="var(--muted)">${l}</text>`).join('');
  const pnlYLbls = [pMax, pMax/2, 0, -pMax/2, -pMax].map(v =>
    `<text x="${PL2-6}" y="${(toY2(v)+4).toFixed(1)}" text-anchor="end" font-size="10" fill="${v>0?'var(--green)':v<0?'var(--red)':'var(--muted)'}">${yLbl(v)}</text>` +
    `<line x1="${PL2}" y1="${toY2(v).toFixed(1)}" x2="${PL2+gW}" y2="${toY2(v).toFixed(1)}" stroke="${v===0?'var(--muted)':'var(--s1)'}" stroke-width="${v===0?1.5:1}"/>`).join('');
  const bars = pnls.map((v,i) => {
    const x = toX(i)-barW/2, y = v>=0?toY2(v):zero2, h = Math.max(1,Math.abs(toY2(v)-zero2));
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${v>=0?'var(--green)':'var(--red)'}" opacity=".7" rx="1"/>`;
  }).join('');

  wrap.innerHTML = `
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <div class="stat-card"><div class="label-muted-68">최근 평가금액</div><div style="font-size:1rem;font-weight:700">${yLbl(evals[n-1]||0)}</div></div>
    <div class="stat-card"><div class="label-muted-68">최근 손익</div><div style="font-size:1rem;font-weight:700;color:${pC}">${pS}${yLbl(latestPnl)}</div></div>
    <div class="stat-card"><div class="label-muted-68">최근 수익률</div><div style="font-size:1rem;font-weight:700;color:${pC}">${pS}${latestPct.toFixed(2)}%</div></div>
    <div class="stat-card"><div class="label-muted-68">기간 최대 손익</div><div style="font-size:1rem;font-weight:700;color:var(--green)">+${yLbl(maxPnl)}</div></div>
    <div class="stat-card"><div class="label-muted-68">기간 최저 손익</div><div style="font-size:1rem;font-weight:700;color:var(--red)">${yLbl(minPnl)}</div></div>
  </div>
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;overflow-x:auto">
    <div class="lbl-75-700-muted">📊 평가금액 추이</div>
    <svg viewBox="0 0 ${W} ${H}" class="img-full">
      ${yLbls}${xLbls}
      <polyline points="${costPts}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <defs><linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--amber)" stop-opacity=".25"/>
        <stop offset="100%" stop-color="var(--amber)" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${evalPts} ${PL+gW},${PT+gH} ${PL},${PT+gH}" fill="url(#evalGrad)"/>
      <polyline points="${evalPts}" fill="none" stroke="var(--amber)" stroke-width="2.5"/>
      <line x1="${PL}" y1="${H-2}" x2="${PL+60}" y2="${H-2}" stroke="var(--amber)" stroke-width="2.5"/>
      <text x="${PL+64}" y="${H+2}" font-size="10" fill="var(--amber)">평가금액</text>
      <line x1="${PL+130}" y1="${H-2}" x2="${PL+190}" y2="${H-2}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="${PL+194}" y="${H+2}" font-size="10" fill="var(--muted)">매수원금</text>
    </svg>
  </div>
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:16px;overflow-x:auto">
    <div class="lbl-75-700-muted">📉 손익 추이</div>
    <svg viewBox="0 0 ${W} ${H2}" class="img-full">${pnlYLbls}${xLbls2}${bars}</svg>
  </div>
  <div style="text-align:right;margin-top:8px;font-size:.70rem;color:var(--muted)">📅 ${history.length}개 스냅샷 · ${history[0]?.date} ~ ${history[n-1]?.date}</div>`;
}

//  📋 거래 이력 뷰  +  일괄 입력 팝업
function renderStocksView(area) {
  area.innerHTML = `
  <div class="p-0-4">

    <!-- 헤더 -->
    <div class="mb-16">
      <h3 class="h3-section">⚙️ 기초정보 관리</h3>
      <p class="mt-3-muted-72">항목을 클릭해 수정·삭제, ➕ 버튼으로 추가</p>
    </div>

    <!-- ══ 계좌 관리 섹션 ══ -->
    <div class="card-12-mb16">
      <div class="flex-between-mb10-gap8">
        <div class="txt-78-700">🏦 계좌 관리</div>
        <button onclick="acctMgmtAddNew()" class="btn-add-green">
          ➕ 계좌 추가
        </button>
      </div>

      <!-- 새 계좌 입력창 (숨김) -->
      <div id="acctMgmtNewWrap" style="display:none;background:var(--c-purple-06);border:1px dashed var(--c-purple-40);border-radius:8px;padding:10px;margin-bottom:10px">
        <div class="lbl-68-purple">➕ 새 계좌 추가</div>
        <div class="flex-gap6-wrap" style="margin-bottom:8px">
          <input id="acctMgmtNewInput" type="text" placeholder="계좌명 (예: 키움, 미래에셋)"
            style="flex:1;min-width:140px;background:var(--s2);border:1px solid rgba(139,92,246,.5);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.78rem"
            onkeydown="if(event.key==='Enter')acctMgmtConfirm(); if(event.key==='Escape')acctMgmtCancel();"/>
        </div>
        <div class="txt-65-muted-mb5">색상 선택 <span id="acctNewColorPreview" style="display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;margin-left:4px"></span></div>
        <div id="acctNewColorDots" class="flex-wrap-g5-mb8"></div>
        <input type="hidden" id="acctMgmtNewColor" value=""/>
        <div class="flex-gap6">
          <button onclick="acctMgmtConfirm()" class="btn-purple-700">✅ 추가</button>
          <button onclick="acctMgmtCancel()" class="btn-ghost-sm">✕ 취소</button>
        </div>
      </div>

      <!-- 계좌 관리 메시지 (숨김 영역 밖으로 이동) -->
      <div id="acctMgmtMsg" class="hidden-hint"></div>

      <!-- 계좌 목록 -->
      <div id="acctMgmtList"></div>
    </div>

    <!-- ══ 종목 관리 섹션 ══ -->
    <div class="card-12-mb16">
      <div class="flex-between-mb10-gap8">
        <div class="txt-78-700">📋 종목 관리</div>
        <div class="flex-center-gap8">
          <span id="holdingsSavedBadge" class="saved-badge">💾 저장됨</span>
          <button onclick="smCsvDownloadTemplate()" class="btn-outline-sm" title="CSV 양식 다운로드">📥 양식</button>
          <label class="btn-outline-sm" style="cursor:pointer;margin:0" title="CSV 파일로 종목 일괄 등록">
            📂 CSV 업로드
            <input type="file" id="smCsvFileInput" accept=".csv,.xlsx,.xls" style="display:none" onchange="smCsvImport(this)"/>
          </label>
          <button onclick="smMgmtAddNew()" class="btn-add-purple">
            ➕ 종목 추가
          </button>
        </div>
      </div>

      <!-- 새 종목 입력창 (숨김) -->
      <div id="smMgmtNewWrap" style="display:none;background:rgba(167,139,250,.06);border:1px dashed var(--c-purple2-40);border-radius:8px;padding:12px;margin-bottom:10px">
        <div class="lbl-68-purple" style="margin-bottom:8px">➕ 새 종목 추가</div>
        <input type="hidden" id="smMgmtNewType" value="주식"/>
        <input type="hidden" id="smMgmtNewSec" value="기타"/>
        <!-- 1행: 종목명 + 코드 -->
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input id="smMgmtNewName" type="text" placeholder="종목명"
            style="flex:1;background:var(--s2);border:1px solid var(--c-purple2-50);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem"
            onkeydown="if(event.key==='Enter')smMgmtConfirm(); if(event.key==='Escape')smMgmtCancel();"/>
          <input id="smMgmtNewCode" type="text" placeholder="코드" maxlength="6"
            style="width:72px;background:var(--s2);border:1px solid var(--c-purple2-50);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem;font-family:'Courier New',monospace;text-align:center"
            onkeydown="if(event.key==='Enter')smMgmtConfirm(); if(event.key==='Escape')smMgmtCancel();"/>
        </div>
        <!-- 2행: 유형 버튼 -->
        <div class="lbl-63-muted-4">유형</div>
        <div id="smTypeGroup" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div>
        <!-- 3행: 섹터 버튼 -->
        <div class="lbl-63-muted-4">섹터</div>
        <div id="smSecGroup" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px"></div>
        <!-- 4행: 추가/취소 -->
        <div style="display:flex;gap:6px">
          <button onclick="smMgmtConfirm()" class="btn-purple-700">✅ 추가</button>
          <button onclick="smMgmtCancel()" class="btn-ghost-sm">✕ 취소</button>
        </div>
      </div>

      <!-- 종목 관리 메시지 (숨김 영역 밖으로 이동) -->
      <div id="smMgmtMsg" class="hidden-hint"></div>

      <div id="stockMgmtSort"></div>
      <div id="stockMgmtBody" style="max-height:380px;overflow-y:auto"></div>
    </div>

    <!-- ══ 섹터 관리 섹션 ══ -->
    <div class="card-12">
      <div class="flex-between-mb10-gap8">
        <div class="txt-78-700">🏷 섹터 관리</div>
        <button onclick="secMgmtAddNew()" class="btn-add-cyan">
          ➕ 섹터 추가
        </button>
      </div>

      <!-- 새 섹터 입력창 (숨김) -->
      <div id="secMgmtNewWrap" style="display:none;background:rgba(6,182,212,.05);border:1px dashed var(--c-cyan-40);border-radius:8px;padding:10px;margin-bottom:10px">
        <div style="font-size:.70rem;color:var(--cyan);font-weight:700;margin-bottom:7px">➕ 새 섹터 추가</div>
        <div class="flex-gap6-wrap">
          <input id="secMgmtNewName" type="text" placeholder="섹터명"
            style="flex:1;min-width:120px;background:var(--s2);border:1px solid var(--c-cyan-50);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.75rem"
            onkeydown="if(event.key==='Enter')secMgmtConfirm(); if(event.key==='Escape')secMgmtCancel();"/>
          <input id="secMgmtNewColor" type="color" value="var(--muted)"
            style="width:40px;height:34px;border:1px solid var(--c-cyan-40);border-radius:6px;padding:2px;background:var(--s2);cursor:pointer"/>
          <button onclick="secMgmtConfirm()"
            class="btn-purple-700">✅ 추가</button>
          <button onclick="secMgmtCancel()"
            class="btn-ghost-sm">✕ 취소</button>
        </div>
      </div>

      <!-- 섹터 관리 메시지 (숨김 영역 밖으로 이동) -->
      <div id="secMgmtMsg" class="hidden-hint"></div>

      <div id="sectorMgmtBody" style="max-height:320px;overflow-y:auto"></div>
    </div>

  </div>`;
  buildStockMgmt();
  buildAcctMgmt();
  buildSectorMgmt();
}

// ── 구글시트 연동 뷰
function renderGsheetView(area) {
  const connected = !!GSHEET_API_URL;
  // 코드 없는 종목 목록 (NAV 입력 대상)
  const noCodeItems = EDITABLE_PRICES.filter(i => !i.code);
  area.innerHTML = `
  <div style="padding:0 4px;max-width:680px">
    <div class="mb-16">
      <h3 class="h3-1rem-mb4">🔗 구글시트 연동</h3>
      <p style="margin:0;font-size:.72rem;color:var(--muted)">Apps Script 웹앱 URL 등록 · 종가 자동 조회 설정</p>
    </div>

    <!-- 연결 상태 -->
    <div style="background:${connected?'rgba(34,197,94,.07)':'rgba(100,116,139,.07)'};border:1px solid ${connected?'var(--c-green2-25)':'var(--border)'};border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <div style="font-size:1.4rem">${connected?'✅':'⚪'}</div>
      <div>
        <div style="font-size:.75rem;font-weight:700;color:${connected?'var(--green-lt)':'var(--muted)'}">${connected?'구글시트 연동됨':'구글시트 미연동'}</div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:2px;word-break:break-all">${connected?GSHEET_API_URL:'URL을 아래에 입력하세요'}</div>
      </div>
    </div>

    <!-- URL 입력 -->
    <div class="card-12-mb16">
      <div style="font-size:.75rem;font-weight:700;color:var(--green-lt);margin-bottom:10px">🔗 웹앱 URL 설정</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input type="url" id="gsheetUrlInput" placeholder="https://script.google.com/macros/s/.../exec"
          value="${GSHEET_API_URL}"
          style="flex:1;min-width:220px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:.72rem;font-family:'Courier New',monospace"
        />
        <button onclick="saveGsheetUrlFromUI()" style="padding:7px 14px;border-radius:6px;border:none;background:var(--green);color:#fff;font-size:.75rem;font-weight:700;cursor:pointer;white-space:nowrap">
          💾 저장
        </button>
        <button onclick="clearGsheetUrl()" style="padding:7px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:.75rem;font-weight:700;cursor:pointer;white-space:nowrap">
          🗑 해제
        </button>

      </div>
      <div id="gsheetTestResult" style="font-size:.70rem;color:var(--muted);min-height:16px"></div>
    </div>

    <!-- ★ v8 NAV 수동 입력 (코드 없는 종목) -->
    ${noCodeItems.length > 0 ? `
    <div class="card-12-mb16">
      <div class="txt-amber-700-mb4">📥 펀드·TDF 가격 수동 입력</div>
      <div class="txt-muted-68" style="margin-bottom:12px">코드 없는 종목의 NAV를 날짜별로 입력해 가격이력에 저장합니다</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <label class="txt-muted-68">날짜</label>
        <input type="date" id="navDate" value="${getDateStr(0)}"
          style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.72rem"/>
      </div>
      <div id="navInputRows" class="flex-col-g8-mb12">
        ${noCodeItems.map(item => `
        <div class="flex-ac-g8-wrap">
          <span style="font-size:.72rem;color:var(--text);min-width:140px;flex:1">${item.name}</span>
          <span class="txt-muted-68" style="min-width:40px">${item.assetType||item.type||''}</span>
          <input type="number" class="nav-price-inp" data-name="${item.name.replace(/"/g,'&quot;')}"
            placeholder="NAV 입력" min="0" step="1"
            style="width:120px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.72rem;text-align:right"/>
          <span class="txt-muted-68">원</span>
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button onclick="saveNavPrices()" class="btn-amber" ${connected?'':'disabled title="구글시트 연동 필요"'}>
          💾 가격이력 저장
        </button>
        <span id="navSaveResult" class="txt-muted-68"></span>
      </div>
    </div>` : `
    <div class="card-12-mb16">
      <div class="txt-amber-700-mb4">📥 펀드·TDF 가격 수동 입력</div>
      <div class="txt-muted-68">코드 없는 종목(펀드·TDF)을 종목 관리에서 추가하면 여기에 NAV 입력란이 나타납니다</div>
    </div>`}

  </div>`;
}

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
let TAB_ORDER = (function(){
  const ids = lsGet(TAB_ORDER_KEY, null);
  if (ids) {
    // 저장된 순서 기반으로 TAB_DEFAULTS 재배열 (신규 탭은 끝에 추가)
    const ordered = ids.map(id => TAB_DEFAULTS.find(t => t.id === id)).filter(Boolean);
    TAB_DEFAULTS.forEach(t => { if (!ordered.find(o => o.id === t.id)) ordered.push(t); });
    return ordered;
  }
  return [...TAB_DEFAULTS];
})();
function saveTabOrder() {
  lsSave(TAB_ORDER_KEY, TAB_ORDER.map(t=>t.id));
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

  // 패널 내 드래그앤드롭
  let dragSrcIdx = null;
  body.querySelectorAll('.tab-setting-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrcIdx = parseInt(row.dataset.idx);
      row.style.opacity = '.4';
    });
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
      const fi = TAB_ORDER.findIndex(t=>t.id===fromId);
      const ti = TAB_ORDER.findIndex(t=>t.id===tab.id);
      const [moved] = TAB_ORDER.splice(fi, 1);
      TAB_ORDER.splice(ti, 0, moved);
      saveTabOrder(); buildTabBar();
    });
    vs.appendChild(btn);
  });
}

// ACCT_ORDER: localStorage 복원 (드래그 재정렬)
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

// ── 날짜 뱃지 업데이트 헬퍼
function updateDateBadge(dateStr, isToday) {
  const badge = $el('dateBadge');
  if(!badge) return;
  // 어떤 형식이든 숫자만 뽑아 YYYY.MM.DD로 정규화
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

// ── 데이터 백업/복원
//  🗑 데이터 초기화
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

        <label class="list-item-row">
          <input type="checkbox" id="rst-trades" checked class="checkbox-red"/>
          <div>
            <div class="fw-600">거래 이력</div>
            <div class="txt-muted-68">rawTrades 전체 · 보유종목(rawHoldings)도 함께 초기화</div>
          </div>
        </label>

        <label class="list-item-row">
          <input type="checkbox" id="rst-stocks" checked class="checkbox-red"/>
          <div>
            <div class="fw-600">종목 목록 &amp; 종목코드</div>
            <div class="txt-muted-68">EDITABLE_PRICES · STOCK_CODE 전체</div>
          </div>
        </label>

        <label class="list-item-row">
          <input type="checkbox" id="rst-sectors" checked class="checkbox-red"/>
          <div>
            <div class="fw-600">섹터 색상 설정</div>
            <div class="txt-muted-68">커스텀 섹터 색상 → 기본값으로 복원</div>
          </div>
        </label>

        <label class="list-item-row">
          <input type="checkbox" id="rst-accts" checked class="checkbox-red"/>
          <div>
            <div class="fw-600">계좌 목록 &amp; 색상</div>
            <div class="txt-muted-68">ACCT_COLORS · ACCT_ORDER 전체</div>
          </div>
        </label>

        <label class="list-item-row">
          <input type="checkbox" id="rst-realestate" class="checkbox-red"/>
          <div>
            <div class="fw-600">부동산 &amp; 대출 데이터</div>
            <div class="txt-muted-68">REAL_ESTATE · LOAN · LOAN_SCHEDULE · RE_VALUE_HIST</div>
          </div>
        </label>

        <label class="list-item-row">
          <input type="checkbox" id="rst-prices" class="checkbox-red"/>
          <div>
            <div class="fw-600">현재가 캐시</div>
            <div class="txt-muted-68">savedPrices · savedPriceDates · lastUpdated</div>
          </div>
        </label>

        <div id="rst-confirm-wrap" style="display:none;margin-top:4px">
          <div style="background:var(--c-red-08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px 14px;font-size:.75rem;color:var(--red-lt);margin-bottom:10px">
            ⚠️ 선택한 데이터가 영구 삭제됩니다. 계속하려면 아래에 <b>초기화</b> 를 입력하세요.
          </div>
          <input id="rst-confirm-input" type="text" placeholder="초기화"
            style="width:100%;background:var(--s2);border:1px solid var(--c-red-40);border-radius:6px;padding:8px 12px;color:var(--text);font-size:.85rem"/>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 22px 16px;border-top:1px solid var(--border);gap:8px">
        <button onclick="$el('rst-confirm-wrap').style.display='block';$el('rst-confirm-input').focus()"
          class="btn-amber">
          다음 →
        </button>
        <div class="flex-gap8">
          <button onclick="$el('resetOverlay').style.display='none'"
            class="btn-ghost-muted">
            취소
          </button>
          <button onclick="applyReset()" class="btn-danger-lg">
            🗑 초기화 실행
          </button>
        </div>
      </div>
    </div>
  </div>`);
}

function applyReset() {
  // 확인 문구 검증
  const confirmInput = $el('rst-confirm-input');
  if (!confirmInput || confirmInput.value.trim() !== '초기화') {
    showToast('"초기화" 를 정확히 입력해야 실행됩니다.', 'warn');
    $el('rst-confirm-wrap').style.display = 'block';
    if (confirmInput) confirmInput.focus();
    return;
  }

  const keys = {
    trades:      $el('rst-trades')?.checked,
    stocks:      $el('rst-stocks')?.checked,
    sectors:     $el('rst-sectors')?.checked,
    accts:       $el('rst-accts')?.checked,
    realestate:  $el('rst-realestate')?.checked,
    prices:      $el('rst-prices')?.checked,
  };

  // ── 거래 이력 + 보유종목 + 배당
  if (keys.trades) {
    rawTrades.length = 0;
    rawHoldings.length = 0;
    Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
    lsRemove(TRADES_KEY);
    lsRemove(HOLDINGS_KEY);
    lsRemove(DIVDATA_KEY);
  }

  // ── 종목 목록 & 종목코드 & 펀드직접입력
  if (keys.stocks) {
    EDITABLE_PRICES.length = 0;
    Object.keys(STOCK_CODE).forEach(k => delete STOCK_CODE[k]);
    Object.keys(fundDirect).forEach(k => delete fundDirect[k]);
    lsRemove(EDITABLES_KEY);
    lsRemove(STOCKCODE_KEY);
    lsRemove(FUNDDIRECT_KEY);
  }

  // ── 섹터 색상
  if (keys.sectors) {
    lsRemove(SECTOR_COLORS_KEY);
    // 기본값 복원
    Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
  }

  // ── 계좌 목록 & 색상
  if (keys.accts) {
    Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]);
    ACCT_ORDER.length = 0;
    lsRemove(ACCT_COLORS_KEY);
    lsRemove(ACCT_ORDER_KEY);
  }

  // ── 탭 순서 (전체 초기화 시 기본값 복원)
  if (keys.trades && keys.stocks && keys.sectors && keys.accts && keys.realestate && keys.prices) {
    lsRemove(TAB_ORDER_KEY);
    TAB_ORDER.length = 0;
    TAB_DEFAULTS.forEach(t => TAB_ORDER.push({...t}));
  }

  // ── 현재가 캐시
  if (keys.prices) {
    Object.keys(savedPrices).forEach(k => delete savedPrices[k]);
    Object.keys(savedPriceDates).forEach(k => delete savedPriceDates[k]);
    lastUpdated = null;
    lsRemove(PRICES_KEY);
    lsRemove(PRICE_DATES_KEY);
    lsRemove(LAST_UPDATED_KEY);
  }

  // ── 부동산 & 대출
  if (keys.realestate) {
    Object.keys(REAL_ESTATE).forEach(k => delete REAL_ESTATE[k]);
    Object.keys(LOAN).forEach(k => delete LOAN[k]);
    LOAN_SCHEDULE.length = 0;
    RE_VALUE_HIST.length = 0;
    lsRemove(REALESTATE_KEY);
    lsRemove(LOAN_KEY);
    lsRemove(LOAN_SCHEDULE_KEY);
    lsRemove(RE_VALUE_KEY);
  }

  $el('resetOverlay').style.display = 'none';

  const labels = [];
  if (keys.trades)      labels.push('거래이력');
  if (keys.stocks)      labels.push('종목목록');
  if (keys.sectors)     labels.push('섹터색상');
  if (keys.accts)       labels.push('계좌목록');
  if (keys.realestate)  labels.push('부동산/대출');
  if (keys.prices)      labels.push('현재가캐시');

  recomputeRows();
  refreshAll();
  showToast('초기화 완료: ' + labels.join(', '), 'ok');
}

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
    DIVDATA,        // ★ 배당 데이터
    fundDirect,     // ★ 펀드 직접입력
    LOAN_SCHEDULE,  // ★ 대출 상환 스케줄
    RE_VALUE_HIST,  // ★ 부동산 시가 이력
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

      // rawTrades 복원
      if (Array.isArray(data.rawTrades)) {
        rawTrades.length = 0;
        data.rawTrades.forEach(t => rawTrades.push(t));
      }
      // STOCK_CODE
      if (data.STOCK_CODE) Object.assign(STOCK_CODE, data.STOCK_CODE);
      // ACCT_COLORS / ACCT_ORDER
      if (data.ACCT_COLORS) { Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]); Object.assign(ACCT_COLORS, data.ACCT_COLORS); }
      if (Array.isArray(data.ACCT_ORDER)) { ACCT_ORDER.length = 0; data.ACCT_ORDER.forEach(a => ACCT_ORDER.push(a)); }
      // LOAN / REAL_ESTATE
      if (data.LOAN) Object.assign(LOAN, data.LOAN);
      if (data.REAL_ESTATE) Object.assign(REAL_ESTATE, data.REAL_ESTATE);
      // EDITABLE_PRICES
      if (Array.isArray(data.EDITABLE_PRICES)) { EDITABLE_PRICES.length = 0; data.EDITABLE_PRICES.forEach(e => EDITABLE_PRICES.push(e)); }
      // 섹터 색상 (var() 문자열 → hex 변환 후 복원)
      if (data.SECTOR_COLORS) {
        Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
        Object.entries(data.SECTOR_COLORS).forEach(([k, v]) => {
          SECTOR_COLORS[k] = (typeof v === 'string' && v.startsWith('var(')) ? resolveColor(v) : v;
        });
        lsSave(SECTOR_COLORS_KEY, SECTOR_COLORS);
      }
      // 구글시트 URL
      if (data.gsheetUrl) { saveGsheetUrl(data.gsheetUrl); }
      // 가격
      if (data.savedPrices) Object.assign(savedPrices, data.savedPrices);
      if (data.savedPriceDates) Object.assign(savedPriceDates, data.savedPriceDates);
      if (data.lastUpdated) lastUpdated = data.lastUpdated;
      // 배당 데이터
      if (data.DIVDATA && typeof data.DIVDATA === 'object') {
        Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
        Object.assign(DIVDATA, data.DIVDATA);
      }
      // 펀드 직접입력
      if (data.fundDirect && typeof data.fundDirect === 'object') {
        Object.keys(fundDirect).forEach(k => delete fundDirect[k]);
        Object.assign(fundDirect, data.fundDirect);
      }
      // 대출 상환 스케줄
      if (Array.isArray(data.LOAN_SCHEDULE)) {
        LOAN_SCHEDULE.length = 0;
        data.LOAN_SCHEDULE.forEach(r => LOAN_SCHEDULE.push(r));
      }
      // 부동산 시가 이력
      if (Array.isArray(data.RE_VALUE_HIST)) {
        RE_VALUE_HIST.length = 0;
        data.RE_VALUE_HIST.forEach(r => RE_VALUE_HIST.push(r));
      }

      // 동기화 및 저장 (각 전용 save 함수로 일괄 처리)
      syncHoldingsFromTrades();
      saveHoldings();
      syncAcctOrder();
      saveAcctColors();
      saveAcctOrder();
      saveRealEstate();   // REALESTATE_KEY
      saveSchedule();     // LOAN_SCHEDULE_KEY + RE_VALUE_KEY
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

// ── 헬퍼 함수들
