// ════════════════════════════════════════════════════════════════
//  views_table_state.js — 종목 테이블 공용 상태/유틸
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
  { key: 'qty',    label: '주식수',   type: 'sort',   num: true },
  { key: 'cost',   label: '매입단가', type: 'sort',   num: true },
  { key: 'costAmt',label: '매입금액', type: 'sort',   num: true },
  { key: 'price',  label: '현재단가', type: 'sort',   num: true },
  { key: 'eval',   label: '평가금액', type: 'sort',   num: true },
  { key: 'pnl',    label: '손익',     type: 'sort',   num: true },
  { key: 'pct',    label: '수익률',   type: 'sort',   num: true },
];

const KO_COLLATOR = new Intl.Collator('ko');

function compareKo(a, b) {
  return KO_COLLATOR.compare(a, b);
}

function getFilterValue(row, col) {
  if (col === 'acct') return row.acct;
  if (col === 'type') return row.type;
  if (col === 'name') return row.name;
  if (col === 'sector') return row.sector || '기타';
  return '';
}

function getSortValue(row, col) {
  if (col === 'qty') return row.qty || 0;
  if (col === 'cost') return row.cost || 0;
  if (col === 'costAmt') return row.costAmt || 0;
  if (col === 'price') return row.price || 0;
  if (col === 'eval') return row.evalAmt || 0;
  if (col === 'pnl') return row.pnl || 0;
  if (col === 'pct') return row.pct || 0;
  return 0;
}

function getDistinctFilterValues(rows, col) {
  return [...new Set(rows.map(row => getFilterValue(row, col)).filter(Boolean))];
}

// 전역 테이블 데이터 저장소
window._tableData = new Map();
window._tableExtra = new Map();
window._tableFilterValueCache = new Map();

function getDistinctFilterValuesCached(tableId, rows, col) {
  let cache = window._tableFilterValueCache.get(tableId);
  if (!cache || cache.rawRef !== rows) {
    cache = { rawRef: rows, byCol: {} };
    window._tableFilterValueCache.set(tableId, cache);
  }
  if (!cache.byCol[col]) {
    cache.byCol[col] = getDistinctFilterValues(rows, col);
  }
  return cache.byCol[col];
}

// SMALL POSITION FILTER
const SMALL_THRESHOLD = 100000; // 10만원
const _smallOpen = {};

function makeSmallToggleBar(smallCount, smallEvalSum, tableId) {
  if (smallCount === 0) return '';
  return `<div class="small-toggle-bar" id="stb_${tableId}" onclick="toggleSmall('${tableId}')">
    <div class="st-left">
      <span>👁 소액 종목 숨김 (10만원 미만)</span>
      <span class="st-cnt">${smallCount}개 · ${fmt(smallEvalSum)} 숨겨짐 (합산엔 포함)</span>
    </div>
    <span class="st-arrow">▼</span>
  </div>`;
}

function toggleSmall(tableId) {
  const bar = $el('stb_' + tableId);
  const smalls = document.querySelectorAll('.small-pos-row-' + tableId);
  bar.classList.toggle('open');
  const isOpen = bar.classList.contains('open');
  _smallOpen[tableId] = isOpen;
  bar.querySelector('.st-left span:first-child').textContent = isOpen ? '👁 소액 종목 표시 중 (10만원 미만)' : '👁 소액 종목 숨김 (10만원 미만)';
  smalls.forEach(el => { el.style.display = isOpen ? '' : 'none'; });
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
