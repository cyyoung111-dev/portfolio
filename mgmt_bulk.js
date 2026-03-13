// ── mgmt_bulk.js
// 거래 이력 일괄 입력 오버레이 (openBulkImport, applyBulkImport)
// 그리드 렌더링, CSV 로드/다운로드
// ─────────────────────────────────────────────────────────────

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
// 혼합 컬럼
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

let _bulkMode     = 'buy';
let _bulkRows     = [];
let _bulkRowsSell = [];
let _bulkRowsMix  = [];

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

// ── 탭 전환 ────────────────────────────────────────────────────

function switchBulkTab(mode) {
  _bulkMode = mode;
  const TAB_CFG = {
    buy:  { bg:'var(--c-green2-15)',  color:'var(--green-lt)', applyBg:'rgba(34,197,94,.85)',
            desc:'계좌·유형·종목명·수량·매수일·매수단가 입력',
            hint:'CSV: 계좌,유형,종목명,종목코드,수량,매수일(YYYY.MM.DD),매수단가,메모' },
    sell: { bg:'var(--c-red-12)',     color:'var(--red-lt)',   applyBg:'var(--c-red-80)',
            desc:'계좌·종목명·수량·매도일·매도단가 입력',
            hint:'CSV: 계좌,종목명,수량,매도일(YYYY.MM.DD),매도단가,메모' },
    mix:  { bg:'rgba(139,92,246,.15)',color:'var(--purple-lt)',applyBg:'rgba(139,92,246,.85)',
            desc:'매수·매도 구분 선택 후 한번에 입력',
            hint:'CSV: 계좌,구분(buy/sell),유형,종목명,종목코드,수량,거래일(YYYY.MM.DD),단가,메모' },
  };
  const cfg = TAB_CFG[mode] || TAB_CFG.buy;
  ['buy','sell','mix'].forEach(m => {
    const btn = $el('bulkTab_' + m);
    if (!btn) return;
    const active = m === mode;
    btn.style.background = active ? TAB_CFG[m].bg    : 'transparent';
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

// ── 열기 / 닫기 ────────────────────────────────────────────────

function openBulkImport(defaultMode) {
  _bulkMode     = defaultMode || 'buy';
  _bulkRows     = _bulkRows.length     ? _bulkRows     : Array.from({length:10}, () => ({}));
  _bulkRowsSell = _bulkRowsSell.length ? _bulkRowsSell : Array.from({length:10}, () => ({}));
  _bulkRowsMix  = _bulkRowsMix.length  ? _bulkRowsMix  : Array.from({length:10}, () => ({tradeType:'buy'}));
  const el = $el('bulkImportOverlay') || (() => {
    document.body.insertAdjacentHTML('beforeend', buildBulkOverlayHTML());
    return $el('bulkImportOverlay');
  })();
  el.style.display = 'flex';
  switchBulkTab(_bulkMode);
}

function closeBulkImport() {
  const el = $el('bulkImportOverlay');
  if (el) el.style.display = 'none';
}

// ── HTML 빌더 ──────────────────────────────────────────────────

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
      <!-- 탭 -->
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
        <button onclick="closeBulkImport()" class="btn-ghost-muted">취소</button>
        <button id="bulkApplyBtn" onclick="applyBulkImport()" class="btn-amber">✅ 가져오기</button>
      </div>
    </div>
  </div>`;
}

// ── 그리드 렌더링 ──────────────────────────────────────────────

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
      const val      = row[col.key] || '';
      const selStyle = `width:${col.w}px;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:5px 6px;color:var(--text);font-size:.75rem`;

      if (col.type === 'acct_select') {
        const accts = getAcctList();
        const opts  = ['', ...accts].map(o => `<option value="${o}" ${val===o?'selected':''}>${o||'-- 계좌 선택 --'}</option>`).join('');
        return `<td class="p-2"><select onchange="bulkCellChange(${ri},'${col.key}',this.value)" style="${selStyle}">${opts}</select></td>`;
      }
      if (col.type === 'name_select') {
        const names = EDITABLE_PRICES.map(i => i.name);
        const opts  = ['', ...names].map(o => `<option value="${o}" ${val===o?'selected':''}>${o||'-- 종목 선택 --'}</option>`).join('');
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
        ${col.type==='date'?'placeholder="YYYY.MM.DD"':''}
        style="width:${col.w}px;background:${val?'var(--s2)':'var(--c-white-03)'};border:1px solid ${val?'var(--border)':'transparent'};border-radius:4px;padding:5px 6px;color:var(--text);font-size:.75rem"
        onfocus="this.style.border='1px solid var(--amber)'" onblur="this.style.border='1px solid '+(this.value?'var(--border)':'transparent')"/></td>`;
    }).join('');

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
  if (_bulkMode === 'mix' && col === 'tradeType') renderBulkGrid();
}

