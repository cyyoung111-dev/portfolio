let _editorRefDate = '';

function openEditor() {
  buildEditorUI();
  // ★ 날짜 입력란 오늘 날짜로 초기화
  const editorDateEl = $el('editorDate');
  if (editorDateEl && !editorDateEl.value) {
    const t = new Date();
    editorDateEl.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }
  if (editorDateEl) {
    _editorRefDate = editorDateEl.value || '';
    editorDateEl.onchange = async () => {
      await loadEditorPricesByDate(editorDateEl.value);
    };
  }
  $el('priceEditor').classList.add('open');
  if (editorDateEl?.value) loadEditorPricesByDate(editorDateEl.value);
}

function closeEditor() {
  $el('priceEditor').classList.remove('open');
  editedPrices = {};
}

// ── 구글 시트 URL 관리

function saveGsheetUrlFromUI() {
  const raw = $el('gsheetUrlInput')?.value?.trim();
  if(!raw) { showToast('URL을 입력해주세요', 'warn'); return; }

  // Apps Script 배포 URL은 /exec 엔드포인트여야 호출 가능
  // 공유용 기본 URL(/edit 등)을 붙여넣은 경우에도 최대한 자동 보정
  let val = raw;
  if (!raw.includes('/exec')) {
    const s = raw.replace(/\/+$/, '');
    if (s.includes('/macros/s/')) val = s + '/exec';
  }

  if(!val.startsWith('https://script.google.com/macros/s/')) {
    showToast('올바른 Apps Script 웹앱 URL이 아닙니다', 'error');
    return;
  }
  if(!val.includes('/exec')) {
    showToast('웹앱 배포 URL(/exec)을 입력해주세요', 'warn');
    return;
  }

  const inp = $el('gsheetUrlInput');
  if (inp && inp.value !== val) inp.value = val;
  saveGsheetUrl(val);
  // ★ 매번 $el()로 새로 찾음 — refreshAll()이 renderGsheetView()를 호출해 DOM을 재생성하므로
  //    함수 시작 시점에 참조한 res는 재렌더링 후 무효화됨
  function setRes(msg, color) {
    const el = $el('gsheetTestResult');
    if (!el) return;
    el.style.color = color || 'var(--muted)';
    el.textContent = msg;
  }
  updateGsheetBadge();

  (async () => {
    // 1단계 — 설정 복원
    setRes('⏳ [1/3] 설정 복원 중... (GS 연결 확인)', 'var(--amber)');
    let restored = false;
    try {
      restored = await loadSettings(function(msg) {
        setRes('⏳ [1/3] ' + msg, 'var(--amber)');
      });
      if (restored) {
        try { refreshAll(); _mgmtRefresh(); } catch(e){}
        setRes('✅ [1/3] 설정 복원 완료', 'var(--green-lt)');
      } else {
        setRes('⚠️ [1/3] 설정 복원 실패 — GS 연결 확인 필요', 'var(--red-lt)');
        return;
      }
    } catch(e) {
      setRes('❌ [1/3] 설정 복원 오류: ' + e.message, 'var(--red-lt)');
      return;
    }

    // 2단계 — 종목코드 동기화
    await new Promise(r => setTimeout(r, 300));
    setRes('⏳ [2/3] 종목코드 동기화 중...', 'var(--amber)');
    let syncResult = null;
    try {
      syncResult = await syncCodesToGsheet();
    } catch(e) {
      setRes('❌ [2/3] 종목코드 동기화 오류: ' + e.message, 'var(--red-lt)');
      return;
    }

    // 3단계 — 최종 결과 표시
    if (syncResult) {
      const { synced = 0, updated = 0, removed = 0, total = 0 } = syncResult;
      const parts = [];
      if (synced  > 0) parts.push(`신규 ${synced}개`);
      if (updated > 0) parts.push(`수정 ${updated}개`);
      if (removed > 0) parts.push(`삭제 ${removed}개`);
      const codeMsg = parts.length
        ? `종목코드 ${parts.join(' · ')} (총 ${total}개)`
        : `종목코드 ${total}개`;
      const dateStr = fmtDateDot(new Date().toISOString().slice(0, 10));
      setRes(`✅ 연결 성공! ${codeMsg} · 기준일: ${dateStr}`, 'var(--green-lt)');
    } else {
      setRes('⚠️ [3/3] 종목코드 동기화 실패 — 전송할 코드가 없거나 GS 응답 오류', 'var(--amber)');
    }
  })();
}

