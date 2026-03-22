// ── mgmt_trade.js
// 거래 추가 / 수정 오버레이 (openAddTrade, saveTrade, editTrade)
// buildTradeEditOverlayHTML, 코드·계좌·종목명 헬퍼
// ─────────────────────────────────────────────────────────────

let _editingTradeId = null;
let _teIsNewMode    = false; // 신규 종목 선택 모드
let _teNewSectorFilter = '';  // 신규 모드 섹터 필터
let _teNewTypeFilter   = '';  // 신규 모드 자산구분 필터

function openAddTrade(prefill, forceTradeType) {
  _editingTradeId = prefill?.id || null;
  _teIsNewMode = false;
  _teNewSectorFilter = '';
  _teNewTypeFilter = '';
  const t = prefill || {};

  if (!$el('tradeEditOverlay')) {
    document.body.insertAdjacentHTML('beforeend', buildTradeEditOverlayHTML());
    $el('tradeEditOverlay').addEventListener('click', e => {
      if (e.target === $el('tradeEditOverlay')) closeTradeEdit();
    });
  }

  const el = $el('tradeEditOverlay');
  el.style.display = 'flex';

  const tradeType = forceTradeType || t.tradeType || 'buy';
  const f = id => $el(id);
  f('te-tradetype-buy').classList.toggle('active', tradeType === 'buy');
  f('te-tradetype-sell').classList.toggle('active', tradeType === 'sell');
  _teSetTradeType(tradeType);

  _refreshTeAcctList(t.acct);
  _refreshTeCodeList(t.name, t.code, t.acct);

  const _teEp        = getEP(normName(t.name) || t.name);
  const _teAssetType = getEPType(_teEp, t.assetType || t.type || '주식');
  f('te-assettype').value = _teAssetType;

  (function(){
    const grp = $el('te-assettype-group'); if (!grp) return;
    // 기존 종목이면 자산구분 잠금 (사용자 수정 불가)
    const isLocked = !!_teEp;
    if (isLocked) {
      // 잠금: 선택된 값만 표시, 클릭 비활성화
      grp.innerHTML = `<span style="display:inline-block;padding:4px 10px;border-radius:6px;
        background:var(--c-amber-10);border:1px solid var(--c-amber-30);color:var(--gold);
        font-size:.72rem;font-weight:600">${_teAssetType}</span>
        <span style="font-size:.65rem;color:var(--muted);margin-left:6px">기초정보에서 변경</span>`;
    } else {
      // 신규 종목: 자유롭게 선택 가능
      const types = ['주식','ETF','ISA','IRP','연금','펀드','TDF'];
      grp.innerHTML = types.map(t =>
        `<button type="button" onclick="_tePickAssetType('${t}')" class="${_fBtnClass(_teAssetType===t)}">${t}</button>`
      ).join('');
    }
  })();

  f('te-qty').value   = t.qty   || '';
  f('te-price').value = t.price ?? '';
  f('te-date').value  = t.date  || '';
  f('te-memo').value  = t.memo  || '';
  f('te-title').textContent       = _editingTradeId ? '거래 수정' : '거래 추가';
  f('te-error').style.display     = 'none';
  f('te-code-status').textContent = '';
}

function _teSetTradeType(type) {
  const f      = id => $el(id);
  const isSell = type === 'sell';
  f('te-tradetype-buy').classList.toggle('active', !isSell);
  f('te-tradetype-sell').classList.toggle('active', isSell);
  const priceLabel = f('te-price-label');
  if (priceLabel) priceLabel.textContent = isSell ? '매도단가 (원) *' : '매수단가 (원) *';
  const dateLabel = f('te-date-label');
  if (dateLabel)  dateLabel.textContent  = isSell ? '매도일자 *' : '매수일자 *';
  window._currentTradeType = type;
}

// ── 계좌 목록 ──────────────────────────────────────────────────