function bulkNameChange(ri, name) {
  const rows = _getBulkRows();
  rows[ri].name = name;
  if (_bulkMode === 'buy') {
    const item = getEP(name);
    if (item) rows[ri].code = item.code || '';
  }
  renderBulkGrid();
}

function addBulkRows(n) {
  const rows = _getBulkRows();
  for (let i = 0; i < n; i++) rows.push({});
  renderBulkGrid();
}

function removeBulkRow(ri) {
  const rows = _getBulkRows();
  rows.splice(ri, 1);
  if (!rows.length) rows.push({});
  renderBulkGrid();
}

function clearBulkGrid() {
  if (_bulkMode === 'buy')        _bulkRows     = Array.from({length:10}, () => ({}));
  else if (_bulkMode === 'sell')  _bulkRowsSell = Array.from({length:10}, () => ({}));
  else                            _bulkRowsMix  = Array.from({length:10}, () => ({tradeType:'buy'}));
  renderBulkGrid();
}

// ── CSV 로드 / 템플릿 다운로드 ─────────────────────────────────

function loadBulkCSV(evt) {
  const file = evt.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    const start = lines[0].startsWith('계좌') ? 1 : 0;
    if (_bulkMode === 'buy') {
      _bulkRows = lines.slice(start).map(line => {
        const c = line.split(',').map(s => s.trim().replace(/^"|"$/g,''));
        return { acct:c[0]||'', type:c[1]||'주식', name:c[2]||'', code:c[3]||'',
                 qty:c[4]||'', buyDate:c[5]||'', buyPrice:c[6]||'', memo:c[7]||'' };
      });
      if (!_bulkRows.length) _bulkRows = [{}];
    } else if (_bulkMode === 'sell') {
      _bulkRowsSell = lines.slice(start).map(line => {
        const c = line.split(',').map(s => s.trim().replace(/^"|"$/g,''));
        return { acct:c[0]||'', name:c[1]||'', qty:c[2]||'',
                 sellDate:c[3]||'', sellPrice:c[4]||'', memo:c[5]||'' };
      });
      if (!_bulkRowsSell.length) _bulkRowsSell = [{}];
    } else {
      _bulkRowsMix = lines.slice(start).map(line => {
        const c = line.split(',').map(s => s.trim().replace(/^"|"$/g,''));
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
    header   = '계좌,유형,종목명,종목코드,수량,매수일(YYYY.MM.DD),매수단가,메모';
    rows     = rawHoldings.filter(h => !h.fund).map(h =>
      [h.acct, h.type||'주식', h.name, STOCK_CODE[h.name]||'', h.qty, '', h.cost, ''].join(',')
    );
    filename = 'bulk_buy_template.csv';
  } else if (_bulkMode === 'sell') {
    header   = '계좌,종목명,수량,매도일(YYYY.MM.DD),매도단가,메모';
    rows     = rawHoldings.filter(h => !h.fund && h.qty > 0).map(h =>
      [h.acct, h.name, '', '', '', ''].join(',')
    );
    filename = 'bulk_sell_template.csv';
  } else {
    header   = '계좌,구분(buy/sell),유형,종목명,종목코드,수량,거래일(YYYY.MM.DD),단가,메모';
    rows     = rawHoldings.filter(h => !h.fund).map(h =>
      [h.acct, 'buy', h.type||'주식', h.name, STOCK_CODE[h.name]||'', h.qty, '', h.cost, ''].join(',')
    );
    filename = 'bulk_mix_template.csv';
  }
  const csv = [header, ...rows].join('\n');
  const a   = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'})),
    download: filename
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── 가져오기 적용 ──────────────────────────────────────────────

function applyBulkImport() {
  const err = $el('bulkError');
  if (err) err.style.display = 'none';
  const added = [];

  if (_bulkMode === 'buy') {
    const valid = _bulkRows.filter(r => r.name && r.acct && r.qty && r.buyDate && r.buyPrice);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·매수일·매수단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN  = normName(r.name) || r.name;
      const isFund = (r.type === '펀드' || r.type === 'TDF');
      const trade  = {
        id: genTradeId(), tradeType: 'buy',
        acct: r.acct, assetType: r.type||'주식',
        name: normN,  code: r.code||'',
        qty: parseInt(r.qty)||0, price: parseFloat(r.buyPrice)||0,
        date: r.buyDate||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
      if (r.code && !STOCK_CODE[normN]) STOCK_CODE[normN] = r.code;
      if (!getEP(normN)) epPush(normN, r.code, r.type);
    });
    _bulkRows = Array.from({length:10}, () => ({}));

  } else if (_bulkMode === 'sell') {
    const valid = _bulkRowsSell.filter(r => r.name && r.acct && r.qty && r.sellDate && r.sellPrice);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·매도일·매도단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN  = normName(r.name) || r.name;
      const ep     = getEP(normN);
      const isFund = ep && (ep.assetType === '펀드' || ep.assetType === 'TDF');
      const trade  = {
        id: genTradeId(), tradeType: 'sell',
        acct: r.acct, assetType: ep ? ep.assetType : '주식',
        name: normN,  code: ep ? ep.code||'' : '',
        qty: parseInt(r.qty)||0, price: parseFloat(r.sellPrice)||0,
        date: r.sellDate||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
    });
    _bulkRowsSell = Array.from({length:10}, () => ({}));

  } else {
    const valid = _bulkRowsMix.filter(r => r.name && r.acct && r.qty && r.date && r.price);
    if (!valid.length) {
      if (err) { err.textContent='❌ 유효한 행이 없어요 (계좌·종목명·수량·거래일·단가 필수)'; err.style.display='block'; }
      return;
    }
    valid.forEach(r => {
      const normN     = normName(r.name) || r.name;
      const tt        = r.tradeType === 'sell' ? 'sell' : 'buy';
      const ep        = getEP(normN);
      const assetType = ep ? ep.assetType : (r.type || '주식');
      const isFund    = (assetType === '펀드' || assetType === 'TDF');
      const trade     = {
        id: genTradeId(), tradeType: tt,
        acct: r.acct, assetType,
        name: normN,  code: r.code || (ep ? ep.code||'' : ''),
        qty: parseInt(r.qty)||0, price: parseFloat(r.price)||0,
        date: r.date||'', memo: r.memo||''
      };
      if (isFund) trade.fund = true;
      rawTrades.push(trade);
      added.push(trade);
      if (r.code && !STOCK_CODE[normN]) STOCK_CODE[normN] = r.code;
      if (!ep && tt === 'buy') epPush(normN, r.code, assetType);
    });
    _bulkRowsMix = Array.from({length:10}, () => ({tradeType:'buy'}));
  }

  _commitTrades();
  closeBulkImport();
  const label = _bulkMode === 'buy' ? '매수' : _bulkMode === 'sell' ? '매도' : '혼합';
  showToast(`${label} ${added.length}건 가져오기 완료`, 'ok');
}
