let _editorRefDate = '';
let _editorItemMap = {};
let _editorManualHistory = {};
let _applyPricesRunning = false; // ★ 중복 클릭 방지 플래그

function openEditor() {
  buildEditorUI();
  _resetEditorApplyButton();
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

function _resetEditorApplyButton() {
  const applyBtn = $el('priceEditor')?.querySelector('[onclick*="applyPrices"]')
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
        // ★ refreshAll()이 DOM 재생성 후 gsheetTestResult가 새 엘리먼트로 교체됨
        //    → 다음 tick에서 setRes() 호출해야 새 엘리먼트에 메시지가 써짐
        await new Promise(r => setTimeout(r, 50));
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
  _editorItemMap = {};
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
    // ★ 현재가 조회: 코드키 → 이름키 → normName키 → rows 순서로 fallback
    const code = item.code ? normalizeStockCode(item.code) : '';
    const current = (code && savedPrices[code])
      || savedPrices[item.name]
      || savedPrices[normName(item.name)]
      || getCurrentPriceFromData(item.name);

    // ★ 저장일시 표시: savedPriceDates에서 날짜+시간 모두 표시
    const rawDateLabel = (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
      || (current ? '매입단가' : '');
    const hasDate = !!(
      (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
    );
    const statusIcon = hasDate
      ? `<span class="c-green" title="${rawDateLabel}">✓</span>`
      : current
        ? `<span class="c-muted" title="매입단가">○</span>`
        : `<span style="color:var(--red)" title="미조회">✕</span>`;

    // ★ 날짜 표시 레이블 — "실시간" 이면 기준일로 치환, 아니면 원본 그대로 (시간 포함)
    const displayLabel = (hasDate && rawDateLabel === '실시간' && _editorRefDate)
      ? _editorRefDate.replace(/-/g,'.') + ' 조회값'
      : rawDateLabel;

    // ★ 히스토리: savedAt(날짜+시간) 포함해서 표시
    const historyKey = code || item.name;
    const historyRows = _editorManualHistory[historyKey] || [];
    const historyHtml = historyRows.length > 0
      ? `<div style="font-size:.60rem;color:var(--muted);margin-top:3px;text-align:right;line-height:1.6">
          최근 입력:<br>${historyRows.map(h => {
            const dateStr = (h.date || '').replace(/-/g,'.');
            const timeStr = h.savedAt ? ' ' + h.savedAt.slice(11,16) : '';
            return `<span style="color:var(--text-dim)">${dateStr}${timeStr}</span> <span style="color:var(--gold);font-weight:600">${Number(h.price).toLocaleString()}</span>`;
          }).join('<br>')}
        </div>`
      : '';

    const dateHtml = displayLabel
      ? `<div style="font-size:.60rem;color:${hasDate?'var(--green)':'var(--muted)'};margin-top:2px;text-align:right">${displayLabel}</div>${historyHtml}`
      : `<div style="font-size:.60rem;color:var(--red);margin-top:2px;text-align:right">미조회</div>${historyHtml}`;
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

  // ★ GAS 없는 환경이면 로컬 데이터로만 UI 구성
  if (!GSHEET_API_URL || typeof fetchFromGsheet !== 'function') {
    buildEditorUI();
    return;
  }

  // ★ 로딩 표시
  const body = $el('editorBody');
  if (body) {
    body.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--muted);font-size:.80rem">⏳ GAS에서 최신 가격 불러오는 중...</div>';
  }

  // 1) GAS 자동조회 가격 (fetchFromGsheet는 내부적으로 getPrices 호출 — 항상 "오늘" 기준)
  //    실패해도 2단계(수동입력값 조회)는 반드시 실행됨 — try/catch로 감쌈
  const autoLabel = dateStr.replace(/-/g,'.') + ' 조회값';
  try {
    const results = await fetchFromGsheet(dateStr);
    if (results && Object.keys(results).length > 0) {
      const meta = (window._gsheetPriceMeta && typeof window._gsheetPriceMeta === 'object') ? window._gsheetPriceMeta : {};
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key] = price;
        const savedAt = meta[key]?.savedAt || '';
        const sourceDate = meta[key]?.sourceDate || '';
        const isFallback = !!meta[key]?.isFallback;
        // 임시 레이블 — 2단계에서 수동입력값이 있으면 반드시 덮어씌워짐
        if (savedAt) savedPriceDates[key] = savedAt.replace(/-/g,'.').slice(0,16) + ' 입력';
        else if (isFallback && sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 기준일 이전값';
        else if (sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 조회값';
        else savedPriceDates[key] = autoLabel;
      });
    }
  } catch (e) {
    // ★ fetchFromGsheet abort/timeout 실패해도 수동입력값 조회(2단계)는 반드시 진행
    console.warn('[loadEditorPricesByDate] fetchFromGsheet 실패, 수동입력값만 표시:', e.message);
  }

  // 2) ★ 수동 입력값 — 180일 범위에서 가장 최근 수동저장값 조회
  //    오늘(4/1)에 저장값이 없어도 3/31 저장값을 자동으로 불러와 표시
  //    fetchFromGsheet 성공/실패 무관하게 항상 실행, 1단계 결과를 무조건 덮어씌움
  const manual = await fetchEditorManualPrices(dateStr);
  Object.entries(manual).forEach(([key, obj]) => {
    savedPrices[key] = obj.price;
    if (obj.savedAt) {
      // GAS savedAt 형식: "yyyy-MM-dd HH:mm:ss" → "yyyy.MM.dd HH:mm 저장"
      // 실제 저장된 날짜(obj.date)가 기준일과 다를 수 있으므로 savedAt 기준으로 표시
      savedPriceDates[key] = obj.savedAt.replace(/-/g,'.').slice(0,16) + ' 저장';
    } else if (obj.date) {
      // savedAt 없는 구버전 — 저장된 날짜라도 표시
      savedPriceDates[key] = obj.date.replace(/-/g,'.') + ' 저장';
    } else {
      savedPriceDates[key] = dateStr.replace(/-/g,'.') + ' 저장';
    }
  });

  // 3) 이력 (최근 3건) — savedAt 포함해서 가져옴
  _editorManualHistory = await fetchEditorManualHistory(dateStr);
  buildEditorUI();
}

async function fetchEditorManualPrices(dateStr) {
  try {
    if (!GSHEET_API_URL) return {};
    const targets = [];
    EDITABLE_PRICES.forEach(item => {
      if (item.code) targets.push(normalizeStockCode(item.code));
      else if (item.name) targets.push(item.name);
    });
    const uniqTargets = Array.from(new Set(targets.filter(Boolean)));
    if (uniqTargets.length === 0) return {};

    // ★ from=180일 전 ~ to=dateStr 범위로 조회 — 오늘 저장값이 없어도
    //   가장 최근 수동저장값(예: 3/31)을 자동으로 불러와 표시
    const fromDate = (function() {
      const d = new Date(dateStr);
      d.setDate(d.getDate() - 180);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    })();
    const url = GSHEET_API_URL
      + '?action=getPriceHistory&from=' + fromDate + '&to=' + dateStr
      + '&codes=' + encodeURIComponent(uniqTargets.join(','));
    const res = await fetchWithTimeout(url, 20000);
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 'ok' || !data.prices) return {};

    const out = {};
    Object.entries(data.prices).forEach(([key, entries]) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      // ★ savedAt 있는 것(수동입력)만 필터 후 가장 최근 것 선택
      //   savedAt 없는 것(자동조회)은 제외 — 수동저장값만 표시 대상
      const manualEntries = entries.filter(e => e && e.price > 0 && e.savedAt);
      const latest = manualEntries.length > 0
        ? manualEntries[manualEntries.length - 1]  // 수동입력 중 가장 최근
        : null;
      if (!latest) return;
      // ★ savedAt(날짜+시간 문자열) 원본 보존 — 다른 기기에서도 저장시점 표시
      out[key] = { price: Math.round(latest.price), savedAt: latest.savedAt || '', date: latest.date || '' };
    });
    return out;
  } catch (e) {
    console.warn('[fetchEditorManualPrices]', e.message);
    return {};
  }
}

