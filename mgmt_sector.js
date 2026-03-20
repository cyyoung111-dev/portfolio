// ════════════════════════════════════════════════════════════════
//  mgmt_sector.js — 섹터 관리 (추가·수정·삭제·CSV)
//  의존: data.js, mgmt_stock.js (buildStockMgmt 호출)
// ════════════════════════════════════════════════════════════════
function buildSectorMgmt() {
  const container = $el('sectorMgmtBody');
  if(!container) return;

  const selIdx   = container._selectedIdx ?? null;
  const editMode = container._editMode    ?? false;
  const sectors  = Object.keys(SECTOR_COLORS);

  let html = `<div class="lbl-62-muted-3">섹터를 클릭하면 수정·삭제를 선택할 수 있습니다.</div>`;

  sectors.forEach((sec, idx) => {
    const color        = SECTOR_COLORS[sec] || 'var(--muted)';
    const isSel        = selIdx === idx;
    const isEdit       = isSel && editMode;
    const stockCount   = EDITABLE_PRICES.filter(i => (i.sector || '기타') === sec).length;

    if(!isEdit) {
      // ── 읽기전용 행 (계좌 목록 스타일)
      html += `<div class="sec-row" data-idx="${idx}"
        style="display:flex;align-items:center;gap:10px;padding:7px 10px;
               background:${isSel?'var(--c-purple-12)':'var(--s2)'};border-bottom:1px solid var(--border);cursor:pointer;
               border:1px solid ${isSel?'var(--c-purple-45)':'transparent'};transition:all .15s">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span class="item-title">${sec}</span>
        <span class="lbl-64-muted">${stockCount ? `종목 ${stockCount}개` : '종목 없음'}</span>
      </div>`;
    } else {
      // ── 수정 모드 행 (인풋 활성화)
      html += `<div class="sec-row" data-idx="${idx}"
        style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;
               background:var(--c-purple-10);border-bottom:1px solid var(--border);cursor:pointer;
               border:1px solid var(--c-purple-45);transition:all .15s">
        <input type="color" class="sec-color-inp" data-idx="${idx}" value="${color}"
          style="width:28px;height:28px;border:1px solid var(--c-purple-40);border-radius:50%;padding:2px;background:var(--s2);cursor:pointer;flex-shrink:0" />
        <input type="text" class="sec-name-inp inp-mgmt-base" data-idx="${idx}" value="${sec.replace(/"/g,'&quot;')}" />
      </div>`;
    }

    if(isSel) {
      if(!editMode) {
        // 수정·삭제 선택 바
        const affectedCount = EDITABLE_PRICES.filter(i => i.sector === sec).length;
        html += `<div class="gap-mb8">
          <button id="secEditBtn"
            class="btn-edit-sm">✏️ 수정</button>
          <button id="secDelBtn"
            class="btn-del-sm">🗑 삭제${affectedCount?` (종목 ${affectedCount}개 영향)`:''}</button>
          <button id="secSelCancel"
            class="btn-cancel-sm">✕</button>
        </div>`;
      } else {
        // 수정 모드 저장/취소
        html += `<div style="display:flex;gap:6px;margin:0 0 8px 4px;align-items:center">
          <span class="lbl-64-muted">● 색상 클릭으로 변경</span>
          <button id="secSaveBtn"
            class="btn-purple-sm-700">💾 저장</button>
          <button id="secEditCancel"
            class="btn-cancel-sm">✕ 취소</button>
        </div>`;
      }
    }
  });

  container.innerHTML = html;
  _bindSectorMgmtEvents(container);
}
function _bindSectorMgmtEvents(container) {
  container.querySelectorAll('.sec-row').forEach(row => {
    row.addEventListener('click', function(e) {
      if(e.target.classList.contains('sec-name-inp') && container._editMode) return;
      if(e.target.classList.contains('sec-color-inp') && container._editMode) return;
      const idx = parseInt(this.dataset.idx);
      if(container._selectedIdx === idx && !container._editMode) {
        container._selectedIdx = null;
      } else {
        container._selectedIdx = idx;
        container._editMode = false;
      }
      buildSectorMgmt();
    });
  });
  $el('secEditBtn')?.addEventListener('click', function() {
    container._editMode = true;
    buildSectorMgmt();
    const ni = container.querySelector('.sec-name-inp[data-idx="'+container._selectedIdx+'"]');
    if(ni) { ni.focus(); }
  });
  $el('secSaveBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const saved = secSave(container._selectedIdx);
    if(saved === false) return;
    showMgmtMsg('secMgmtMsg', '✅ 섹터가 저장됐습니다', false);
    container._editMode = false;
    container._selectedIdx = null;
    buildSectorMgmt();
  });
  $el('secEditCancel')?.addEventListener('click', function() {
    container._editMode = false;
    buildSectorMgmt();
  });
  $el('secDelBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const idxSnap = container._selectedIdx;
    secDelete(idxSnap);
  });
  $el('secSelCancel')?.addEventListener('click', function() {
    container._selectedIdx = null;
    container._editMode = false;
    buildSectorMgmt();
  });
}