function clearGsheetUrl() {
  saveGsheetUrl('');
  const inp = $el('gsheetUrlInput');
  if(inp) inp.value = '';
  const res = $el('gsheetTestResult');
  if (res) {
    res.style.color = 'var(--muted)';
    res.textContent = '연동 해제됨. 구글시트 연동 시 자동 조회가 활성화됩니다.';
  }
  updateGsheetBadge();
}

function updateGsheetBadge() {
  // 메인 헤더 뱃지 업데이트 (있는 경우)
  const badge = $el('gsheetBadge');
  if(badge) badge.style.display = GSHEET_API_URL ? 'inline' : 'none';
}

let _mgmtGsheetSyncTimer = null;
function queueMgmtGsheetSync(immediate) {
  if (!GSHEET_API_URL) return;
  clearTimeout(_mgmtGsheetSyncTimer);
  const delay = immediate ? 0 : 1200;
  _mgmtGsheetSyncTimer = setTimeout(async () => {
    saveSettings(true);
    try { await syncCodesToGsheet(); } catch (e) { console.warn('syncCodesToGsheet 실패:', e); }
    try { await syncHoldingsToGsheet(); } catch (e) { console.warn('syncHoldingsToGsheet 실패:', e); }
    try { await syncTradesToGsheet(); } catch (e) { console.warn('syncTradesToGsheet 실패:', e); }
  }, delay);
}

// ── 기초정보 관리 공통 헬퍼
// 데이터 변경 후 차트·요약 갱신. stocks탭에서는 renderView() 스킵 (인수인계 핵심 패턴)
function _mgmtRefresh() {
  recomputeRows();
  renderSummary();
  renderDonut();
  if(currentView !== 'stocks') renderView();
  // 거래수정 팝업이 열려있으면 종목 버튼 목록 갱신
  if($el('tradeEditOverlay') && $el('tradeEditOverlay').style.display !== 'none') {
    if(typeof _refreshTeCodeList === 'function') {
      _refreshTeCodeList($el('te-name')?.value, $el('te-code')?.value);
    }
  }
}

// ── 계좌 관리 (기초정보 관리 탭)

