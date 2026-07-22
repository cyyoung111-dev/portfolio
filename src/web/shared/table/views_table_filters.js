// ════════════════════════════════════════════════════════════════
//  views_table_filters.js — 종목 테이블 필터/정렬/드롭다운
// ════════════════════════════════════════════════════════════════

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

document.addEventListener('click', (e) => {
  const tableAction = e.target.closest('[data-table-action]');
  if (tableAction) {
    const action = tableAction.dataset.tableAction;
    const tableId = tableAction.dataset.tableId || '';
    const col = tableAction.dataset.col || '';
    if (action === 'open-filter') openColFilterDropdown(tableId, col, tableAction);
    else if (action === 'sort') setTableSort(tableId, col);
    else if (action === 'clear-filter') clearTableFilter(tableId, col);
    else if (action === 'clear-all-filters') clearAllTableFilters(tableId);
    else if (action === 'go-trade-group' && typeof goToTradeGroup === 'function') goToTradeGroup(tableAction.dataset.gname || '');
    return;
  }

  const cfdAction = e.target.closest('[data-cfd-action]');
  if (cfdAction) {
    const action = cfdAction.dataset.cfdAction;
    const dropId = cfdAction.dataset.dropId || '';
    if (action === 'toggle-all') cfdToggleAll(dropId, cfdAction.dataset.checked === '1');
    else if (action === 'apply') cfdApply(cfdAction.dataset.tableId || '', cfdAction.dataset.col || '', dropId);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.classList?.contains('cfd-search')) cfdSearch(e.target);
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

  const vals = getDistinctFilterValuesCached(tableId, rawData, col).slice().sort(compareKo);

  let searchHtml = vals.length > 6
    ? `<input class="cfd-search" placeholder="검색..." />`
    : '';

  const itemsHtml = vals.map(v => {
    const checked = !currentFilter || currentFilter.has(v) ? 'checked' : '';
    const dot = col === 'acct' && ACCT_COLORS[v]
      ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ACCT_COLORS[v]};flex-shrink:0"></span>` : '';
    const colorStyle = col === 'sector' && SECTOR_COLORS[v] ? `color:${SECTOR_COLORS[v]}` : '';
    return `<label data-cfd-item="${_escapeHtml(v)}">
      <input type="checkbox" value="${_escapeHtml(v)}" ${checked} />
      ${dot}<span style="${colorStyle}">${_escapeHtml(v)}</span>
    </label>`;
  }).join('');

  const div = document.createElement('div');
  div.className = 'col-filter-dropdown';
  div.id = dropId;
  div.innerHTML = `
    ${searchHtml}
    <div class="cfd-items">${itemsHtml}</div>
    <div class="cfd-actions">
      <button class="cfd-btn" data-cfd-action="toggle-all" data-drop-id="${_escapeHtml(dropId)}" data-checked="1">전체선택</button>
      <button class="cfd-btn" data-cfd-action="toggle-all" data-drop-id="${_escapeHtml(dropId)}" data-checked="0">전체해제</button>
      <button class="cfd-btn apply" data-cfd-action="apply" data-table-id="${_escapeHtml(tableId)}" data-col="${_escapeHtml(col)}" data-drop-id="${_escapeHtml(dropId)}">적용</button>
    </div>
  `;

  thEl.style.position = 'relative';
  thEl.appendChild(div);
}

function cfdSearch(input) {
  const q = _normalizeSearchText(input.value);
  const drop = input.closest('.col-filter-dropdown');
  if (!drop) return;
  drop.querySelectorAll('[data-cfd-item]').forEach(label => {
    const val = label.dataset.cfdItem || '';
    label.style.display = _searchIncludes(val, q) ? '' : 'none';
  });
}

function cfdToggleAll(dropId, checked) {
  document.querySelectorAll(`#${dropId} input[type=checkbox]`).forEach(cb => cb.checked = checked);
}

function cfdApply(tableId, col, dropId) {
  const checked = new Set();
  document.querySelectorAll(`#${dropId} input[type=checkbox]:checked`).forEach(cb => checked.add(cb.value));
  const rawData = window._tableData.get(tableId) || [];
  const allVals = getDistinctFilterValuesCached(tableId, rawData, col);
  const allChecked = allVals.every(v => checked.has(v));
  applyTableFilter(tableId, col, allChecked ? null : checked);
}

// 필터 + 정렬 적용된 데이터 반환
function applyFiltersAndSort(rawData, tableId) {
  const st = getTableState(tableId);
  let data = [...rawData];

  Object.entries(st.filters).forEach(([col, vals]) => {
    data = data.filter(r => vals.has(getFilterValue(r, col)));
  });

  if (st.sortCol) {
    const dir = st.sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      if (st.sortCol === 'name') return dir * compareKo(a.name, b.name);
      return dir * (getSortValue(a, st.sortCol) - getSortValue(b, st.sortCol));
    });
  }

  return data;
}