function _refreshTeAcctList(selectedAcct) {
  const acctList = getAcctList();
  const inp = $el('te-acct');
  const grp = $el('te-acct-group');
  if (!inp || !grp) return;
  // '전체' 제외한 실제 계좌만
  const realAccts = acctList.filter(a => a !== '전체');
  const active = selectedAcct && realAccts.includes(selectedAcct)
    ? selectedAcct : (realAccts[0] || '');
  inp.value = active;
  _renderTeAcctBtns(active, realAccts);
}

function _renderTeAcctBtns(active, acctList) {
  const grp = $el('te-acct-group');
  if (!grp) return;
  const isNew = _teIsNewMode;
  grp.innerHTML = acctList.map(a =>
    `<button type="button" onclick="_tePickAcct('${a.replace(/'/g,"\\'")}')"`+
    ` class="${_fBtnClass(!isNew && a===active)}">${a}</button>`
  ).join('') +
  `<button type="button" onclick="_tePickNewMode()" class="${_fBtnClass(isNew)}" ` +
  `style="border-color:var(--c-cyan-40);${isNew?'background:rgba(6,182,212,.15);color:var(--cyan)':'color:var(--cyan)'}">✨ 신규</button>`;
}

function _tePickAcct(val) {
  _teIsNewMode = false;
  _teNewSectorFilter = '';
  _teNewTypeFilter = '';
  const inp = $el('te-acct'); if (inp) inp.value = val;
  _renderTeAcctBtns(val, getAcctList().filter(a => a !== '전체'));
  // 계좌 선택 시 해당 계좌 종목만 필터링
  _refreshTeCodeList('', '', val);
  // 신규 필터 UI 숨김
  const nf = $el('te-new-filter'); if (nf) nf.style.display = 'none';
}

function _tePickNewMode() {
  _teIsNewMode = true;
  const inp = $el('te-acct'); if (inp) inp.value = '';
  _renderTeAcctBtns('', getAcctList().filter(a => a !== '전체'));
  // 신규 필터 UI 표시
  const nf = $el('te-new-filter'); if (nf) nf.style.display = 'block';
  _teRenderNewFilter();
  _refreshTeCodeListNew('', '');
}

// ── 신규 모드: 섹터/자산구분 필터 ──────────────────────────────

