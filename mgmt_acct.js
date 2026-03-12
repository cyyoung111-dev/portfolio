function buildAcctMgmt() {
  const container = $el('acctMgmtList');
  if (!container) return;

  const accts = getAcctList();
  if (accts.length === 0) {
    container.innerHTML = `<div style="font-size:.72rem;color:var(--muted);padding:10px 0">등록된 계좌가 없습니다. ➕ 계좌 추가 버튼으로 계좌를 등록하세요.</div>`;
    return;
  }

  const sel      = container._selectedAcct || null;
  const editMode = container._editMode     || false;
  const inpStyle = `flex:1;background:var(--s2);border:1px solid var(--c-amber2-50);border-radius:6px;padding:5px 9px;color:var(--text);font-size:.75rem`;

  let html = `<div style="font-size:.70rem;color:var(--muted);margin-bottom:8px">계좌를 클릭하면 수정·삭제를 선택할 수 있습니다.</div>`;

  accts.forEach(acct => {
    const color    = ACCT_COLORS[acct] || 'var(--muted)';
    const tradeN   = rawTrades.filter(t => t.acct === acct).length;
    const hasData  = tradeN > 0 || rawHoldings.some(h => h.acct === acct);
    const isSel    = sel === acct;
    const isEdit   = isSel && editMode;

    // 읽기전용 행
    html += `<div class="acct-row" data-acct="${acct}"
      style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:6px;
             background:${isSel?'var(--c-purple-12)':'transparent'};cursor:pointer;
             border-bottom:1px solid var(--border);
             outline:${isSel?'1px solid var(--c-purple-45)':'none'};transition:all .15s">
      <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
      <span class="item-title">${acct}</span>
      <span class="lbl-64-muted">${hasData?`거래 ${tradeN}건`:'거래 없음'}</span>
    </div>`;

    if(isSel && !editMode) {
      // 수정·삭제 선택
      html += `<div class="gap-mb8">
        <button id="acctEditBtn" class="btn-edit-sm">✏️ 수정</button>
        <button id="acctDelBtn"  class="btn-del-sm">🗑 삭제</button>
        <button id="acctSelCancel" class="btn-cancel-sm">✕</button>
      </div>`;
    }
    if(isEdit) {
      // 수정 폼 — 계좌명 + 색상
      html += `<div style="padding:10px 12px;border-radius:8px;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.3);margin:0 0 8px 0">
        <div style="font-size:.65rem;color:var(--amber);font-weight:700;margin-bottom:8px">✏️ 계좌 수정</div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          <input id="acctEditName" type="text" value="${acct.replace(/"/g,'&quot;')}" style="${inpStyle}"
            onkeydown="if(event.key==='Enter')$el('acctSaveBtn')?.click(); if(event.key==='Escape')$el('acctEditCancel')?.click();" />
        </div>
        <div class="txt-65-muted-mb5">색상 선택</div>
        <div class="flex-wrap-g5-mb8">
          ${ACCT_PALETTE.map(c => {
            const rc = resolveColor(c);
            const rcur = resolveColor(color);
            const isCurSel = rc.toLowerCase() === rcur.toLowerCase();
            const usedByOther = Object.entries(ACCT_COLORS).filter(([k])=>k!==acct).some(([,v])=>v.toLowerCase()===rc.toLowerCase());
            return `<span onclick="acctChangeColor('${acct}','${c}')"
              style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
              border:3px solid ${isCurSel?'#fff':'transparent'};opacity:${usedByOther?'0.3':'1'};
              transition:border .1s,opacity .1s" title="${usedByOther?'다른 계좌 사용 중':''}"></span>`;
          }).join('')}
        </div>
        <div class="flex-gap6">
          <button id="acctSaveBtn" class="btn-purple-sm">💾 저장</button>
          <button id="acctEditCancel" class="btn-cancel-sm">✕ 취소</button>
        </div>
      </div>`;
    }
  });

  container.innerHTML = html;
  _bindAcctMgmtEvents(container);
}
function _bindAcctMgmtEvents(container) {
  container.querySelectorAll('.acct-row').forEach(row => {
    row.addEventListener('click', function() {
      const acct = this.dataset.acct;
      container._selectedAcct = (container._selectedAcct === acct && !container._editMode) ? null : acct;
      container._editMode = false;
      buildAcctMgmt();
    });
  });
  $el('acctEditBtn')?.addEventListener('click', function() {
    container._editMode = true;
    buildAcctMgmt();
    setTimeout(() => $el('acctEditName')?.focus(), 30);
  });
  $el('acctSaveBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const oldName  = container._selectedAcct;
    const newName  = ($el('acctEditName')?.value || '').trim();
    if(!newName) { showMgmtMsg('acctMgmtMsg','⚠️ 계좌명을 입력해주세요',true); return; }
    if(newName !== oldName && getAcctNames().includes(newName)) {
      showMgmtMsg('acctMgmtMsg',`❌ "${newName}" 계좌는 이미 존재합니다`,true); return;
    }
    if(newName !== oldName) {
      const idx = ACCT_ORDER.indexOf(oldName);
      if(idx > -1) ACCT_ORDER[idx] = newName;
      if(ACCT_COLORS[oldName] !== undefined) { ACCT_COLORS[newName] = ACCT_COLORS[oldName]; delete ACCT_COLORS[oldName]; }
      rawTrades.forEach(t   => { if(t.acct === oldName)   t.acct = newName; });
      rawHoldings.forEach(h => { if(h.acct === oldName)   h.acct = newName; });
      saveAcctOrder(); saveAcctColors(); saveHoldings();
    }
    showMgmtMsg('acctMgmtMsg', `✅ "${newName}" 저장됐습니다`, false);
    container._selectedAcct = newName;
    container._editMode = false;
    buildAcctMgmt();
    _mgmtRefresh();
  });
  $el('acctEditCancel')?.addEventListener('click', function() {
    container._editMode = false;
    buildAcctMgmt();
  });
  $el('acctDelBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const acctSnap = container._selectedAcct;
    deleteAcct(acctSnap);
  });
  $el('acctSelCancel')?.addEventListener('click', function() {
    container._selectedAcct = null;
    container._editMode = false;
    buildAcctMgmt();
  });
}

function acctMgmtAddNew() {
  const wrap = $el('acctMgmtNewWrap');
  if (wrap) { wrap.style.display = 'block'; }
  const inp = $el('acctMgmtNewInput');
  if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 50); }
  // 사용하지 않는 색상 자동 배정 후 팔레트 렌더링
  const used = Object.values(ACCT_COLORS).map(c => resolveColor(c).toLowerCase());
  const autoColor = ACCT_PALETTE.find(c => !used.includes(resolveColor(c).toLowerCase())) || ACCT_PALETTE[Object.keys(ACCT_COLORS).length % ACCT_PALETTE.length];
  const colorInput = $el('acctMgmtNewColor');
  if (colorInput) colorInput.value = autoColor;
  const preview = $el('acctNewColorPreview');
  if (preview) preview.style.background = autoColor;
  const dotsWrap = $el('acctNewColorDots');
  if (dotsWrap) {
    dotsWrap.innerHTML = ACCT_PALETTE.map(c => {
      const isUsed = used.includes(resolveColor(c).toLowerCase()) && resolveColor(c).toLowerCase() !== resolveColor(autoColor).toLowerCase();
      const isSelected = resolveColor(c).toLowerCase() === resolveColor(autoColor).toLowerCase();
      return `<span onclick="_acctNewPickColor('${c}')"
        style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
        border:3px solid ${isSelected?'#fff':'transparent'};
        opacity:${isUsed?'0.3':'1'};
        transition:border .1s,opacity .1s" title="${isUsed?'사용 중':''}"></span>`;
    }).join('');
  }
}
function _acctNewPickColor(c) {
  const colorInput = $el('acctMgmtNewColor');
  if (colorInput) colorInput.value = c;
  const preview = $el('acctNewColorPreview');
  if (preview) preview.style.background = c;
  const used = Object.values(ACCT_COLORS).map(v => resolveColor(v).toLowerCase());
  const dotsWrap = $el('acctNewColorDots');
  if (dotsWrap) {
    dotsWrap.querySelectorAll('span').forEach((dot, i) => {
      const dc = ACCT_PALETTE[i];
      const isSelected = resolveColor(dc).toLowerCase() === resolveColor(c).toLowerCase();
      const isUsed = used.includes(resolveColor(dc).toLowerCase()) && !isSelected;
      dot.style.border = `3px solid ${isSelected?'#fff':'transparent'}`;
      dot.style.opacity = isUsed ? '0.3' : '1';
    });
  }
}

