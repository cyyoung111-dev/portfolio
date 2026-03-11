// ── mgmt_migration.js
// rawHoldings → rawTrades 마이그레이션 팝업
// checkAndShowMigration, applyMigration, buildMigrationHTML
// ─────────────────────────────────────────────────────────────

// rawTrades가 비어있는데 rawHoldings에 데이터 있으면 팝업 표시
// ⚠️ 절대 원칙: checkAndShowMigration() 제거 금지
function checkAndShowMigration() {
  if (rawTrades.length > 0) return;
  const holdingsToMigrate = rawHoldings.filter(h => !h.fund);
  if (holdingsToMigrate.length > 0) {
    setTimeout(() => {
      if (!$el('migrationOverlay')) {
        document.body.insertAdjacentHTML('beforeend', buildMigrationHTML());
      }
      if ($el('migrationOverlay')) $el('migrationOverlay').style.display = 'flex';
      renderMigrationTable();
    }, 800);
  } else if (rawHoldings.length === 0) {
    setTimeout(() => {
      const area = $el('view-area');
      if (area && area.innerHTML.trim() === '') return;
      switchView('trades');
    }, 600);
  }
}

function buildMigrationHTML() {
  return `<div id="migrationOverlay"
    style="display:none;position:fixed;inset:0;background:var(--c-black-82);z-index:9500;justify-content:center;align-items:center;padding:16px">
    <div style="background:var(--s1);border:1px solid var(--c-amber-40);border-radius:14px;width:100%;max-width:680px;max-height:92vh;display:flex;flex-direction:column">

      <div style="padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
        <h3 class="h3-1rem-mb4">🔄 기존 보유 종목 → 거래 이력으로 변환</h3>
        <p class="txt-73-muted">
          현재 하드코딩된 보유 종목을 거래 이력 시스템으로 가져와요.<br>
          <b class="c-amber">매수일자</b>를 입력하면 정확한 이력 관리가 가능해요. 모르면 비워두셔도 돼요.
        </p>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 24px">
        <div id="migrationTableWrap"></div>
      </div>

      <div style="padding:12px 24px 16px;border-top:1px solid var(--border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="txt-muted-72">
          💡 나중에 하려면 닫기 · 거래이력 탭 → 📊 일괄 입력에서도 가능해요
        </div>
        <div class="flex-gap8">
          <button onclick="closeMigration()" class="btn-ghost-muted">나중에</button>
          <button onclick="applyMigration()" class="btn-amber">✅ 거래 이력으로 가져오기</button>
        </div>
      </div>
    </div>
  </div>`;
}

let _migrationRows = [];

function renderMigrationTable() {
  _migrationRows = rawHoldings.filter(h => !h.fund).map(h => ({
    acct:     h.acct,
    type:     h.type || '주식',
    name:     h.name,
    code:     STOCK_CODE[h.name] || '',
    qty:      h.qty,
    buyPrice: h.cost,
    buyDate:  '',
    include:  true
  }));

  const wrap = $el('migrationTableWrap');
  if (!wrap) return;

  wrap.innerHTML = `
  <div class="overflow-x-auto">
  <table style="width:100%;border-collapse:collapse;font-size:.75rem;min-width:400px">
    <thead>
      <tr style="background:var(--s2)">
        <th style="padding:7px 8px;text-align:center;width:32px">
          <input type="checkbox" id="mig-all" onchange="migToggleAll(this.checked)" checked/>
        </th>
        <th class="th-left-muted">계좌</th>
        <th class="th-left-muted">종목명</th>
        <th class="th-left-muted">코드</th>
        <th class="th-right-muted">수량</th>
        <th class="th-right-muted">평균단가(원)</th>
        <th style="padding:7px 8px;text-align:left;color:var(--amber);font-weight:600">매수일자 <span style="color:var(--muted);font-weight:400">(선택)</span></th>
      </tr>
    </thead>
    <tbody>
      ${_migrationRows.map((r, i) => `
      <tr class="bd-bottom">
        <td class="td-center-p6">
          <input type="checkbox" data-mig-idx="${i}" onchange="_migrationRows[${i}].include=this.checked" checked/>
        </td>
        <td class="td-p6">
          <span class="adot" style="background:${ACCT_COLORS[r.acct]||'var(--muted)'}"></span>${r.acct}
        </td>
        <td style="padding:6px 8px;font-weight:600">${r.name}</td>
        <td style="padding:6px 8px;color:var(--muted)">${r.code||'-'}</td>
        <td class="td-right-p6">${r.qty.toLocaleString()}</td>
        <td class="td-right-p6">${r.buyPrice.toLocaleString()}</td>
        <td class="td-p6">
          <input type="date" value="${r.buyDate}"
            onchange="_migrationRows[${i}].buyDate=this.value"
            style="background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;color:var(--text);font-size:.72rem;width:130px"/>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
  <div style="margin-top:10px;font-size:.70rem;color:var(--muted)">
    📌 체크 해제한 항목은 가져오지 않아요 · 매수일자 없이 가져오면 날짜만 비워서 저장돼요
  </div>`;
}

function migToggleAll(checked) {
  _migrationRows.forEach((r, i) => {
    r.include = checked;
    const cb  = document.querySelector(`[data-mig-idx="${i}"]`);
    if (cb) cb.checked = checked;
  });
}

function applyMigration() {
  const selected = _migrationRows.filter(r => r.include);
  if (selected.length === 0) { showToast('가져올 항목을 선택해주세요', 'warn'); return; }

  selected.forEach(r => {
    const normN = normName(r.name) || r.name;
    // ★ 신형 tradeType:'buy' 형식으로 직접 생성 (구형 키 buyDate/buyPrice 사용 금지)
    rawTrades.push({
      id:        genTradeId(),
      tradeType: 'buy',
      acct:      r.acct,
      assetType: r.type || '주식',
      name:      normN,
      code:      r.code || '',
      qty:       r.qty,
      price:     r.buyPrice,
      date:      r.buyDate || '',
      memo:      '기존 보유 종목에서 변환',
    });
    // ★ EDITABLE_PRICES 자동 등록 (기초정보에 없으면 추가)
    if (!getEP(normN)) {
      epPush(normN, r.code || '', r.type);
      if (r.code) STOCK_CODE[normN] = r.code;
    }
  });

  _commitTrades();
  closeMigration();
  showToast(`${selected.length}개 종목을 거래 이력으로 가져왔어요! 거래이력 탭에서 확인하세요.`, 'ok');
}

function closeMigration() {
  const el = $el('migrationOverlay');
  if (el) el.style.display = 'none';
}