function _teRenderNewFilter() {
  const nf = $el('te-new-filter');
  if (!nf) return;

  // 섹터 목록: EDITABLE_PRICES에서 추출
  const sectors = ['전체', ...new Set(EDITABLE_PRICES.map(e => e.sector || '기타').filter(Boolean)).values()].sort((a,b) => a==='전체'?-1:b==='전체'?1:a.localeCompare(b));
  // 자산구분 목록
  const types = ['전체','주식','ETF','ISA','IRP','연금','펀드','TDF'];

  const realAccts = getAcctList().filter(a => a !== '전체');
  const curAcct = $el('te-acct')?.value || '';

  nf.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:var(--s2);border:1px solid var(--c-cyan-30);border-radius:8px;margin-bottom:6px">
      <div style="font-size:.68rem;color:var(--cyan);font-weight:600;margin-bottom:2px">✨ 신규 종목 선택</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.68rem;color:var(--muted);flex-shrink:0;min-width:24px">계좌</span>
        <div class="flex-wrap-gap3">
          ${realAccts.map(a =>
            `<button type="button" onclick="_teNewPickAcct('${a.replace(/'/g,"\'")}')" ` +
            `class="f-btn-sm ${curAcct===a?'active':''}">${a}</button>`
          ).join('')}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.68rem;color:var(--muted);flex-shrink:0;min-width:24px">섹터</span>
        <div class="flex-wrap-gap3" id="te-new-sector-btns">
          ${sectors.map(s =>
            `<button type="button" onclick="_teNewPickSector('${s.replace(/'/g,"\'")}')" ` +
            `class="f-btn-sm ${_teNewSectorFilter===s||(!_teNewSectorFilter&&s==='전체')?'active':''}">${s}</button>`
          ).join('')}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.68rem;color:var(--muted);flex-shrink:0;min-width:24px">구분</span>
        <div class="flex-wrap-gap3" id="te-new-type-btns">
          ${types.map(t =>
            `<button type="button" onclick="_teNewPickType('${t}')" ` +
            `class="f-btn-sm ${_teNewTypeFilter===t||(!_teNewTypeFilter&&t==='전체')?'active':''}">${t}</button>`
          ).join('')}
        </div>
      </div>
    </div>`;
}

function _teNewPickAcct(a) {
  const inp = $el('te-acct'); if (inp) inp.value = a;
  // 상단 계좌 버튼 active 갱신 (신규 모드 유지)
  _renderTeAcctBtns('', getAcctList().filter(x => x !== '전체'));
  // 패널 재렌더 (계좌 선택 표시 갱신)
  _teRenderNewFilter();
}

function _teNewPickSector(s) {
  _teNewSectorFilter = s === '전체' ? '' : s;
  _teRenderNewFilter();
  _refreshTeCodeListNew('', '');
}

function _teNewPickType(t) {
  _teNewTypeFilter = t === '전체' ? '' : t;
  _teRenderNewFilter();
  _refreshTeCodeListNew('', '');
}

function _refreshTeCodeListNew(selectedName) {
  // 기초정보 전체에서 섹터/자산구분 필터 적용
  let items = EDITABLE_PRICES.filter(e => e.name);
  if (_teNewSectorFilter) items = items.filter(e => (e.sector||'기타') === _teNewSectorFilter);
  if (_teNewTypeFilter)   items = items.filter(e => (e.assetType||'주식') === _teNewTypeFilter);
  const names = items.map(e => e.name).sort();

  const grp = $el('te-name-btns');
  if (!grp) return;
  if (names.length === 0) {
    grp.innerHTML = `<span style="font-size:.72rem;color:var(--muted)">해당 조건의 종목이 없습니다</span>`;
  } else {
    grp.innerHTML = names.map(n =>
      `<button type="button" onclick="_tePickName('${n.replace(/'/g,"\\'")}')"`+
      ` class="${_fBtnClass(n===selectedName)} f-btn-sm">${n}</button>`
    ).join('');
  }

  // 선택 초기화
  const nameHid = $el('te-name'); if (nameHid) nameHid.value = selectedName || '';
  const selEl = $el('te-selected-name');
  if (selEl) { selEl.style.display = 'none'; }
}

function _tePickAssetType(val) {
  const inp = $el('te-assettype'); if (inp) inp.value = val;
  const types = ['주식','ETF','ISA','IRP','연금','펀드','TDF'];
  const grp   = $el('te-assettype-group'); if (!grp) return;
  grp.innerHTML = types.map(t =>
    `<button type="button" onclick="_tePickAssetType('${t}')" class="${_fBtnClass(t===val)}">${t}</button>`
  ).join('');
}

// ── 종목 datalist / 버튼 그룹 ──────────────────────────────────

function _refreshTeCodeList(selectedName, selectedCode, acctFilter) {
  // 소스: EDITABLE_PRICES만 사용 (기초정보 등록 종목만 허용)
  let allNames = EDITABLE_PRICES.map(i => i.name).filter(Boolean).sort();

  // 계좌 필터가 있으면 해당 계좌에서 거래된 종목만 우선 표시
  let names;
  if (acctFilter && acctFilter !== '전체') {
    const acctNames = new Set(rawTrades.filter(t => t.acct === acctFilter).map(t => t.name));
    names = allNames.filter(n => acctNames.has(n));
    if (names.length === 0) names = allNames; // 해당 계좌 종목 없으면 전체 표시
  } else {
    names = allNames;
  }

  const grp = $el('te-name-btns');
  if (grp) {
    if (names.length === 0) {
      grp.innerHTML = '';
      const hint = $el('te-no-ep-hint');
      if (hint) hint.style.display = 'block';
    } else {
      const hint = $el('te-no-ep-hint');
      if (hint) hint.style.display = 'none';
      grp.innerHTML = names.map(n =>
        `<button type="button" onclick="_tePickName('${n.replace(/'/g,"\\'")}')"`+
        ` class="${_fBtnClass(n===selectedName)} f-btn-sm">${n}</button>`
      ).join('');
    }
  }

  // hidden input 세팅
  const nameHid = $el('te-name');
  if (nameHid) nameHid.value = selectedName || '';
  const codeHid = $el('te-code');
  if (codeHid) codeHid.value = selectedCode || (selectedName ? (STOCK_CODE[selectedName]||'') : '');

  // 선택된 종목명 표시
  const selEl = $el('te-selected-name');
  if (selEl) {
    if (selectedName) {
      selEl.textContent = selectedName;
      selEl.style.display = 'block';
    } else {
      selEl.style.display = 'none';
    }
  }
}