function acctMgmtConfirm() {
  const inp = $el('acctMgmtNewInput');
  const name = (inp?.value || '').trim();
  if (!name) { showMgmtMsg('acctMgmtMsg','⚠️ 계좌명을 입력해주세요',true); inp?.focus(); return; }
  if (getAcctNames().includes(name)) {
    showMgmtMsg('acctMgmtMsg',`❌ "${name}" 계좌는 이미 존재합니다`,true); inp.select(); return;
  }
  // 팔레트에서 선택한 색상 우선 적용
  const pickedColor = $el('acctMgmtNewColor')?.value;
  if (pickedColor && !ACCT_COLORS[name]) {
    ACCT_COLORS[name] = resolveColor(pickedColor); // ★ 원칙3
    saveAcctColors();
  }
  getOrAssignColor(name); // 미지정 시 자동 배정 fallback + saveAcctColors
  if (!ACCT_ORDER.includes(name)) { ACCT_ORDER.push(name); saveAcctOrder(); }
  showMgmtMsg('acctMgmtMsg',`✅ "${name}" 계좌가 추가됐습니다`,false);
  setTimeout(() => acctMgmtCancel(), 900);
  buildAcctMgmt();
  _refreshTeAcctList(null);
  _mgmtRefresh();
}

function acctMgmtCancel() {
  const wrap = $el('acctMgmtNewWrap');
  if (wrap) wrap.style.display = 'none';
  const inp = $el('acctMgmtNewInput');
  if (inp) inp.value = '';
  const c = $el('acctMgmtNewColor'); if (c) c.value = '';
  const dotsWrap = $el('acctNewColorDots'); if (dotsWrap) dotsWrap.innerHTML = '';
}