async function fetchEditorManualHistory(dateStr) {
  try {
    if (!GSHEET_API_URL) return {};
    const targets = [];
    EDITABLE_PRICES.forEach(item => {
      if (item.code) targets.push(normalizeStockCode(item.code));
      else if (item.name) targets.push(item.name);
    });
    const uniqTargets = Array.from(new Set(targets.filter(Boolean)));
    if (uniqTargets.length === 0) return {};

    const fromDate = (function() {
      const d = new Date(dateStr);
      d.setDate(d.getDate() - 180);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    })();
    const url = GSHEET_API_URL
      + '?action=getPriceHistory&from=' + fromDate + '&to=' + dateStr
      + '&codes=' + encodeURIComponent(uniqTargets.join(','));
    const res = await fetchWithTimeout(url, 20000);
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 'ok' || !data.prices) return {};

    const out = {};
    Object.entries(data.prices).forEach(([key, entries]) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      // savedAt가 있는 항목 = 수동입력 이력
      // ★ savedAt(날짜+시간 원본) 포함해서 저장 — renderRow에서 시간까지 표시
      const manualOnly = entries
        .filter(e => e && e.price > 0 && e.savedAt)
        .slice(-3)
        .map(e => ({
          date: e.date || '',
          price: Math.round(e.price),
          savedAt: e.savedAt || ''   // ★ 시간 포함 원본 보존
        }));
      if (manualOnly.length > 0) out[key] = manualOnly;
    });
    return out;
  } catch (e) {
    console.warn('[fetchEditorManualHistory]', e.message);
    return {};
  }
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
    _resetEditorApplyButton();
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
  // ★ GAS에 저장할 savedAt — 날짜+시간 (초 단위까지, KST 기준)
  const savedAtDisplay = dateStr + ' ' + timeStr + ' 저장';

  const updatedCount = Object.keys(editedPrices).length;
  const gasSaveTargets = []; // GAS 저장 대상 목록

  // 로컬 저장 먼저 처리
  Object.keys(editedPrices).forEach(name => {
    const mappedCode = _editorItemMap[name]?.code || _editorItemMap[normName(name)]?.code || '';
    const code = mappedCode || getCode(normName(name));
    const key = code || name;
    console.log('[applyPrices] save key resolved:', { name, mappedCode, code, key });
    savedPrices[key] = editedPrices[name];
    savedPriceDates[key] = savedAtDisplay;
    if (GSHEET_API_URL) {
      const gasDate = editorDateRaw || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      gasSaveTargets.push({ name, key, date: gasDate, price: editedPrices[name] });
    }
  });

  // ★ GAS 저장 — 순차 처리 (동시 요청 시 abort 방지)
  let gasFailedCount = 0;
  if (gasSaveTargets.length > 0) {
    for (const target of gasSaveTargets) {
      try {
        const url = GSHEET_API_URL + '?action=saveManualPrice&date=' + encodeURIComponent(target.date)
                  + '&name=' + encodeURIComponent(target.key) + '&price=' + target.price;
        const res = await _gasDirectFetch(url, 15000);
        const d = await res.json();
        if (d.status !== 'ok') {
          gasFailedCount++;
          console.warn('[saveManualPrice] 실패:', target.key, d);
        }
      } catch(e) {
        gasFailedCount++;
        console.warn('[saveManualPrice] 오류:', target.key, e.message);
      }
      // ★ 요청 사이 300ms 대기 — GAS 동시 요청 충돌 방지
      await new Promise(r => setTimeout(r, 300));
    }
    if (gasFailedCount > 0) {
      if (typeof showToast === 'function') {
        showToast(`⚠️ GAS 저장 실패 ${gasFailedCount}건 · 웹앱 재배포/URL 확인 필요`, 'warn');
      }
    } else {
      console.log('[saveManualPrice] GAS 저장 완료:', gasSaveTargets.length + '건');
    }
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
    if (gasFailedCount > 0) {
      applyBtn.innerHTML = `⚠️ 일부 저장 실패 (GAS ${gasFailedCount}건)`;
      applyBtn.style.background = 'var(--amber)';
    } else {
      applyBtn.innerHTML = `✅ 저장 완료 (${updatedCount}개)`;
      applyBtn.style.background = 'var(--green)';
    }
  }
  const body = $el('editorBody');
  if (body) {
    const done = document.createElement('div');
    done.style.cssText = 'text-align:center;padding:18px 0 8px;font-size:.82rem;color:var(--green-lt);font-weight:600';
    if (gasFailedCount > 0) {
      done.innerHTML = `⚠️ 로컬 저장 완료 · GAS 저장 실패 ${gasFailedCount}건<br><span style="font-size:.70rem;color:var(--muted)">웹앱 재배포/연결 URL 확인 후 다시 저장하세요</span>`;
      done.style.color = 'var(--amber)';
    } else {
      done.innerHTML = `✅ ${updatedCount}개 종목 현재가가 저장되었습니다.<br><span style="font-size:.70rem;color:var(--muted)">${dateStr} ${timeStr} 기준 · GAS 동기화 완료</span>`;
    }
    body.prepend(done);
  }
  _applyPricesRunning = false;
  setTimeout(() => {
    closeEditor();
    renderView();
    renderSummary();
    renderDonut();
  }, 1500);
}