function _tePickName(name) {
  $el('te-name').value = name;

  // 기초정보에서 코드 + 자산구분 자동 세팅
  const ep   = getEP(name);
  const code = (ep && ep.code) ? ep.code : (STOCK_CODE[name] || '');
  $el('te-code').value = code;

  // 자산구분 자동 반영 (기초정보 우선)
  const assetType = getEPType(ep, '주식');
  $el('te-assettype').value = assetType;
  const grpAt = $el('te-assettype-group');
  if (grpAt) {
    grpAt.innerHTML = `<span style="display:inline-block;padding:4px 10px;border-radius:6px;
      background:var(--c-amber-10);border:1px solid var(--c-amber-30);color:var(--gold);
      font-size:.72rem;font-weight:600">${assetType}</span>
      <span style="font-size:.65rem;color:var(--muted);margin-left:6px">기초정보에서 변경</span>`;
  }

  // 선택된 종목명 표시 업데이트
  const selEl = $el('te-selected-name');
  if (selEl) { selEl.textContent = name; selEl.style.display = 'block'; }

  // 버튼 active 상태 갱신
  const grp = $el('te-name-btns');
  if (grp) {
    grp.querySelectorAll('button').forEach(btn => {
      btn.className = _fBtnClass(btn.textContent === name) + ' f-btn-sm';
    });
  }

  const status = $el('te-code-status');
  if (code) {
    status.textContent = '✅ ' + name + (code ? ' (' + code + ')' : '');
    status.style.color = 'var(--green)';
  } else {
    const ep     = EDITABLE_PRICES.find(e => e.name === name);
    const epCode = ep?.code || '';
    if (epCode) {
      $el('te-code').value   = epCode;
      status.textContent     = '✅ ' + name + ' (' + epCode + ')';
      status.style.color     = 'var(--green)';
    } else if (name.trim().length >= 2) {
      teCodeLookup(name);
    } else {
      status.textContent = '';
    }
  }
}

// 종목코드 입력 → 종목명 자동조회
async function teCodeLookup(code) {
  const status = $el('te-code-status');
  const nameEl = $el('te-name');
  if (!code || code.length < 4) { status.textContent = ''; return; }
  const trimCode = code.trim();

  // 1. EDITABLE_PRICES 코드 역방향 검색 (최우선)
  const epItem = getEPByCode(trimCode);
  if (epItem) {
    nameEl.value           = epItem.name;
    status.textContent     = '✅ ' + epItem.name;
    status.style.color     = 'var(--green)';
    return;
  }

  // 2. STOCK_CODE 역방향 검색
  const localName = Object.entries(STOCK_CODE).find(([n,c]) => c.trim() === trimCode)?.[0];
  if (localName) {
    nameEl.value       = localName;
    status.textContent = '✅ ' + localName;
    status.style.color = 'var(--green)';
    return;
  }

  // 3. GSheet API 조회
  if (!GSHEET_API_URL) {
    status.textContent = 'ℹ️ 코드 없는 종목 (펀드·TDF 등) — 종목명을 직접 입력하세요';
    status.style.color = 'var(--muted)';
    return;
  }
  status.textContent = '⏳ 조회 중...'; status.style.color = 'var(--blue-lt)';
  try {
    const name = await lookupNameByCode(trimCode);
    if (name) {
      nameEl.value       = name;
      status.textContent = '✅ ' + name;
      status.style.color = 'var(--green)';
      STOCK_CODE[name]   = trimCode;
      saveHoldings();
    } else {
      status.textContent = 'ℹ️ 코드 조회 결과 없음 — 종목명을 직접 입력하거나 기초정보에서 코드를 등록하세요';
      status.style.color = 'var(--muted)';
    }
  } catch(e) {
    status.textContent = 'ℹ️ 코드 조회 중 오류 — 종목명을 직접 입력해주세요';
    status.style.color = 'var(--muted)';
  }
}