// 섹터 즉시 저장 (data-idx 기반, DOM 재생성 없음)
function secSave(idx) {
  const sectors = Object.keys(SECTOR_COLORS);
  const oldName = sectors[idx];
  if(oldName === undefined) return;

  // 현재 입력값 읽기 (data-idx 속성으로 찾기)
  const nameEl  = document.querySelector(`.sec-name-inp[data-idx="${idx}"]`);
  const colorEl = document.querySelector(`.sec-color-inp[data-idx="${idx}"]`);
  const newName  = (nameEl?.value || '').trim();
  const newColor = colorEl?.value || 'var(--muted)';
  if(!newName) return;

  // 색상 중복 체크 (자기 자신 제외)
  const usedColors = Object.entries(SECTOR_COLORS)
    .filter(([k]) => k !== oldName)
    .map(([, v]) => v.toLowerCase());
  if(usedColors.includes(newColor.toLowerCase())) {
    showMgmtMsg('secMgmtMsg','❌ 이미 사용 중인 색상입니다',true);
    if(colorEl) colorEl.value = SECTOR_COLORS[oldName] || 'var(--muted)';
    return false;
  }

  if(newName !== oldName) {
    delete SECTOR_COLORS[oldName];
    // SECTOR_MAP은 더 이상 진실소스 아님 — EDITABLE_PRICES만 업데이트
    EDITABLE_PRICES.forEach(i => { if(i.sector === oldName) i.sector = newName; });
  }
  SECTOR_COLORS[newName] = resolveColor(newColor); // ★ 원칙3: var()→hex 변환
  // ★ rawHoldings sector 즉시 재생성 → GAS syncHoldings에 최신 내용 전송
  syncHoldingsFromTrades();
  saveHoldings();
  queueMgmtGsheetSync();
  _mgmtRefresh();
  // buildSectorMgmt 재호출은 저장 버튼 핸들러에서 처리
}

// 섹터 삭제 (idx 기반 — 섹터명 파라미터 특수문자 오류 방지)
function secDelete(idx) {
  const sectors = Object.keys(SECTOR_COLORS);
  // confirm 전에 섹터명 스냅샷
  const snapSec = sectors[idx];
  if(snapSec === undefined) return;
  if(!confirm(`"${snapSec}" 섹터를 삭제할까요?\n해당 섹터의 종목은 모두 "기타"로 이동합니다.`)) return;
  // confirm 후 섹터명 기준으로 처리 (idx 변동 무관)
  if(!(snapSec in SECTOR_COLORS)) return;
  delete SECTOR_COLORS[snapSec];
  // EDITABLE_PRICES 섹터 일괄 업데이트
  EDITABLE_PRICES.forEach(i => { if(i.sector === snapSec) i.sector = '기타'; });
  const sc = $el('sectorMgmtBody');
  if(sc) sc._selectedIdx = null;
  _commitTrades(); // sync + save + refreshAll
  queueMgmtGsheetSync();
  _mgmtRefresh();
  buildSectorMgmt(); buildStockMgmt();
}

// 섹터 추가

function _getSectorPalette() {
  return typeof ACCT_PALETTE !== 'undefined' ? ACCT_PALETTE : [
    'var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)',
    'var(--pink)','var(--cyan)','var(--gold2)','#84cc16','var(--purple-lt)',
    '#f97316','#06b6d4','#8b5cf6','#ec4899','#14b8a6',
    '#a3e635','#fb923c','#38bdf8','#c084fc','#f43f5e'
  ];
}

function _secAutoColor() {
  const palette = _getSectorPalette();
  const used = new Set(Object.values(SECTOR_COLORS).map(c => c.toLowerCase()));
  const pick = palette.find(c => !used.has(resolveColor(c).toLowerCase()));
  if(pick) return resolveColor(pick);
  let rand; let tries = 0;
  do {
    rand = '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0');
    tries++;
  } while(used.has(rand.toLowerCase()) && tries < 50);
  return rand;
}

function _renderSecNewColorDots(selectedColor) {
  const palette = _getSectorPalette();
  const used = Object.values(SECTOR_COLORS).map(c => c.toLowerCase());
  const preview = $el('secNewColorPreview');
  if(preview) preview.style.background = selectedColor;
  const colorInput = $el('secMgmtNewColor');
  if(colorInput) colorInput.value = selectedColor;
  const dotsWrap = $el('secNewColorDots');
  if(!dotsWrap) return;
  dotsWrap.innerHTML = palette.map(c => {
    const resolved = resolveColor(c);
    const isUsed = used.includes(resolved.toLowerCase());
    const isSelected = resolved.toLowerCase() === resolveColor(selectedColor).toLowerCase();
    return `<span data-color="${c}"
      style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;
      border:3px solid ${isSelected?'#fff':'transparent'};
      opacity:${isUsed && !isSelected?'0.3':'1'};
      transition:border .1s,opacity .1s" title="${isUsed && !isSelected?'사용 중':''}"></span>`;
  }).join('');
  dotsWrap.querySelectorAll('span').forEach(dot => {
    dot.addEventListener('click', () => _secNewPickColor(dot.dataset.color));
  });
}

