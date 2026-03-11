// ════════════════════════════════════════════════════════════════
//  views_table.js — 종목 테이블 필터·정렬 시스템
//  의존: data.js (ACCT_COLORS, SECTOR_COLORS, fmt, fmtW, pColor, pSign, $el)
// ════════════════════════════════════════════════════════════════

// ── 테이블 컬럼 필터 상태 (테이블 인스턴스별)
const tableState = {};  // {tableId: {sortCol, sortDir, filters: {col: Set<val>}}}

function getTableState(tableId) {
  if (!tableState[tableId]) {
    tableState[tableId] = { sortCol: null, sortDir: 'asc', filters: {} };
  }
  return tableState[tableId];
}

// 컬럼 정의
const TABLE_COLS = [
  { key: 'sector', label: '섹터',     type: 'filter' },
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
  if (smallRows.length === 0) return '';
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

  if (openDropdownId === dropId) {
    closeAllDropdowns();
    return;
  }
  closeAllDropdowns();
  openDropdownId = dropId;

  const rawData = window._tableData.get(tableId) || [];
  const st = getTableState(tableId);
  const currentFilter = st.filters[col] || null;

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
  const allChecked = allVals.every(v => checked.has(v));
  applyTableFilter(tableId, col, allChecked ? null : checked);
}

// 필터 + 정렬 적용된 데이터 반환
function applyFiltersAndSort(rawData, tableId) {
  const st = getTableState(tableId);
  let data = [...rawData];

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

  if (smallRows.length > 0) {
    html = `${makeSmallToggleBar(smallRows, tableId)}` + html;
  }

  return html;
}
