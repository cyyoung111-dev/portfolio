let _editorRefDate = '';
let _editorItemMap = {};
let _editorManualHistory = {};
let _editorSectionPage = { fund: 1, noprice: 1 };
const EDITOR_PAGE_SIZE = 5;
let _applyPricesRunning = false; // ★ 중복 클릭 방지 플래그
let _editorLoadSeq = 0; // ★ 날짜 변경 시 이전 로딩 결과 무시용

function openEditor() {
  buildEditorUI();
  _resetEditorApplyButton();
  // ★ 날짜 입력란 오늘 날짜로 초기화
  const editorDateEl = $el('editorDate');
  if (editorDateEl && !editorDateEl.value) {
    editorDateEl.value = _kstTodayStr(); // ★ KST 기준 오늘 날짜
  }
  if (editorDateEl) {
    _editorRefDate = editorDateEl.value || '';
    if (!editorDateEl._editorDateBound) {
      editorDateEl._editorDateBound = true;
      editorDateEl.addEventListener('change', async () => {
        await loadEditorPricesByDate(editorDateEl.value);
      });
    }
  }
  $el('priceEditor').classList.add('open');
  if (editorDateEl?.value) loadEditorPricesByDate(editorDateEl.value);
}

function _resetEditorApplyButton() {
  const applyBtn = $el('pe-panel-price-footer')
                || $el('priceEditor')?.querySelector('.btn-apply-prices');
  if (!applyBtn) return;
  if (!applyBtn.dataset.baseHtml) applyBtn.dataset.baseHtml = applyBtn.innerHTML;
  applyBtn.disabled = false;
  applyBtn.innerHTML = applyBtn.dataset.baseHtml;
  applyBtn.style.background = '';
}

function closeEditor() {
  $el('priceEditor').classList.remove('open');
  editedPrices = {};
  _editorManualHistory = {};
  _editorSectionPage = { fund: 1, noprice: 1 };
}

function _setEditorSectionPage(section, page, totalPages) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const next = Math.max(1, Math.min(safeTotal, Number(page) || 1));
  _editorSectionPage[section] = next;
  buildEditorUI();
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
    // ★ [개선] 렌더링 후에도 메시지가 유지되도록 localStorage에 저장
    // renderGsheetView()가 innerHTML을 통째로 교체해도 복원됨
    try {
      localStorage.setItem('pf_gsheet_test_result', JSON.stringify({ msg, color: color || 'var(--muted)' }));
    } catch(e) {}
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
        // ★ refreshAll()이 DOM 재생성 후 gsheetTestResult가 새 엘리먼트로 교체됨
        //    → 다음 tick에서 setRes() 호출해야 새 엘리먼트에 메시지가 써짐
        await new Promise(r => setTimeout(r, 50));
        setRes('✅ [1/3] 설정 복원 완료', 'var(--green-lt)');
      } else {
        const reason = await _diagnoseGsheetGetSettings();
        setRes(`⚠️ [1/3] 설정 복원 실패 — ${reason}`, 'var(--red-lt)');
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
      const dateStr = fmtDateDot(_kstTodayStr()); // ★ KST 기준 오늘 날짜
      setRes(`✅ 연결 성공! ${codeMsg} · 기준일: ${dateStr}`, 'var(--green-lt)');
    } else {
      setRes('⚠️ [3/3] 종목코드 동기화 실패 — 전송할 코드가 없거나 GS 응답 오류', 'var(--amber)');
    }
  })();
}