// 종목명 변경 → 코드 자동완성
// teNameChange: 직접 입력 불가로 비활성화
function teNameChange(name) {}


// ── 오버레이 HTML ───────────────────────────────────────────────

function buildTradeEditOverlayHTML() {
  const inp = (id, ph, tp='text') =>
    `<input id="${id}" type="${tp}" placeholder="${ph}" class="input-full-82"/>`;
  const lbl = (txt, req) =>
    `<label class="form-label">${txt}${req?'<span class="c-red"> *</span>':''}</label>`;

  return `<div id="tradeEditOverlay"
    style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;justify-content:center;align-items:flex-start;padding:8px;overflow-y:auto">
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;width:100%;max-width:480px;margin:auto;min-height:min-content">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px 12px;border-bottom:1px solid var(--border)">
        <h3 id="te-title" class="h3-95">거래 추가</h3>
        <button onclick="closeTradeEdit()" class="btn-close-icon">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:11px">
        <div id="te-error" style="display:none;background:var(--c-red-10);border:1px solid var(--c-red-30);border-radius:6px;padding:8px 12px;font-size:.75rem;color:var(--red-lt)"></div>

        <!-- 매수 / 매도 탭 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <button id="te-tradetype-buy" onclick="_teSetTradeType('buy')"
            style="padding:9px;font-size:.80rem;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted);transition:all .15s"
            class="te-type-btn">📈 매수</button>
          <button id="te-tradetype-sell" onclick="_teSetTradeType('sell')"
            style="padding:9px;font-size:.80rem;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted);border-left:1px solid var(--border);transition:all .15s"
            class="te-type-btn">📉 매도</button>
        </div>

        <!-- 계좌 + 자산구분 -->
        <div>
          ${lbl('계좌',true)}
          <input type="hidden" id="te-acct" value=""/>
          <div id="te-acct-group" class="flex-wrap-gap4-mt"></div>
        </div>
        <div>
          ${lbl('자산 구분',false)}
          <input type="hidden" id="te-assettype" value="주식"/>
          <div id="te-assettype-group" class="flex-wrap-gap4-mt"></div>
        </div>

        <!-- 종목명 선택 (기초정보 등록 종목만) -->
        <div>
          ${lbl('종목명',true)}
          <div id="te-new-filter" style="display:none"></div>
          <div id="te-name-btns" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
          <div style="margin-top:2px">
            <div id="te-selected-name" style="display:none;padding:6px 10px;border-radius:6px;
              background:var(--s2);border:1px solid var(--border);font-size:.82rem;color:var(--text)"></div>
            <div id="te-no-ep-hint" style="display:none;font-size:.72rem;color:var(--muted);margin-top:4px">
              ⚠️ 기초정보 탭에서 종목을 먼저 등록해주세요
            </div>
          </div>
          <input type="hidden" id="te-name" value=""/>
          <input type="hidden" id="te-code" value=""/>
          <div id="te-code-status" style="margin-top:4px;font-size:.70rem;min-height:16px"></div>
        </div>

        <!-- 수량 + 날짜 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            ${lbl('수량',true)}
            ${inp('te-qty','100','number')}
          </div>
          <div>
            <label id="te-date-label" class="form-label">매수일자 *</label>
            <input id="te-date" type="date" class="input-full-82" style="width:100%;box-sizing:border-box"/>
          </div>
        </div>

        <!-- 단가 -->
        <div>
          <label id="te-price-label" class="form-label">매수단가 (원) *</label>
          ${inp('te-price','58000','number')}
        </div>

        <div>${lbl('메모',false)}${inp('te-memo','선택사항')}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--border)">
        <button onclick="closeTradeEdit()" class="btn-ghost-muted">취소</button>
        <button onclick="saveTrade()" class="btn-amber">💾 저장</button>
      </div>
    </div>
  </div>`;
}

