// ════════════════════════════════════════════════════════════════
//  views_table.js — 종목 테이블 렌더링
//  의존: views_table_state.js, views_table_filters.js
// ════════════════════════════════════════════════════════════════

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

  function thSort(col, label) {
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
    thSort('qty','주식수'),
    thSort('cost','매입단가'),
    thSort('costAmt','매입금액'),
    thSort('price','현재단가'),
    thSort('eval','평가금액'),
    thSort('pnl','손익'),
    thSort('pct','수익률'),
  ].join('');

  let html = `${buildActiveFiltersBar(tableId)}
  <div class="tbl-wrap">
    <div class="tbl-head">
      <h3>종목 목록 ${filteredBadge}</h3>
      <div class="tsum">평가 <b>${fmt(totalEval)}</b> &nbsp; 손익 <span style="color:${pC}">${pS}${fmt(totalPnl)} (${pS}${totalPct.toFixed(1)}%)</span> <span class="txt-muted-68">(단위:원)</span></div>
    </div>
    <div class="overflow-x-auto"><table><thead><tr>${headerCols}</tr></thead><tbody>`;

  let smallCount = 0;
  let smallEvalSum = 0;
  const rowsHtml = [];

  data.forEach(r => {
    const isSmall = r.evalAmt < SMALL_THRESHOLD && !r.fund;
    if (isSmall) {
      smallCount += 1;
      smallEvalSum += r.evalAmt;
    }

    const pC2 = pColor(r.pnl), pS2 = pSign(r.pnl);
    const priceCell = r.fund
      ? `<span style='color:var(--cyan)'>${r.price.toLocaleString()}</span>`
      : r.price ? r.price.toLocaleString() : '<span class="c-muted">-</span>';
    const qtyCell = r.qty != null ? r.qty.toLocaleString() : '-';
    const costCell = r.cost != null ? r.cost.toLocaleString() : '-';
    const costAmtCell = r.costAmt != null ? fmtW(r.costAmt) : '-';

    let sectorCell = '';
    if (extraCol === '섹터') {
      const sectorColor = SECTOR_COLORS[r.sector] || 'var(--muted)';
      sectorCell = `<td><span style="font-size:.70rem;padding:2px 8px;border-radius:4px;background:${sectorColor}22;color:${sectorColor}">${r.sector}</span></td>`;
    }

    rowsHtml.push(`<tr class="${isSmall ? `small-pos-row small-pos-row-${tableId}" style="display:none` : ''}">
      ${sectorCell}
      <td><span class="adot" style="background:${ACCT_COLORS[r.acct]||'var(--muted)'}"></span>${r.acct}</td>
      <td><span class="tag tg-${r.type}">${r.type}</span></td>
      <td class="fw6"><span data-gname="${r.name}" onclick="goToTradeGroup(this.dataset.gname)" class="dotted-link" title="종목별 거래 보기">${r.name}</span>${r.code?`<span class="lbl-62-mt2">${r.code}</span>`:''}</td>
      <td class="num">${qtyCell}</td>
      <td class="num">${costCell}</td>
      <td class="num">${costAmtCell}</td>
      <td class="num">${priceCell}</td>
      <td class="num">${fmtW(r.evalAmt)}</td>
      <td class="num" style="color:${pC2}">${pS2}${fmt(r.pnl)}</td>
      <td class="num" style="color:${pC2}">${pS2}${r.pct.toFixed(1)}%</td>
    </tr>`);
  });

  html += rowsHtml.join('');
  html += `</tbody></table></div></div>`;

  if (smallCount > 0) {
    html = `${makeSmallToggleBar(smallCount, smallEvalSum, tableId)}` + html;
  }

  return html;
}