async function _diagnoseGsheetGetSettings() {
  if (!GSHEET_API_URL) return 'URL 미설정';
  try {
    const url = GSHEET_API_URL + '?action=getSettings';
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return `HTTP ${res.status}`;
    let data = null;
    try { data = await res.json(); } catch(e) {}
    if (!data) return 'JSON 파싱 실패(응답 포맷 확인)';
    if (data.status !== 'ok') return data.message || 'status!=ok';
    if (!data.settings) return 'settings 필드 누락(getSettings 구현/배포 확인)';
    return '원인 미상(콘솔 로그 확인)';
  } catch (e) {
    return e?.message || '요청 예외';
  }
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
  // ★ [개선] 연동 해제 시 저장된 결과 메시지도 삭제
  try { localStorage.removeItem('pf_gsheet_test_result'); } catch(e) {}
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
  if (typeof shouldRenderCharts !== 'function' || shouldRenderCharts(currentView)) renderDonut();
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
  _editorItemMap = {};
  // ① 펀드·TDF — assetType 또는 fund 플래그 기준 (코드 유무와 무관)
  const fundItems = EDITABLE_PRICES.filter(item =>
    item.fund || item.assetType === '펀드' || item.assetType === 'TDF'
  );

  // ② 코드 있는 일반 종목 중 "실제 자동조회 실패" 대상만 노출
  // savedPrices 조회 시 코드 키 + 이름 키 모두 확인
  const nopriceCodes = new Set();
  const nopriceItems = [];
  const missingSet = new Set((Array.isArray(window._gsheetMissingCodes) ? window._gsheetMissingCodes : []).map(m => normalizeStockCode(m.code)));
  EDITABLE_PRICES.forEach(item => {
    // 펀드·TDF는 ①에서 처리
    if (item.fund || item.assetType === '펀드' || item.assetType === 'TDF') return;
    if (!item.code) return;
    const code = (typeof normalizeStockCode === 'function') ? normalizeStockCode(item.code) : item.code;
    const hasPrice = !!(savedPrices[code] || savedPrices[item.code] || savedPrices[item.name] || getCurrentPriceFromData(item.name));
    const isMissing = missingSet.has(code);
    if (!hasPrice && isMissing) {
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
  totalItems.forEach(item => {
    const nn = normName(item.name || '');
    _editorItemMap[item.name] = { code: item.code ? normalizeStockCode(item.code) : '', normName: nn };
    if (nn && !_editorItemMap[nn]) _editorItemMap[nn] = { code: item.code ? normalizeStockCode(item.code) : '', normName: nn };
  });

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
    const code = item.code ? normalizeStockCode(item.code) : '';
    const current = (code && savedPrices[code])
      || savedPrices[item.name]
      || savedPrices[normName(item.name)]
      || getCurrentPriceFromData(item.name);

    const rawDateLabel = (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
      || (current ? '매입단가' : '');
    const hasDate = !!(
      (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
    );
    const displayLabel = (hasDate && rawDateLabel === '실시간' && _editorRefDate)
      ? _editorRefDate.replace(/-/g,'.') + ' 조회값'
      : rawDateLabel;

    // 상태 색상
    let statusColor;
    if (hasDate && displayLabel.includes('저장')) statusColor = 'var(--green)';
    else if (hasDate) statusColor = 'var(--blue-lt,#60a5fa)';
    else if (current) statusColor = 'var(--muted)';
    else statusColor = 'var(--red)';

    // ★ 이력: 최신순 3건 → 한 줄 요약 "04.01 08:15→29,750,642  03.31→30,037,571"
    const historyKey = code || item.name;
    const historyRows = (_editorManualHistory[historyKey] || []).slice().reverse();
    const historyLine = historyRows.length > 0
      ? historyRows.map((h, i) => {
          const d = (h.date || '').slice(5).replace('-','.');  // "04.01"
          const t = h.savedAt ? ' ' + h.savedAt.slice(11,16) : '';
          const p = Number(h.price).toLocaleString();
          return `<span style="color:${i===0?'var(--gold)':'var(--muted)'};font-weight:${i===0?'600':'400'}">${d}${t} ${p}</span>`;
        }).join('<span style="color:var(--border);margin:0 4px">·</span>')
      : '';

    const safeId  = item.name.replace(/\s/g, '_');
    const safeName = item.name.replace(/'/g, "\\'");

    // ★ 한 줄 압축형 레이아웃
    return `<div class="editor-price-row">
      <!-- 1행: 종목명 + 입력칸 + 상태 -->
      <div class="editor-price-row-main">
        <div class="editor-price-main-title">
          <span class="editor-price-name">${item.name}</span>
          <span class="editor-price-code">${item.code ? item.code : ''}</span>
        </div>
        <input type="text" inputmode="numeric" data-format="number-comma" id="ep_${safeId}"
          value="${current ? Number(current).toLocaleString() : ''}"
          placeholder="현재가"
          data-editor-price-name="${_escapeHtml(item.name)}"
          class="editor-price-input"
        />
        <span id="ps_${safeId}" style="font-size:.65rem;color:${statusColor};flex-shrink:0;width:14px;text-align:center">✓</span>
      </div>
      <!-- 2행: 저장일시 + 이력 -->
      <div class="editor-price-row-sub">
        <span class="editor-price-type">${typeLabel}</span>
        <div class="editor-price-meta">
          ${displayLabel ? `<span style="color:${statusColor}">${displayLabel}</span>` : ''}
          ${historyLine ? `<span style="color:var(--border)">|</span>${historyLine}` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderSection(sectionKey, title, items, typeLabelResolver) {
    const totalPages = Math.max(1, Math.ceil(items.length / EDITOR_PAGE_SIZE));
    const currentPage = Math.min(_editorSectionPage[sectionKey] || 1, totalPages);
    _editorSectionPage[sectionKey] = currentPage;
    const start = (currentPage - 1) * EDITOR_PAGE_SIZE;
    const pageItems = items.slice(start, start + EDITOR_PAGE_SIZE);

    let sectionHtml = '<section class="editor-price-section">';
    sectionHtml += `<div class="editor-price-section-title">${title}</div>`;
    sectionHtml += '<div class="editor-price-list">';
    pageItems.forEach(item => {
      sectionHtml += renderRow(item, typeLabelResolver(item));
    });
    sectionHtml += '</div>';
    if (totalPages > 1) {
      sectionHtml += `<div class="editor-price-pagination">
        <button class="editor-page-btn" data-editor-page-section="${_escapeHtml(sectionKey)}" data-page="${currentPage - 1}" data-total-pages="${totalPages}" ${currentPage <= 1 ? 'disabled' : ''}>이전</button>
        <span>${currentPage} / ${totalPages} 페이지</span>
        <button class="editor-page-btn" data-editor-page-section="${_escapeHtml(sectionKey)}" data-page="${currentPage + 1}" data-total-pages="${totalPages}" ${currentPage >= totalPages ? 'disabled' : ''}>다음</button>
      </div>`;
    }
    sectionHtml += '</section>';
    return sectionHtml;
  }

  let html = `<div class="editor-price-summary">총 ${totalItems.length}개 종목 · 섹션별 페이지로 이동해 입력하세요</div><div class="p-0-4">`;

  if (fundItems.length > 0) {
    html += renderSection('fund', `📦 펀드·TDF (${fundItems.length})`, fundItems, () => '펀드·TDF');
  }

  if (nopriceItems.length > 0) {
    html += renderSection('noprice', `⚠️ 자동 조회 실패 종목 (${nopriceItems.length})`, nopriceItems, item => item.assetType || '주식');
  }

  html += '</div>';
  $el('editorBody').innerHTML = html;
}

async function loadEditorPricesByDate(dateStr) {
  if (!dateStr) return;
  _editorRefDate = dateStr;
  const loadSeq = ++_editorLoadSeq;

  // 기존 로컬/저장 가격으로 먼저 그려서 편집창을 즉시 사용할 수 있게 합니다.
  // GAS 조회는 아래에서 백그라운드로 보강하되, 늦게 도착한 이전 날짜 응답은 무시합니다.
  buildEditorUI();

  if (!GSHEET_API_URL || typeof fetchFromGsheet !== 'function') {
    return;
  }

  const autoLabel = dateStr.replace(/-/g,'.') + ' 조회값';
  try {
    const results = await fetchFromGsheet(dateStr);
    if (loadSeq !== _editorLoadSeq || _editorRefDate !== dateStr) return;
    if (results && Object.keys(results).length > 0) {
      const meta = (window._gsheetPriceMeta && typeof window._gsheetPriceMeta === 'object') ? window._gsheetPriceMeta : {};
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key] = price;
        const savedAt = meta[key]?.savedAt || '';
        const sourceDate = meta[key]?.sourceDate || '';
        const isFallback = !!meta[key]?.isFallback;
        if (savedAt) savedPriceDates[key] = savedAt.replace(/-/g,'.').slice(0,16) + ' 입력';
        else if (isFallback && sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 기준일 이전값';
        else if (sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 조회값';
        else savedPriceDates[key] = autoLabel;
      });
      buildEditorUI();
    }
  } catch (e) {
    console.warn('[loadEditorPricesByDate] fetchFromGsheet 실패, 수동입력값만 표시:', e.message);
  }

  const rawHistory = await _fetchEditorPriceHistoryRaw(dateStr);
  if (loadSeq !== _editorLoadSeq || _editorRefDate !== dateStr) return;

  const manual = _parseEditorManualPrices(rawHistory);
  Object.entries(manual).forEach(([key, obj]) => {
    savedPrices[key] = obj.price;
    if (obj.savedAt) {
      savedPriceDates[key] = obj.savedAt.replace(/-/g,'.').slice(0,16) + ' 저장';
    } else if (obj.date) {
      savedPriceDates[key] = obj.date.replace(/-/g,'.') + ' 저장';
    } else {
      savedPriceDates[key] = dateStr.replace(/-/g,'.') + ' 저장';
    }
  });

  _editorManualHistory = _parseEditorManualHistory(rawHistory);
  buildEditorUI();
}

// ★ [개선] GAS getPriceHistory 공유 요청 — 1회만 호출
//   fetchEditorManualPrices / fetchEditorManualHistory 공통 베이스
async function _fetchEditorPriceHistoryRaw(dateStr) {
  try {
    if (!GSHEET_API_URL) return {};
    const targets = [];
    EDITABLE_PRICES.forEach(item => {
      if (item.code) targets.push(normalizeStockCode(item.code));
      else if (item.name) targets.push(item.name);
    });
    const uniqTargets = Array.from(new Set(targets.filter(Boolean)));
    if (uniqTargets.length === 0) return {};

    const fromDate = _kstDateOffset(dateStr, -180); // ★ KST 기준 날짜 오프셋
    const url = GSHEET_API_URL
      + '?action=getPriceHistory&from=' + fromDate + '&to=' + dateStr
      + '&codes=' + encodeURIComponent(uniqTargets.join(','));
    const res = await fetchWithTimeout(url, 20000);
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 'ok' || !data.prices) return {};
    return data.prices; // { [key]: entries[] } 원본 반환
  } catch (e) {
    console.warn('[_fetchEditorPriceHistoryRaw]', e.message);
    return {};
  }
}

// ★ [개선] 공유 rawHistory에서 최신 수동입력값 추출 (구 fetchEditorManualPrices 역할)
function _parseEditorManualPrices(rawPrices) {
  const out = {};
  const byLatest = (a, b) => {
    const ak = (a?.savedAt || a?.date || '');
    const bk = (b?.savedAt || b?.date || '');
    return ak.localeCompare(bk);
  };
  Object.entries(rawPrices).forEach(([key, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const manualEntries = entries.filter(e => e && e.price > 0 && e.savedAt).sort(byLatest);
    const latest = manualEntries.length > 0
      ? manualEntries[manualEntries.length - 1]
      : null;
    if (!latest) return;
    out[key] = { price: Math.round(latest.price), savedAt: latest.savedAt || '', date: latest.date || '' };
  });
  return out;
}

// ★ [개선] 공유 rawHistory에서 최근 3건 이력 추출 (구 fetchEditorManualHistory 역할)
function _parseEditorManualHistory(rawPrices) {
  const out = {};
  const byLatest = (a, b) => {
    const ak = (a?.savedAt || a?.date || '');
    const bk = (b?.savedAt || b?.date || '');
    return ak.localeCompare(bk);
  };
  Object.entries(rawPrices).forEach(([key, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const manualOnly = entries
      .filter(e => e && e.price > 0 && e.savedAt)
      .sort(byLatest)
      .slice(-3)
      .map(e => ({
        date: e.date || '',
        price: Math.round(e.price),
        savedAt: e.savedAt || ''
      }));
    if (manualOnly.length > 0) out[key] = manualOnly;
  });
  return out;
}

// ── 하위 호환: 외부에서 직접 호출하는 경우를 위한 래퍼 유지
async function fetchEditorManualPrices(dateStr) {
  const raw = await _fetchEditorPriceHistoryRaw(dateStr);
  return _parseEditorManualPrices(raw);
}

async function fetchEditorManualHistory(dateStr) {
  const raw = await _fetchEditorPriceHistoryRaw(dateStr);
  return _parseEditorManualHistory(raw);
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
    // ★ 카드형 상태 뱃지 업데이트
    const ps = $el('ps_' + key);
    if(ps) {
      ps.textContent = '✎ 미저장';
      ps.style.background = 'rgba(245,158,11,.15)';
      ps.style.color = 'var(--gold)';
      ps.style.border = '1px solid rgba(245,158,11,.3)';
    }
    _resetEditorApplyButton();
  }
}

// ★ GAS saveManualPrice 전용 fetch — fetchWithTimeout과 AbortController 공유 안 함
async function _gasDirectFetch(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

async function _saveManualPriceWithRetry(target, maxRetry) {
  const retries = Number.isFinite(maxRetry) ? maxRetry : 1;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = GSHEET_API_URL + '?action=saveManualPrice&date=' + encodeURIComponent(target.date)
                + '&name=' + encodeURIComponent(target.key) + '&price=' + target.price;
                // ★ keepLatest 파라미터 제거 → GAS의 _isManualKeepLatestEnabled() 설정값 사용
      const res = await _gasDirectFetch(url, 30000);
      const d = await res.json();
      if (d.status === 'ok') return { ok: true };
      lastErr = new Error((d && d.message) ? d.message : 'status not ok');
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 700));
  }
  return { ok: false, err: lastErr };
}

async function _syncManualPricesToGsheet(gasSaveTargets, gasDate) {
  let gasFailedCount = 0;
  const gasFailedKeys = [];
  try {
    const batchPayload = gasSaveTargets.map(t => ({ key: t.key, price: t.price }));
    const form = new URLSearchParams();
    form.set('action', 'batchSaveManualPrices');
    form.set('date', gasDate);
    form.set('data', JSON.stringify(batchPayload));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(GSHEET_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const d = await res.json();
      if (d && d.status === 'ok') {
        if (typeof showToast === 'function') showToast(`☁️ GAS 동기화 완료 (${gasSaveTargets.length}건)`, 'ok');
        return;
      }
      console.warn('[batchSaveManualPrices] GAS 오류 → 건당 fallback 시작:', d);
    } catch(fetchErr) {
      clearTimeout(timer);
      console.warn('[batchSaveManualPrices] 네트워크 오류 → 건당 fallback 시작:', fetchErr.message);
    }

    for (const target of gasSaveTargets) {
      const r = await _saveManualPriceWithRetry(target, 1);
      if (!r.ok) {
        gasFailedCount++;
        gasFailedKeys.push(target.key);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch(e) {
    gasFailedCount = gasSaveTargets.length;
    gasFailedKeys.splice(0, gasFailedKeys.length, ...gasSaveTargets.map(t => t.key));
    console.warn('[_syncManualPricesToGsheet] GAS 저장 예외:', e.message);
  }

  if (gasFailedCount > 0 && typeof showToast === 'function') {
    const sample = gasFailedKeys.slice(0, 3).join(', ');
    showToast(`⚠️ GAS 저장 실패 ${gasFailedCount}건${sample ? ' (' + sample + (gasFailedKeys.length > 3 ? ' 외' : '') + ')' : ''}`, 'warn');
  } else if (typeof showToast === 'function') {
    showToast(`☁️ GAS 동기화 완료 (${gasSaveTargets.length}건)`, 'ok');
  }
}

async function applyPrices() {
  // ★ 중복 클릭 방지 — 저장 진행 중이면 무시
  if (_applyPricesRunning) {
    showToast('저장 중입니다. 잠시 기다려주세요.', 'warn');
    return;
  }
  if(Object.keys(editedPrices).length === 0) {
    closeEditor(); return;
  }
  _applyPricesRunning = true;
  const now = _kstNow(); // ★ KST 기준 현재 시각
  // ★ editorDate 입력값 우선, 없으면 오늘
  const editorDateRaw = $el('editorDate')?.value; // YYYY-MM-DD
  let dateStr;
  if (editorDateRaw) {
    const [y,m,d] = editorDateRaw.split('-');
    dateStr = `${y}.${m}.${d}`;
  } else {
    dateStr = `${now.getUTCFullYear()}.${String(now.getUTCMonth()+1).padStart(2,'0')}.${String(now.getUTCDate()).padStart(2,'0')}`;
  }
  const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  // ★ GAS에 저장할 savedAt — 날짜+시간 (KST 기준)
  const savedAtDisplay = dateStr + ' ' + timeStr + ' 저장';

  const updatedCount = Object.keys(editedPrices).length;
  const gasSaveTargets = []; // GAS 저장 대상 목록

  // 로컬 저장 먼저 처리
  Object.keys(editedPrices).forEach(name => {
    const mappedCode = _editorItemMap[name]?.code || _editorItemMap[normName(name)]?.code || '';
    const code = mappedCode || getCode(normName(name));
    const key = code || name;
    savedPrices[key] = editedPrices[name];
    savedPriceDates[key] = savedAtDisplay;
    if (GSHEET_API_URL) {
      const gasDate = editorDateRaw || `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`; // ★ KST 기준
      gasSaveTargets.push({ name, key, date: gasDate, price: editedPrices[name] });
    }
  });

  // GAS 저장은 백그라운드로 진행합니다.
  // 로컬 저장/화면 반영을 먼저 끝내 기존처럼 빠르게 저장 버튼이 응답하도록 합니다.
  if (gasSaveTargets.length > 0 && GSHEET_API_URL) {
    const gasDate = editorDateRaw || `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
    _syncManualPricesToGsheet(gasSaveTargets, gasDate);
  }

  recomputeRows();
  lastUpdated = dateStr;
  const _lbl = $el('price-updated-label');
  if (_lbl) setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">${lastUpdated}</span> · ${updatedCount}개 종목 반영`, 'ok');

  const fetchedDate = $el('quickDateInput')?.value || '';
  const todayStr = _kstTodayStr(); // ★ KST 기준 오늘 날짜
  const isToday = fetchedDate === todayStr;
  updateDateBadge(lastUpdated, isToday);

  saveHoldings();

  // ★ 저장 완료 피드백 — 버튼·본문에 표시 후 1.5초 뒤 닫힘
  const applyBtn = $el('pe-panel-price-footer')
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
    done.innerHTML = `✅ ${updatedCount}개 종목 현재가가 저장되었습니다.<br><span style="font-size:.70rem;color:var(--muted)">${_escapeHtml(dateStr)} ${_escapeHtml(timeStr)} 기준 · GAS 동기화는 백그라운드 진행</span>`;
    body.prepend(done);
  }
  _applyPricesRunning = false;
  setTimeout(() => {
    closeEditor();
    renderView();
    renderSummary();
    if (typeof shouldRenderCharts !== 'function' || shouldRenderCharts(currentView)) renderDonut();
  }, 1500);
}


// ★ [통일] data-editor-price-name 입력 처리는 event_delegation.js의 전역 input 리스너로 통합됨
//   (기존: 이 파일에 별도 document.addEventListener('input', ...)가 있어서
//    event_delegation.js의 콤마 서식 리스너와 매 키 입력마다 동시에 실행 → 타이핑 지연 원인)