function _secNewPickColor(c) {
  const used = Object.values(SECTOR_COLORS).map(col => col.toLowerCase());
  const resolved = resolveColor(c);
  if(used.includes(resolved.toLowerCase())) {
    showMgmtMsg('secMgmtMsg','❌ 다른 섹터에서 이미 사용 중인 색상입니다',true);
    return;
  }
  _renderSecNewColorDots(c);
}

// 섹터 추가 팝업 열기/닫기/확인
function secMgmtAddNew() {
  const wrap = $el('secMgmtNewWrap');
  if(wrap) { wrap.style.display = 'block'; }
  const autoColor = _secAutoColor();
  _renderSecNewColorDots(autoColor);
  setTimeout(() => $el('secMgmtNewName')?.focus(), 50);
}
function secMgmtCancel() {
  const wrap = $el('secMgmtNewWrap');
  if(wrap) wrap.style.display = 'none';
  const n = $el('secMgmtNewName'); if(n) n.value = '';
  const c = $el('secMgmtNewColor'); if(c) c.value = '';
}
function secMgmtConfirm() {
  const name  = ($el('secMgmtNewName')?.value || '').trim();
  const color = $el('secMgmtNewColor')?.value || _secAutoColor();
  if(!name) { showMgmtMsg('secMgmtMsg','⚠️ 섹터명을 입력해주세요',true); return; }
  if(SECTOR_COLORS[name] !== undefined) { showMgmtMsg('secMgmtMsg',`❌ "${name}"은(는) 이미 존재하는 섹터입니다`,true); return; }
  const usedColors = Object.values(SECTOR_COLORS).map(c => c.toLowerCase());
  const resolved = resolveColor(color);
  if(usedColors.includes(resolved.toLowerCase())) {
    showMgmtMsg('secMgmtMsg','❌ 다른 섹터에서 이미 사용 중인 색상입니다',true); return;
  }
  SECTOR_COLORS[name] = resolved;
  syncHoldingsFromTrades();
  saveHoldings();
  queueMgmtGsheetSync();
  _mgmtRefresh();
  buildSectorMgmt();
  buildStockMgmt();
  showMgmtMsg('secMgmtMsg',`✅ "${name}" 섹터가 추가됐습니다`,false);
  setTimeout(() => secMgmtCancel(), 900);
}

// ── 섹터 양식 다운로드
function secCsvDownloadTemplate() {
  if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
  const wb  = XLSX.utils.book_new();
  const rows = [
    ['섹터명', '색상(hex)'],
    ['반도체', '#10b981'],
    ['해외주식', '#3b82f6'],
    ['금융', '#f59e0b'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:20},{wch:14}];
  ['A1','B1'].forEach(cell => {
    if (!ws[cell]) return;
    ws[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  XLSX.utils.book_append_sheet(wb, ws, '섹터관리');
  XLSX.writeFile(wb, '섹터관리_업로드양식.xlsx');
  showToast('📥 섹터 양식 다운로드 완료', 'ok');
}

// ── 섹터 xlsx/csv 업로드 처리
function secCsvImport(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  parseUploadFile(file, (headers, rows) => {
    const col = {
      name:  headers.findIndex(h => h === '섹터명'),
      color: headers.findIndex(h => h === '색상(hex)'),
    };
    if (col.name === -1) { showToast('❌ "섹터명" 컬럼이 없습니다', 'error'); return; }

    let added = 0, skipped = 0, updated = 0;
    rows.forEach(cols => {
      const name  = col.name  >= 0 ? (cols[col.name]  || '').trim() : '';
      const color = col.color >= 0 ? (cols[col.color] || '').trim() : '';
      if (!name) { skipped++; return; }

      const resolvedColor = color && /^#[0-9a-fA-F]{3,6}$/.test(color)
        ? color
        : _secAutoColor();

      if (SECTOR_COLORS[name] !== undefined) {
        // 이미 존재하면 색상만 업데이트
        if (color) SECTOR_COLORS[name] = resolvedColor;
        updated++;
      } else {
        SECTOR_COLORS[name] = resolvedColor;
        added++;
      }
    });

    saveHoldings();
    queueMgmtGsheetSync();
    buildSectorMgmt();
    buildStockMgmt();
    const msg = `✅ ${added}건 추가, ${updated}건 업데이트` + (skipped ? `, ${skipped}건 건너뜀` : '');
    showToast(msg, 'ok');
    showMgmtMsg('secMgmtMsg', msg, false);
  });
}

// 수정 모드 유형/섹터 토글 버튼 클릭 핸들러