function closeTradeEdit() {
  const el = $el('tradeEditOverlay');
  if (el) el.style.display = 'none';
  _editingTradeId = null;
}

// ── 저장 / 수정 ─────────────────────────────────────────────────

function saveTrade() {
  const f         = id => $el(id);
  const err       = f('te-error');
  const name      = f('te-name').value.trim();
  const qty       = parseInt(f('te-qty').value);
  const date      = f('te-date').value;
  const price     = parseFloat(f('te-price').value);
  const tradeType = window._currentTradeType || 'buy';

  const acctVal = f('te-acct').value;
  if (_teIsNewMode && !acctVal) { err.textContent='❌ 계좌를 선택해주세요'; err.style.display='block'; return; }
  if (!name)                      { err.textContent='❌ 종목명을 선택하세요'; err.style.display='block'; return; }
  // 기초정보 미등록 종목 차단
  const epCheck = getEP(normName(name) || name);
  if (!epCheck && !_editingTradeId) {
    err.textContent = '❌ 기초정보에 등록되지 않은 종목입니다. 기초정보 탭에서 먼저 등록해주세요';
    err.style.display = 'block'; return;
  }
  if (!qty || qty <= 0)           { err.textContent='❌ 수량을 입력하세요 (양수)'; err.style.display='block'; return; }
  if (!date)                      { err.textContent='❌ 날짜를 입력하세요'; err.style.display='block'; return; }
  if (isNaN(price) || price < 0) { err.textContent='❌ 단가를 입력하세요'; err.style.display='block'; return; }

  // 매도 시 현재 보유 수량 초과 체크
  if (tradeType === 'sell' && !_editingTradeId) {
    const acct = acctVal || '';
    const normN = normName(name) || name;
    // 현재 보유 수량 계산 (해당 계좌, 해당 종목)
    const currentQty = rawTrades
      .filter(t => t.name === normN && t.acct === acct)
      .reduce((s, t) => t.tradeType === 'buy' ? s + (t.qty||0) : s - (t.qty||0), 0);
    if (qty > currentQty) {
      err.textContent = `❌ 매도 수량(${qty})이 보유 수량(${currentQty})을 초과합니다`;
      err.style.display = 'block';
      return;
    }
    if (currentQty <= 0) {
      err.textContent = `❌ ${normN} 보유 수량이 없습니다`;
      err.style.display = 'block';
      return;
    }
  }

  const code  = f('te-code').value.trim();
  const normN = normName(name) || name;

  const trade = {
    id:        _editingTradeId || genTradeId(),
    tradeType,
    acct:      acctVal,
    assetType: f('te-assettype').value,
    name: normN, code, qty, price, date,
    memo: f('te-memo').value.trim(),
  };

  if (trade.assetType === '펀드' || trade.assetType === 'TDF') trade.fund = true;

  if (_editingTradeId) {
    const idx = rawTrades.findIndex(t => t.id === _editingTradeId);
    if (idx !== -1) rawTrades[idx] = trade;
  } else {
    rawTrades.push(trade);
  }

  // EDITABLE_PRICES 동기화 (우선 원칙 유지)
  const epIdx = EDITABLE_PRICES.findIndex(e => e.name === normN);
  if (epIdx === -1) {
    epPush(normN, code, trade.assetType);
    if (code) STOCK_CODE[normN] = code;
  } else {
    if (!EDITABLE_PRICES[epIdx].code && code) {
      EDITABLE_PRICES[epIdx].code = code;
      STOCK_CODE[normN] = code;
    }
    if (!EDITABLE_PRICES[epIdx].assetType && !EDITABLE_PRICES[epIdx].type && trade.assetType) {
      EDITABLE_PRICES[epIdx].assetType = trade.assetType;
    }
  }

  _commitTrades();
  closeTradeEdit();
}

function editTrade(id) {
  const t = rawTrades.find(t => t.id === id);
  if (t) openAddTrade(t);
}