function buildEditorUI() {
  // ① 펀드·TDF — assetType 또는 fund 플래그 기준 (코드 유무와 무관)
  const fundItems = EDITABLE_PRICES.filter(item =>
    item.fund || item.assetType === '펀드' || item.assetType === 'TDF'
  );

  // ② 코드 있는 일반 종목 중 현재가 미조회된 것
  // savedPrices 조회 시 코드 키 + 이름 키 모두 확인
  // ★ 영문 포함 코드(F00001, 0046Y0 등)는 GOOGLEFINANCE 조회 불가 → 항상 포함
  const nopriceCodes = new Set();
  const nopriceItems = [];
  EDITABLE_PRICES.forEach(item => {
    // 펀드·TDF는 ①에서 처리
    if (item.fund || item.assetType === '펀드' || item.assetType === 'TDF') return;
    if (!item.code) return;
    const code = (typeof normalizeStockCode === 'function') ? normalizeStockCode(item.code) : item.code;
    // ★ 영문 포함 코드 = GOOGLEFINANCE 자동조회 불가 → 항상 수동 입력 목록에 포함
    const isAlphanumeric = /[A-Z]/.test(code);
    const hasPrice = !isAlphanumeric && (savedPrices[code] || savedPrices[item.code] || savedPrices[item.name]);
    if (!hasPrice) {
      nopriceCodes.add(code);
      nopriceItems.push(item);
    }
  });
  // ★ _gsheetMissingCodes: GAS 조회 실패 종목 중 EDITABLE_PRICES에 없는 것도 추가
  // 단, 기초정보에 이미 같은 이름 또는 같은 코드가 있으면 추가하지 않음
  if (Array.isArray(window._gsheetMissingCodes)) {
    window._gsheetMissingCodes.forEach(m => {
      const code = (typeof normalizeStockCode === 'function') ? normalizeStockCode(m.code) : m.code;
      if (nopriceCodes.has(code)) return; // 이미 목록에 있음
      // ★ 기초정보에 같은 코드 또는 같은 이름이 있으면 추가하지 않음
      const epByCode = EDITABLE_PRICES.find(i => i.code && normalizeStockCode(i.code) === code);
      const epByName = EDITABLE_PRICES.find(i => i.name === m.name);
      if (epByCode || epByName) return;
      nopriceCodes.add(code);
      nopriceItems.push({ name: m.name, code: m.code, assetType: '주식' });
    });
  }

  const totalItems = [...fundItems, ...nopriceItems];

  if (totalItems.length === 0) {
    $el('editorBody').innerHTML =
      '<div class="empty-msg" style="padding:30px 0">' +
      '<div style="font-size:1.8rem;margin-bottom:8px">✅</div>' +
      '모든 종목의 현재가가 자동 조회되고 있어요.<br>' +
      '<span class="txt-muted-68">자동 조회가 안 되는 종목이 생기면 여기에 표시됩니다.</span>' +
      '</div>';
    return;
  }

  function renderRow(item, typeLabel) {
    // ★ 현재가 조회: 코드키 → 이름키 → normName키 → rows 순서로 fallback
    const code = item.code ? normalizeStockCode(item.code) : '';
    const current = (code && savedPrices[code])
      || savedPrices[item.name]
      || savedPrices[normName(item.name)]
      || getCurrentPriceFromData(item.name);
    const dateLabel = (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
      || (current ? '매입단가' : '');
    const hasDate = !!(
      (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
    );
    const statusIcon = hasDate
      ? `<span class="c-green" title="${dateLabel}">✓</span>`
      : current
        ? `<span class="c-muted" title="매입단가">○</span>`
        : `<span style="color:var(--red)" title="미조회">✕</span>`;
    const displayLabel = (hasDate && dateLabel === '실시간' && _editorRefDate)
      ? _editorRefDate.replace(/-/g,'.') + ' 조회값'
      : dateLabel;
    const dateHtml = displayLabel
      ? `<div style="font-size:.60rem;color:${hasDate?'var(--green)':'var(--muted)'};margin-top:2px;text-align:right">${displayLabel}</div>`
      : '<div style="font-size:.60rem;color:var(--red);margin-top:2px;text-align:right">미조회</div>';
    const safeId  = item.name.replace(/\s/g, '_');
    const safeName = item.name.replace(/'/g, "\\'");
    return `<div class="editor-row" style="align-items:flex-start;margin-bottom:10px">
      <label style="padding-top:4px;flex:1">
        ${item.name}
        <br><span class="lbl-60-muted">${typeLabel}${item.code ? ' · ' + item.code : ''}</span>
      </label>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <input type="number" id="ep_${safeId}"
          value="${current || ''}"
          placeholder="현재가 입력"
          oninput="markChanged('${safeName}', this.value)"
          style="width:130px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem"
        />
        ${dateHtml}
      </div>
      <div class="price-status" id="ps_${safeId}" style="padding-top:4px">
        ${statusIcon}
      </div>
    </div>`;
  }

  let html = '<div class="p-0-4">';

  if (fundItems.length > 0) {
    html += `<div class="editor-section-title">📦 펀드·TDF (${fundItems.length})</div>`;
    fundItems.forEach(item => { html += renderRow(item, '펀드·TDF'); });
  }

  if (nopriceItems.length > 0) {
    if (fundItems.length > 0) html += '<div style="margin-top:14px"></div>';
    html += `<div class="editor-section-title">⚠️ 자동 조회 실패 종목 (${nopriceItems.length})</div>`;
    nopriceItems.forEach(item => { html += renderRow(item, item.assetType || '주식'); });
  }

  html += '</div>';
  $el('editorBody').innerHTML = html;
}

async function loadEditorPricesByDate(dateStr) {
  if (!dateStr) return;
  _editorRefDate = dateStr;
  if (!GSHEET_API_URL || typeof fetchFromGsheet !== 'function') {
    buildEditorUI();
    return;
  }
  const results = await fetchFromGsheet(dateStr);
  if (!results || Object.keys(results).length === 0) {
    buildEditorUI();
    return;
  }
  const label = dateStr.replace(/-/g,'.') + ' 조회값';
  Object.entries(results).forEach(([key, price]) => {
    savedPrices[key] = price;
    savedPriceDates[key] = label;
  });
  buildEditorUI();
}

function getCurrentPriceFromData(name) {
  // ★ 코드 키 우선 조회
  const code = getCode(normName(name));
  if (code && savedPrices[code]) return savedPrices[code];
  if(savedPrices[name]) return savedPrices[name];
  // Try to find in rows data
  if(typeof rows === 'undefined') return null;
  for(const r of rows) {
    if(r.name === name && r.price) return r.price;
  }
  return null;
}

function markChanged(name, val) {
  if(val) {
    editedPrices[name] = parseInt(val.replace(/,/g,''));
    const key = name.replace(/\s/g,'_');
    const ps = $el('ps_' + key);
    if(ps) ps.innerHTML = '<span class="c-gold" title="미저장 변경">✎</span>';
    // 날짜 셀에 "저장 대기" 표시
    const input = $el('ep_' + key);
    if(input) {
      let dateDiv = input.parentElement.querySelector('.pending-date');
      if(!dateDiv) {
        dateDiv = document.createElement('div');
        dateDiv.className = 'pending-date';
        dateDiv.style.cssText = 'font-size:.60rem;color:var(--gold);margin-top:2px;text-align:right';
        input.parentElement.appendChild(dateDiv);
      }
      dateDiv.textContent = '저장 대기중...';
    }
  }
}

function applyPrices() {
  if(Object.keys(editedPrices).length === 0) {
    closeEditor(); return;
  }
  const now = new Date();
  // ★ editorDate 입력값 우선, 없으면 오늘
  const editorDateRaw = $el('editorDate')?.value; // YYYY-MM-DD
  let dateStr;
  if (editorDateRaw) {
    const [y,m,d] = editorDateRaw.split('-');
    dateStr = `${y}.${m}.${d}`;
  } else {
    dateStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
  }
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const updatedCount = Object.keys(editedPrices).length;
  const gasManualPriceSaves = []; // GAS 저장 Promise 모음
  Object.keys(editedPrices).forEach(name => {
    // ★ 코드 있는 종목은 코드 키로 저장, 코드 없는 펀드는 이름 키로 저장
    const code = getCode(normName(name));
    const key = code || name;
    savedPrices[key] = editedPrices[name];
    savedPriceDates[key] = dateStr + ' ' + timeStr; // savedPriceDates는 표시용이라 시분 유지
    // ★ GAS에도 날짜별 저장 (saveManualPrice 액션)
    // 버그수정: 코드 있는 종목은 name 대신 code(=key)로 저장해야
    //          getPriceHistory 조회 시 코드 키로 찾을 수 있음
    if (GSHEET_API_URL) {
      const gasDate = editorDateRaw || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const url = GSHEET_API_URL + '?action=saveManualPrice&date=' + encodeURIComponent(gasDate)
                + '&name=' + encodeURIComponent(key) + '&price=' + editedPrices[name];
      // 버그수정: Promise 수집으로 결과 확인 (fire-and-forget 제거)
      gasManualPriceSaves.push(
        fetchWithTimeout(url, 10000)
          .then(r => r.json())
          .then(d => { if (d.status !== 'ok') console.warn('[saveManualPrice] GAS 오류:', name, d); })
          .catch(e => console.warn('[saveManualPrice]', name, e.message))
      );
    }
  });

  // GAS 저장 완료 대기 (백그라운드, UI는 먼저 업데이트)
  if (gasManualPriceSaves.length > 0) {
    Promise.all(gasManualPriceSaves).then(() => {
      console.log('[saveManualPrice] GAS 저장 완료:', gasManualPriceSaves.length + '건');
    });
  }

  recomputeRows();
  lastUpdated = dateStr;
  const _lbl = $el('price-updated-label');
  if (_lbl) setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">${lastUpdated}</span> · ${updatedCount}개 종목 반영`, 'ok');

  const fetchedDate = $el('quickDateInput')?.value || '';
  const todayStr = (()=>{ const t=new Date(); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); })();
  const isToday = fetchedDate === todayStr;
  updateDateBadge(lastUpdated, isToday);

  saveHoldings();

  // ★ 저장 완료 피드백 — 버튼·본문에 표시 후 1.5초 뒤 닫힘
  const applyBtn = $el('priceEditor')?.querySelector('[onclick*="applyPrices"]')
                || $el('priceEditor')?.querySelector('.btn-apply-prices');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerHTML = `✅ 저장 완료 (${updatedCount}개)`;
    applyBtn.style.background = 'var(--green)';
  }
  const body = $el('editorBody');
  if (body) {
    const done = document.createElement('div');
    done.style.cssText = 'text-align:center;padding:18px 0 8px;font-size:.82rem;color:var(--green-lt);font-weight:600';
    done.innerHTML = `✅ ${updatedCount}개 종목 현재가가 저장되었습니다.<br><span style="font-size:.70rem;color:var(--muted)">${dateStr} ${timeStr} 기준</span>`;
    body.prepend(done);
  }
  setTimeout(() => {
    closeEditor();
    renderView();
    renderSummary();
    renderDonut();
  }, 1500);
}