function acctChangeColor(acct, color) {
  const hexColor = resolveColor(color); // ★ 원칙3: 먼저 hex로 변환
  // 다른 계좌가 이미 쓰는 색상이면 차단
  const usedByOther = Object.entries(ACCT_COLORS)
    .filter(([k]) => k !== acct)
    .some(([, v]) => v.toLowerCase() === hexColor.toLowerCase());
  if(usedByOther) {
    showMgmtMsg('acctMgmtMsg','❌ 다른 계좌에서 이미 사용 중인 색상입니다',true);
    return;
  }
  ACCT_COLORS[acct] = hexColor;
  saveAcctColors();
  // 수정 모드 유지하며 재렌더
  buildAcctMgmt();
  _mgmtRefresh();
}

function deleteAcct(acct) {
  // confirm 전에 계좌명 스냅샷
  const snapAcct = acct;
  const hasTrades   = rawTrades.some(t => t.acct === snapAcct);
  const hasHoldings = rawHoldings.some(h => h.acct === snapAcct);
  if (hasTrades || hasHoldings) {
    showMgmtMsg('acctMgmtMsg',`❌ "${snapAcct}" 계좌에 거래 이력이 있어 삭제할 수 없습니다`,true);
    return;
  }
  if (!confirm(`"${snapAcct}" 계좌를 삭제할까요?`)) return;
  // confirm 후 스냅샷 기준으로 처리
  delete ACCT_COLORS[snapAcct];
  saveAcctColors();
  const idx = ACCT_ORDER.indexOf(snapAcct);
  if (idx > -1) ACCT_ORDER.splice(idx, 1);
  saveAcctOrder();
  const c2 = $el('acctMgmtList');
  if(c2) c2._selectedAcct = null;
  buildAcctMgmt();
  _mgmtRefresh();
}

// ── 부동산 편집
function openRealEstateEditor() {
  $el('re-name').value     = REAL_ESTATE.name || '';
  $el('re-value').value    = REAL_ESTATE.currentValue || '';
  $el('re-purchase').value = REAL_ESTATE.purchasePrice || '';
  $el('re-tax').value      = REAL_ESTATE.taxCost || '';
  $el('re-interior').value = REAL_ESTATE.interiorCost || '';
  $el('re-etc').value      = REAL_ESTATE.etcCost || '';
  $el('re-memo').value     = REAL_ESTATE.memo || '';
  updateRePreview();
  $el('realEstateEditor').classList.add('open');
}

function closeRealEstateEditor() {
  $el('realEstateEditor').classList.remove('open');
}

