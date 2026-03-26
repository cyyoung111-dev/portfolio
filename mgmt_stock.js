// ════════════════════════════════════════════════════════════════
//  mgmt_stock.js — 종목 관리 (추가·수정·삭제·CSV)
//  의존: data.js
// ════════════════════════════════════════════════════════════════
function buildStockMgmt() {
  const container = $el('stockMgmtBody');
  if(!container) return;

  const SM_SECTORS = [...new Set([...Object.keys(SECTOR_COLORS), '기타'])];
  const secOpts  = (sel) => SM_SECTORS.map(s=>`<option value="${s}" ${sel===s?'selected':''}>${s}</option>`).join('');
  const selIdx    = container._selectedIdx ?? null;
  const editMode  = container._editMode    ?? false;

  // ── 정렬 상태 (container에 보존)
  if(!container._sortKey) container._sortKey = 'default'; // 'default' | 'name' | 'sector'

  // ── 정렬된 인덱스 배열 생성 (원본 EDITABLE_PRICES 순서는 변경 안 함)
  let sortedIndices = EDITABLE_PRICES.map((_, i) => i);
  if(container._sortKey === 'name') {
    sortedIndices.sort((a, b) => EDITABLE_PRICES[a].name.localeCompare(EDITABLE_PRICES[b].name, 'ko'));
  } else if(container._sortKey === 'sector') {
    sortedIndices.sort((a, b) => {
      const sa = EDITABLE_PRICES[a].sector || '기타';
      const sb = EDITABLE_PRICES[b].sector || '기타';
      const cmp = sa.localeCompare(sb, 'ko');
      return cmp !== 0 ? cmp : EDITABLE_PRICES[a].name.localeCompare(EDITABLE_PRICES[b].name, 'ko');
    });
  }

  const sortActv = (key) => container._sortKey === key ? ' active' : '';

  // 정렬 컨트롤을 별도 div에 렌더링 (스크롤 영역 밖)
  const sortDiv = $el('stockMgmtSort');
  if (sortDiv) {
    sortDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:.65rem;color:var(--muted);font-weight:600;letter-spacing:.05em">정렬:</span>
      <button id="smSort_default" class="btn-sort-toggle${sortActv('default')}">기본순</button>
      <button id="smSort_name"    class="btn-sort-toggle${sortActv('name')}">이름순 🔤</button>
      <button id="smSort_sector"  class="btn-sort-toggle${sortActv('sector')}">섹터순 📂</button>
      <span style="font-size:.65rem;color:var(--muted);margin-left:4px">(총 ${EDITABLE_PRICES.length}종목)</span>
    </div>`;
  }

  let html = `<div class="lbl-62-muted-3">종목을 클릭하면 수정·삭제를 선택할 수 있습니다.</div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 80px 72px 120px;gap:4px;align-items:center;margin-bottom:4px;padding:0 4px">
    <span style="font-size:.65rem;color:var(--muted);font-weight:700">종목명</span>
    <span class="lbl-65-muted-center">종목코드</span>
    <span class="lbl-65-muted-center">유형</span>
    <span class="lbl-65-muted-center">섹터</span>
  </div>`;
  const atOpts = (sel) => ['주식','ETF','ISA','IRP','연금','펀드','TDF'].map(t=>`<option value="${t}" ${sel===t?'selected':''}>${t}</option>`).join('');

  // 섹터별 구분선 표시용 (섹터 정렬 시)
  let lastSector = null;

  sortedIndices.forEach((idx) => {
    const item = EDITABLE_PRICES[idx];
    const sec    = item.sector || '기타';
    const isSel  = selIdx === idx;
    const isEdit = isSel && editMode;

    // 섹터순 정렬 시 섹터 구분 헤더 삽입
    if(container._sortKey === 'sector' && sec !== lastSector) {
      const secColor = SECTOR_COLORS[sec] || 'var(--muted)';
      html += `<div style="font-size:.65rem;font-weight:700;color:${secColor};padding:6px 4px 2px;margin-top:${lastSector===null?'0':'8px'};border-bottom:1px solid ${secColor}33;letter-spacing:.06em">📂 ${sec}</div>`;
      lastSector = sec;
    }

    const curType = item.assetType || item.type || '주식';
    html += `<div class="sm-row" data-idx="${idx}"
      style="display:grid;grid-template-columns:1fr 80px 72px 72px;gap:5px;align-items:center;padding:4px;
             border-radius:${isEdit?'6px 6px 0 0':'6px'};border:1px solid ${isSel?'var(--c-purple-45)':'transparent'};
             border-bottom:${isEdit?'1px solid var(--c-purple-20)':'1px solid ' + (isSel?'var(--c-purple-45)':'transparent')};
             background:${isSel?'var(--c-purple-10)':'transparent'};margin-bottom:${isEdit?'0':'3px'};cursor:pointer;transition:all .15s">
      <input type="text" class="sm-name-inp ${isEdit?'inp-mgmt-base':'inp-mgmt-lock'}" data-idx="${idx}" value="${item.name.replace(/"/g,'&quot;')}"
        ${isEdit?'':'readonly tabindex="-1"'} />
      <input type="text" class="sm-code-inp ${isEdit?'inp-mgmt-base':'inp-mgmt-lock'}" data-idx="${idx}" value="${item.code||''}"
        style="font-family:'Courier New',monospace;text-align:center" maxlength="6" ${isEdit?'':'readonly tabindex="-1"'} />
      <span class="txt-muted-68">${curType}</span>
      <span class="txt-muted-68" style="overflow:hidden;text-overflow:ellipsis">${sec}</span>
    </div>`;

    if(isEdit) {
      html += `<div style="border:1px solid var(--c-purple-45);border-top:none;border-radius:0 0 6px 6px;background:var(--c-purple-06);padding:10px 10px 8px;margin-bottom:6px">
        <input type="hidden" class="sm-type-sel" data-idx="${idx}" value="${curType}"/>
        <input type="hidden" class="sm-sec-sel" data-idx="${idx}" value="${sec}"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div class="lbl-60-muted" class="fw7-mb5-ls">유형</div>
            <div class="sm-type-grp flex-wrap-gap3" data-idx="${idx}">
              ${ ['주식','ETF','ISA','IRP','연금','펀드','TDF'].map(t=>
                `<button type="button" onclick="_smPickType(${idx},'${t}')" class="btn-toggle-purple-sm${t===curType?' active':''}">${t}</button>`).join('') }
            </div>
          </div>
          <div>
            <div class="lbl-60-muted" class="fw7-mb5-ls">섹터</div>
            <div class="sm-sec-grp flex-wrap-gap3" data-idx="${idx}">
              ${ SM_SECTORS.map(s=>
                `<button type="button" onclick="_smPickSec(${idx},'${s}')" class="btn-toggle-purple-sm${s===sec?' active':''}">${s}</button>`).join('') }
            </div>
          </div>
        </div>
        <div class="gap-mb6" style="margin-top:8px">
          <button id="smSaveBtn" class="btn-purple-sm-700">💾 저장</button>
          <button id="smEditCancel" class="btn-cancel-sm">✕ 취소</button>
        </div>
      </div>`;
    }

    if(isSel && !editMode) {
      html += `<div class="gap-mb6">
        <button id="smEditBtn"
          class="btn-edit-sm">✏️ 수정</button>
        <button id="smDelBtn"
          class="btn-del-sm">🗑 삭제</button>
        <button id="smSelCancel"
          class="btn-cancel-sm">✕</button>
      </div>`;
    }
  });

  container.innerHTML = html;
  _bindStockMgmtEvents(container);
}
function _bindStockMgmtEvents(container) {
  ['default','name','sector'].forEach(key => {
    $el(`smSort_${key}`)?.addEventListener('click', function() {
      container._sortKey = key;
      container._selectedIdx = null;
      container._editMode = false;
      buildStockMgmt();
    });
  });
  container.querySelectorAll('.sm-row').forEach(row => {
    row.addEventListener('click', function(e) {
      if(container._editMode && ['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
      const idx = parseInt(this.dataset.idx);
      if(container._selectedIdx === idx && !container._editMode) {
        container._selectedIdx = null;
      } else {
        container._selectedIdx = idx;
        container._editMode = false;
      }
      buildStockMgmt();
    });
  });
  $el('smEditBtn')?.addEventListener('click', function() {
    container._editMode = true;
    buildStockMgmt();
    container.querySelector('.sm-name-inp[data-idx="'+container._selectedIdx+'"]')?.focus();
  });
  $el('smSaveBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    smSave(container._selectedIdx);
    container._editMode = false;
    container._selectedIdx = null;
    buildStockMgmt(); // ★ 상태 리셋 후 호출 → 편집 폼 없이 목록만 렌더링
    showMgmtMsg('smMgmtMsg', '✅ 종목이 저장됐습니다', false);
  });
  $el('smEditCancel')?.addEventListener('click', function() {
    container._editMode = false;
    buildStockMgmt();
  });
  $el('smDelBtn')?.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const idxSnap = container._selectedIdx;
    smDelete(idxSnap);
  });
  $el('smSelCancel')?.addEventListener('click', function() {
    container._selectedIdx = null;
    container._editMode = false;
    buildStockMgmt();
  });
}
// 즉시 삭제 + 저장
function smDelete(idx) {
  if(idx === null || idx === undefined) return;
  // confirm 전에 스냅샷 (DOM 재렌더 후에도 안전)
  const snapItem = EDITABLE_PRICES[idx] ? {...EDITABLE_PRICES[idx]} : null;
  if(!snapItem) return;
  const tradeCount = rawTrades.filter(t => t.name === snapItem.name).length;
  const warnMsg = tradeCount > 0
    ? `⚠️ 거래 이력 ${tradeCount}건이 있습니다.\n기초정보에서 삭제해도 거래 이력은 유지됩니다.\n\n`
    : '';
  if(!confirm(`${warnMsg}"${snapItem.name}" 을(를) 기초정보에서 삭제할까요?`)) return;
  // name 기준으로 재탐색 (confirm 동안 idx 밀렸을 수 있음)
  const realIdx = EDITABLE_PRICES.findIndex(e => e.name === snapItem.name);
  if(realIdx === -1) return;
  if(snapItem.code) delete STOCK_CODE[snapItem.name];
  EDITABLE_PRICES.splice(realIdx, 1);
  const sc2 = $el('stockMgmtBody');
  if(sc2) sc2._selectedIdx = null;
  // ※ _commitTrades() 대신 saveHoldings() 직접 호출
  // 이유: _commitTrades → syncHoldingsFromTrades가 rawTrades 기반으로
  //       삭제한 종목을 EDITABLE_PRICES에 즉시 재등록하기 때문
  saveHoldings();
  queueMgmtGsheetSync();
  refreshAll();
  _mgmtRefresh();
  buildStockMgmt();
}
// ── CSV 양식 다운로드
function smCsvDownloadTemplate() {
  if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
  const wb  = XLSX.utils.book_new();
  const rows = [
    ['종목명', '종목코드', '유형', '섹터'],
    ['삼성전자', '005930', '주식', '반도체'],
    ['TIGER미국S&P500', '360750', 'ETF', '해외주식'],
    ['내펀드A', '', '펀드', '기타'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:20},{wch:12},{wch:10},{wch:14}];
  ['A1','B1','C1','D1'].forEach(cell => {
    if (!ws[cell]) return;
    ws[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  XLSX.utils.book_append_sheet(wb, ws, '종목관리');
  XLSX.writeFile(wb, '종목관리_업로드양식.xlsx');
  showToast('📥 양식 다운로드 완료', 'ok');
}

// ── CSV 파일 업로드 처리
// ── xlsx/csv 공통 파서 헬퍼
// 파일을 읽어서 {headers:[], rows:[[]]} 형태로 반환 (callback)
function parseUploadFile(file, callback) {
  const isXlsx = /\.xlsx?$/i.test(file.name);
  if (isXlsx) {
    if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!data || data.length < 2) { showToast('데이터가 없습니다', 'error'); return; }
        const headers = (data[0] || []).map(h => String(h).trim());
        const rows    = data.slice(1).map(r => r.map(c => String(c ?? '').trim()));
        callback(headers, rows);
      } catch(err) { showToast('xlsx 파싱 오류: ' + err.message, 'error', 5000); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let text = e.target.result;
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { showToast('데이터가 없습니다', 'error'); return; }
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
        const rows    = lines.slice(1).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g,'')));
        callback(headers, rows);
      } catch(err) { showToast('CSV 파싱 오류: ' + err.message, 'error', 5000); }
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function smCsvImport(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  parseUploadFile(file, (headers, rows) => {
    const col = {
      name:   headers.findIndex(h => h === '종목명'),
      code:   headers.findIndex(h => h === '종목코드'),
      type:   headers.findIndex(h => h === '유형'),
      sector: headers.findIndex(h => h === '섹터'),
    };
    if (col.name === -1) { showToast('❌ "종목명" 컬럼이 없습니다', 'error'); return; }

    const VALID_TYPES = ['주식','ETF','ISA','IRP','연금','펀드','TDF'];
    let added = 0, skipped = 0, updated = 0;

    rows.forEach(cols => {
      const name   = col.name   >= 0 ? cols[col.name]   || '' : '';
      const codeRaw = col.code   >= 0 ? cols[col.code]   || '' : '';
      const code   = normalizeStockCode(codeRaw);
      const type   = col.type   >= 0 ? cols[col.type]   || '주식' : '주식';
      const sector = col.sector >= 0 ? cols[col.sector] || '기타' : '기타';
      if (!name) { skipped++; return; }
      const assetType = VALID_TYPES.includes(type) ? type : '주식';
      // ★ 주식·ETF는 종목코드 필수, 코드 입력 시 6자리 강제
      if (code && code.length !== 6) { skipped++; return; }
      if (!code && (assetType === '주식' || assetType === 'ETF')) { skipped++; return; }
      const isFund    = ['펀드','TDF'].includes(assetType);
      const existing  = EDITABLE_PRICES.findIndex(ep => ep.name === name);
      if (existing >= 0) {
        if (code)   EDITABLE_PRICES[existing].code      = code;
        if (type)   EDITABLE_PRICES[existing].assetType = assetType;
        if (sector) EDITABLE_PRICES[existing].sector    = sector;
        if (isFund) EDITABLE_PRICES[existing].fund      = true;
        updated++;
      } else {
        epPush(name, code, assetType);
        const newIdx = EDITABLE_PRICES.length - 1;
        EDITABLE_PRICES[newIdx].sector = sector || '기타';
        EDITABLE_PRICES[newIdx].fund   = isFund;
        added++;
      }
      if (code && name) STOCK_CODE[name] = normalizeStockCode(code);
    });

    saveHoldings();
    buildStockMgmt();
    const msg = `✅ ${added}건 추가, ${updated}건 업데이트` + (skipped ? `, ${skipped}건 건너뜀` : '');
    showToast(msg, 'ok');
    showMgmtMsg('smMgmtMsg', msg, false);
  });
}

// 종목 추가 팝업 열기/닫기/확인
function smMgmtAddNew() {
  const wrap = $el('smMgmtNewWrap');
  if(wrap) { wrap.style.display = 'block'; }
  _smRenderTypeButtons('주식');
  const sectors = [...new Set([...Object.keys(SECTOR_COLORS), '기타'])];
  _smRenderSecButtons(sectors[0] || '기타', sectors);
  setTimeout(() => $el('smMgmtNewName')?.focus(), 50);
}

function _smRenderTypeButtons(active) {
  const types = ['주식','ETF','ISA','IRP','연금','펀드','TDF'];
  const group = $el('smTypeGroup');
  const inp   = $el('smMgmtNewType');
  if(!group) return;
  if(inp) inp.value = active;
  group.innerHTML = types.map(t => `
    <button type="button" onclick="_smRenderTypeButtons('${t}')"
      class="btn-toggle-purple${t===active?' active':''}">${t}</button>`).join('');
}

function _smRenderSecButtons(active, sectors) {
  if(!sectors) sectors = [...new Set([...Object.keys(SECTOR_COLORS), '기타'])];
  const group = $el('smSecGroup');
  const inp   = $el('smMgmtNewSec');
  if(!group) return;
  if(inp) inp.value = active;
  group.innerHTML = sectors.map(s => `
    <button type="button" onclick="_smRenderSecButtons('${s.replace(/'/g,"\'")}')"
      class="btn-toggle-purple${s===active?' active':''}">${s}</button>`).join('');
}

function smMgmtCancel() {
  const wrap = $el('smMgmtNewWrap');
  if(wrap) wrap.style.display = 'none';
  const n = $el('smMgmtNewName'); if(n) n.value = '';
  const c = $el('smMgmtNewCode'); if(c) c.value = '';
  const t = $el('smMgmtNewType'); if(t) t.value = '주식';
  const s = $el('smMgmtNewSec');  if(s) s.value = '기타';
}
function smMgmtConfirm() {
  const name      = ($el('smMgmtNewName')?.value || '').trim();
  const code      = normalizeStockCode(($el('smMgmtNewCode')?.value || '').trim());
  const assetType = $el('smMgmtNewType')?.value || '주식';
  const sector    = $el('smMgmtNewSec')?.value || '기타';
  if(!name) { showMgmtMsg('smMgmtMsg','⚠️ 종목명을 입력해주세요',true); return; }
  // ★ 종목코드 입력 시 6자리 강제
  if(code && code.length !== 6) { showMgmtMsg('smMgmtMsg','⚠️ 종목코드는 6자리로 입력해주세요 (예: 005930)', true); return; }
  // ★ 주식·ETF는 종목코드 필수
  if(!code && (assetType === '주식' || assetType === 'ETF')) {
    showMgmtMsg('smMgmtMsg', `⚠️ ${assetType}은 종목코드(6자리)를 반드시 입력해주세요`, true); return;
  }
  if(EDITABLE_PRICES.some(i => i.name === name)) { showMgmtMsg('smMgmtMsg',`❌ "${name}"은(는) 이미 등록된 종목명입니다`,true); return; }
  if(code && EDITABLE_PRICES.some(i => i.code && i.code === code)) {
    const dup = EDITABLE_PRICES.find(i => i.code === code);
    showMgmtMsg('smMgmtMsg',`❌ 종목코드 ${code}는 "${dup.name}"에서 이미 사용 중입니다`,true); return;
  }
  // 기초정보에 assetType 저장 (사용자가 선택한 유형)
  const isFund = (assetType === '펀드' || assetType === 'TDF');
  EDITABLE_PRICES.push({ name, code, sector, assetType, ...(isFund ? { fund: true } : {}) });
  // SECTOR_MAP은 더 이상 단독 진실소스 아님 (getSector → EDITABLE_PRICES 우선 참조)
  if(code) STOCK_CODE[name] = normalizeStockCode(code);
  // ★ rawHoldings type/sector 즉시 재생성 → GAS syncHoldings에 최신 내용 전송
  syncHoldingsFromTrades();
  saveHoldings();
  queueMgmtGsheetSync();
  _mgmtRefresh();
  showMgmtMsg('smMgmtMsg',`✅ "${name}" 종목이 추가됐습니다`,false);
  setTimeout(() => smMgmtCancel(), 900);
  buildStockMgmt();
}

// 섹터 자동 색상 팔레트 (중복 방지용)
// 섹터 색상 팔레트 (ACCT_PALETTE와 동일한 20색)

function _smPickType(idx, val) {
  const inp = document.querySelector(`.sm-type-sel[data-idx="${idx}"]`);
  if(inp) inp.value = val;
  document.querySelectorAll(`.sm-type-grp[data-idx="${idx}"] button`).forEach(btn => {
    btn.classList.toggle('active', btn.textContent === val);
  });
}
function _smPickSec(idx, val) {
  const inp = document.querySelector(`.sm-sec-sel[data-idx="${idx}"]`);
  if(inp) inp.value = val;
  document.querySelectorAll(`.sm-sec-grp[data-idx="${idx}"] button`).forEach(btn => {
    btn.classList.toggle('active', btn.textContent === val);
  });
}

// 즉시 저장 (DOM 재생성 없이 데이터만 갱신)
function smSave(idx) {
  const item = EDITABLE_PRICES[idx];
  if(!item) return;
  const newName = (document.querySelector(`.sm-name-inp[data-idx="${idx}"]`)?.value || '').trim();
  const newCode = normalizeStockCode((document.querySelector(`.sm-code-inp[data-idx="${idx}"]`)?.value || '').trim());
  const newType = document.querySelector(`.sm-type-sel[data-idx="${idx}"]`)?.value || '주식';
  const newSec  = document.querySelector(`.sm-sec-sel[data-idx="${idx}"]`)?.value || '기타';
  if(!newName) return;
  // ★ 종목코드 입력 시 6자리 강제
  if(newCode && newCode.length !== 6) { showMgmtMsg('smMgmtMsg','⚠️ 종목코드는 6자리로 입력해주세요 (예: 005930)', true); return; }
  // ★ 주식·ETF는 종목코드 필수
  if(!newCode && (newType === '주식' || newType === 'ETF')) {
    showMgmtMsg('smMgmtMsg', `⚠️ ${newType}은 종목코드(6자리)를 반드시 입력해주세요`, true); return;
  }
  if(newCode && newCode !== item.code && EDITABLE_PRICES.some((i, i2) => i2 !== idx && i.code && i.code === newCode)) {
    const dup = EDITABLE_PRICES.find((i, i2) => i2 !== idx && i.code === newCode);
    showMgmtMsg('smMgmtMsg',`❌ 종목코드 ${newCode}는 "${dup.name}"에서 이미 사용 중입니다`,true); return;
  }
  if(newName !== item.name) {
    const oldName = item.name;
    if(item.code) delete STOCK_CODE[oldName];
    // ★ 코드 있는 종목은 savedPrices 키가 코드이므로 rename 불필요
    // 코드 없는 종목(펀드)만 이름 키 rename
    if(!item.code) {
      if(savedPrices[oldName])     { savedPrices[newName]     = savedPrices[oldName];     delete savedPrices[oldName]; }
      if(savedPriceDates[oldName]) { savedPriceDates[newName] = savedPriceDates[oldName]; delete savedPriceDates[oldName]; }
    }
    // ★ 거래이력·보유현황 종목명 일괄 변경 (계좌명 변경과 동일한 방식)
    rawTrades.forEach(t   => { if(t.name   === oldName) t.name   = newName; });
    rawHoldings.forEach(h => { if(h.name   === oldName) h.name   = newName; });
    // DIVDATA 키도 함께 변경
    if(DIVDATA[oldName] !== undefined) { DIVDATA[newName] = DIVDATA[oldName]; delete DIVDATA[oldName]; }
    item.name = newName;
  }
  // ★ 코드 변경 시 rawTrades.code도 일괄 업데이트
  const oldCode = item.code;
  if(newCode !== oldCode) {
    const normalizedOld = normalizeStockCode(oldCode);
    const normalizedNew = normalizeStockCode(newCode);
    if(normalizedOld) {
      rawTrades.forEach(t => {
        if(normalizeStockCode(t.code) === normalizedOld) t.code = normalizedNew;
      });
    }
  }
  item.code      = newCode;
  item.assetType = newType;
  item.sector    = newSec;
  if(newCode) STOCK_CODE[item.name] = normalizeStockCode(newCode); else delete STOCK_CODE[item.name];

  // ★ EDITABLE_PRICES 중복 항목 제거 (idx 파라미터 직접 사용 — indexOf보다 안전)
  for(let i = EDITABLE_PRICES.length - 1; i >= 0; i--) {
    if(i === idx) continue;
    const other = EDITABLE_PRICES[i];
    const sameCode = newCode && other.code && normalizeStockCode(other.code) === normalizeStockCode(newCode);
    const sameName = other.name === newName;
    if(sameCode || sameName) {
      if(other.code) delete STOCK_CODE[other.name];
      EDITABLE_PRICES.splice(i, 1);
      // splice로 앞 항목이 삭제되면 idx도 1 감소
      if(i < idx) idx--;
    }
  }

  // ★ rawHoldings type/sector 즉시 재생성
  syncHoldingsFromTrades();
  saveHoldings();
  queueMgmtGsheetSync();
  // 거래수정 팝업이 열려있으면 종목 버튼 목록 즉시 갱신
  if($el('tradeEditOverlay') && $el('tradeEditOverlay').style.display !== 'none') {
    if(typeof _refreshTeCodeList === 'function') _refreshTeCodeList($el('te-name')?.value, $el('te-code')?.value);
  }
  _mgmtRefresh();
  // ★ buildStockMgmt()는 호출하지 않음 — 상태 리셋 후 mousedown 핸들러에서 호출
}