function updateRePreview() {
  const val      = parseInt($el('re-value')?.value) || 0;
  const pur      = parseInt($el('re-purchase')?.value) || 0;
  const tax      = parseInt($el('re-tax')?.value) || 0;
  const interior = parseInt($el('re-interior')?.value) || 0;
  const etc      = parseInt($el('re-etc')?.value) || 0;
  const prev = $el('re-preview');
  const cont = $el('re-preview-content');
  if(!prev || !cont) return;

  if(val > 0 || pur > 0) {
    prev.style.display = '';
    const totalCost  = pur + tax + interior + etc;  // 총 지출
    const extraCost  = tax + interior + etc;
    const pnlSimple  = pur > 0 ? val - pur : null;            // 매입가 대비
    const pnlTotal   = totalCost > 0 ? val - totalCost : null; // 총 지출 대비
    const loanBal    = LOAN.balance;
    const safeRows   = Array.isArray(rows) ? rows : [];
    const invest     = safeRows.reduce((s,r)=>s+(r.evalAmt||0), 0);
    const net        = invest + val - loanBal;
    const ltv        = val > 0 ? (loanBal/val*100).toFixed(1) : null;

    let h = '<div style="display:flex;flex-direction:column;gap:6px">';

    // 비용 구성
    if(totalCost > 0) {
      h += '<div style="background:var(--c-black-20);border-radius:6px;padding:8px;font-size:.70rem">'
         + '<div style="color:var(--muted);margin-bottom:5px;font-weight:700">💸 총 지출 내역</div>'
         + '<div style="display:grid;grid-template-columns:1fr auto;gap:3px 10px">';
      if(pur > 0)      h += '<span class="c-muted">매입가</span><span class="td-right">' + fmt(pur) + '</span>';
      if(tax > 0)      h += '<span class="c-muted">취득세·세금</span><span class="txt-red-right">+ ' + fmt(tax) + '</span>';
      if(interior > 0) h += '<span class="c-muted">인테리어</span><span class="txt-red-right">+ ' + fmt(interior) + '</span>';
      if(etc > 0)      h += '<span class="c-muted">기타</span><span class="txt-red-right">+ ' + fmt(etc) + '</span>';
      if(totalCost > 0) h += '<span style="color:var(--text);font-weight:700;border-top:1px solid var(--c-white-10);padding-top:4px">합계</span>'
                           + '<span style="text-align:right;font-weight:700;color:var(--amber);border-top:1px solid var(--c-white-10);padding-top:4px">' + fmt(totalCost) + '</span>';
      h += '</div></div>';
    }

    // 손익 비교
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    if(val > 0) {
      h += '<div><span class="txt-muted-68">현재 실거래가</span><br><b class="c-amber">' + fmt(val) + '</b></div>';
    }
    if(pnlSimple !== null) {
      const c = pColor(pnlSimple);
      h += '<div><span class="txt-muted-68">매입가 대비</span><br><b style="color:' + c + '">' + (pSign(pnlSimple)) + fmt(pnlSimple) + '</b></div>';
    }
    if(pnlTotal !== null && extraCost > 0) {
      const c = pColor(pnlTotal);
      h += '<div><span class="txt-muted-68">총 지출 대비 손익</span><br><b style="color:' + c + '">' + (pSign(pnlTotal)) + fmt(pnlTotal) + '</b></div>';
    }
    if(ltv) {
      h += '<div><span class="txt-muted-68">LTV</span><br><b class="c-text">' + ltv + '%</b></div>';
    }
    h += '<div><span class="txt-muted-68">순자산 (반영 후)</span><br><b class="c-cyan">' + fmt(net) + '</b></div>';
    h += '</div>';
    h += '</div>';
    cont.innerHTML = h;
  } else {
    prev.style.display = 'none';
  }
}

function applyRealEstate() {
  const val      = parseInt($el('re-value')?.value) || 0;
  const pur      = parseInt($el('re-purchase')?.value) || 0;
  const tax      = parseInt($el('re-tax')?.value) || 0;
  const interior = parseInt($el('re-interior')?.value) || 0;
  const etc      = parseInt($el('re-etc')?.value) || 0;
  const name     = $el('re-name')?.value?.trim() || '보유 부동산';
  const memo     = $el('re-memo')?.value?.trim() || '';

  REAL_ESTATE.currentValue  = val;
  REAL_ESTATE.purchasePrice = pur;
  REAL_ESTATE.taxCost       = tax;
  REAL_ESTATE.interiorCost  = interior;
  REAL_ESTATE.etcCost       = etc;
  REAL_ESTATE.name          = name;
  REAL_ESTATE.memo          = memo;
  saveRealEstate();
  saveHoldings();
  renderSummary();
  renderView();
  closeRealEstateEditor();
}

