// ════════════════════════════════════════════════════════════════
//  settings_fetch.js — GAS 가격 조회·자동로드 (fetchFromGsheet, autoLoadPrices)
//  의존: settings.js, data.js
// ════════════════════════════════════════════════════════════════
async function fetchFromGsheet(dateStr) {
  if (!GSHEET_API_URL) return null;
  try {
    const pickLatestPreferManual = (list) => {
      if (!Array.isArray(list) || list.length === 0) return null;
      const byLatest = (a, b) => (a?.savedAt || a?.date || '').localeCompare(b?.savedAt || b?.date || '');
      const manual = list.filter(e => e && e.price > 0 && e.savedAt).sort(byLatest);
      if (manual.length > 0) return manual[manual.length - 1];
      const valid = list.filter(e => e && e.price > 0).sort(byLatest);
      return valid.length > 0 ? valid[valid.length - 1] : null;
    };
    // ★ EDITABLE_PRICES 코드 + rawHoldings STOCK_CODE + GSheet 코드목록 합산 (중복 제거)
    const epWithCode = getEPWithCode();
    const epCodeSet = new Set(epWithCode.map(i => i.code));
    // rawHoldings 기반 보완: EDITABLE_PRICES에 없지만 STOCK_CODE에 등록된 종목
    const holdingExtras = rawHoldings
      .filter(h => !h.fund && h.name)
      .map(h => ({ name: h.name, code: STOCK_CODE[normName(h.name)] || STOCK_CODE[h.name] || '' }))
      .filter(i => i.code && !epCodeSet.has(i.code));
    holdingExtras.forEach(i => epCodeSet.add(i.code));
    // _gsheetCodeList에는 있지만 EDITABLE_PRICES엔 없는 종목 보완
    const extraItems = [
      ...holdingExtras,
      ..._gsheetCodeList.filter(g => g.code && !epCodeSet.has(g.code))
    ];
    const epItems = [...epWithCode, ...extraItems];

    const epNoCode  = EDITABLE_PRICES.filter(i => !i.code); // 코드 없는 종목 (펀드·TDF)
    // ★ isToday: 오늘 날짜면 주말 여부 관계없이 getPrices(실시간) 우선 시도
    const isToday = (dateStr === getDateStr(0));

    const codeToName = {};
    epItems.forEach(i => { codeToName[i.code] = i.name; });

    // ── 코드 있는 종목: 오늘이면 getPrices(실시간), 과거면 getPriceHistory
    let codeResults = {};
    let missingCodes = [];
    const priceMeta = {};

    if (epItems.length > 0) {
      const codes = epItems.map(i => i.code).join(',');
      if (isToday) {
        // 오늘 (주말 포함) → getPrices 실시간 조회
        const url  = GSHEET_API_URL + '?action=getPrices&codes=' + encodeURIComponent(codes);
        const res  = await fetchWithTimeout(url, 30000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.status !== 'ok' || !data.prices) throw new Error('응답 오류');
        epItems.forEach(i => {
          const price = data.prices[i.code];
          if (price > 0) codeResults[i.code] = Math.round(price);  // ★ 코드 키로 저장
          else missingCodes.push({ name: i.name, code: i.code });
        });
        // ★ 실시간 조회에서 못 받은 종목은 getPriceHistory로 재시도
        if (missingCodes.length > 0) {
          try {
            const missingCodesStr = missingCodes.map(m => m.code).join(',');
            const url2 = GSHEET_API_URL + '?action=getPriceHistory&from=' + dateStr + '&to=' + dateStr + '&codes=' + encodeURIComponent(missingCodesStr);
            const res2 = await fetchWithTimeout(url2, 15000);
            const data2 = await res2.json();
            if (data2.status === 'ok' && data2.prices) {
              missingCodes = missingCodes.filter(m => {
                const list = data2.prices[m.code] || [];
                const entry = pickLatestPreferManual(list);
                if (entry && entry.price > 0) {
                  codeResults[m.code] = Math.round(entry.price);
                  if (entry.savedAt) priceMeta[m.code] = { savedAt: entry.savedAt };
                  return false;
                }
                return true;
              });
            }
          } catch(e) {}
        }
      } else {
        // 과거 날짜 → getPriceHistory
        const url  = GSHEET_API_URL + '?action=getPriceHistory&from=' + dateStr + '&to=' + dateStr + '&codes=' + encodeURIComponent(codes);
        const res  = await fetchWithTimeout(url, 20000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.status === 'ok' && data.prices) {
          epItems.forEach(i => {
            const list = data.prices[i.code] || [];
            const entry = pickLatestPreferManual(list);
            if (entry && entry.price > 0) {
              codeResults[i.code] = Math.round(entry.price);  // ★ 코드 키로 저장
              if (entry.savedAt) priceMeta[i.code] = { savedAt: entry.savedAt };
            }
            else missingCodes.push({ name: i.name, code: i.code });
          });
        }
      }
    }

    // ── 코드 없는 종목: getPriceHistory로 name 키로 조회
    // 기준일 평가금액 정확도 보장:
    //   ① 기준일(dateStr) 값이 있으면 그 값을 최우선 사용
    //   ② 없을 때만 기준일 이전 최근값 fallback (다른 기기 저장값 연동 보완)
    let noCodeResults = {};
    if (epNoCode.length > 0) {
      const fromDate = (function() {
        const d = new Date(dateStr); d.setDate(d.getDate() - 90);
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      })();
      const url = GSHEET_API_URL + '?action=getPriceHistory&from=' + fromDate + '&to=' + dateStr + '&codes=' + encodeURIComponent(epNoCode.map(i=>i.name).join(','));
      try {
        const res  = await fetchWithTimeout(url, 15000);
        const data = await res.json();
        if (data.status === 'ok' && data.prices) {
          epNoCode.forEach(i => {
            const entries = data.prices[i.name];
            if (!entries || entries.length === 0) return;
            // ① 기준일 정확 일치값 우선
            const exact = entries.filter(e => e && e.date === dateStr && e.price > 0).slice(-1)[0];
            // ② 없으면 기준일 이전 최근값 fallback
            const fallback = entries.filter(e => e && e.date <= dateStr && e.price > 0).slice(-1)[0];
            const picked = exact || fallback;
            if (picked && picked.price > 0) {
              noCodeResults[i.name] = Math.round(picked.price);
              priceMeta[i.name] = {
                savedAt: picked.savedAt || '',
                sourceDate: picked.date || '',
                isFallback: !exact && !!fallback && fallback.date !== dateStr
              };
            }
          });
        }
      } catch(e) {} // 코드 없는 종목 조회 실패는 무시
    }

    // 같은 종목명 중복 제거 (코드만 다른 항목은 첫 번째만 표시)
    const seenMissingNames = new Set();
    window._gsheetMissingCodes = missingCodes.filter(m => {
      if (seenMissingNames.has(m.name)) return false;
      seenMissingNames.add(m.name);
      return true;
    });
    const results = Object.assign({}, codeResults, noCodeResults);
    window._gsheetPriceMeta = priceMeta;
    return Object.keys(results).length > 0 ? results : null;

  } catch(e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('aborted') || msg.includes('abort')) return null;
    console.warn('[fetchFromGsheet]', e.message);
    return null;
  }
}

const PRICE_DIAG_MODE = /(?:\?|&)diag=1(?:&|$)/.test(location.search || '');

function _priceDiagSummary(results) {
  if (!PRICE_DIAG_MODE || !results || typeof results !== 'object') return '';
  const entries = Object.entries(results);
  if (entries.length === 0) return '';
  const changed = [];
  entries.forEach(([key, next]) => {
    const prev = savedPrices[key];
    if (prev > 0 && next > 0 && Math.round(prev) !== Math.round(next)) {
      changed.push({ key, prev: Math.round(prev), next: Math.round(next) });
    }
  });
  if (changed.length === 0) return ` · <span class="c-muted">🧪검증 변경 0/${entries.length}</span>`;
  const sample = changed.slice(0, 3).map(i => `${i.key}:${i.prev}→${i.next}`).join(', ');
  return ` · <span style="color:var(--amber)">🧪검증 변경 ${changed.length}/${entries.length}${sample ? ' (' + sample + (changed.length > 3 ? ' 외' : '') + ')' : ''}</span>`;
}

function setStatusLabel(html, type) {
  // type: 'idle' | 'loading' | 'ok' | 'warn' | 'error'
  const el = $el('price-updated-label');
  if (!el) return;
  el.className = `action-status-label sl-${type in {idle:1,loading:1,ok:1,warn:1,error:1} ? type : 'idle'}`;
  el.innerHTML = html;
}

function _resolvePriceDateLabel(baseLabel, key) {
  const meta = (window._gsheetPriceMeta && typeof window._gsheetPriceMeta === 'object') ? window._gsheetPriceMeta : {};
  const m = meta[key];
  if (!m) return baseLabel;
  if (m.savedAt) return m.savedAt.replace(/-/g,'.').slice(0,16) + ' 입력';
  if (m.isFallback && m.sourceDate) return m.sourceDate.replace(/-/g,'.') + ' 기준일 이전값';
  if (m.sourceDate) return m.sourceDate.replace(/-/g,'.') + ' 조회값';
  return baseLabel;
}

async function quickFetchByDate() {
  const dateInput = $el('quickDateInput');
  const btn = $el('quickFetchBtn');

  if (!dateInput.value) dateInput.value = getDateStr(0);
  const targetDate = dateInput.value;

  btn.disabled = true; btn.querySelector('span').textContent = '⏳';
  setStatusLabel('⏳ ' + targetDate + ' 종가 조회 중...', 'loading');

  if (!GSHEET_API_URL) {
    setStatusLabel('❌ 구글시트 미연동 · <button onclick="switchView(\'gsheet\')" class="btn-link">🔗 연동 →</button>', 'error');
    btn.disabled = false; btn.querySelector('span').textContent = '업데이트';
    return;
  }

  try {
    let results = await fetchFromGsheet(targetDate);
    let usedDate = targetDate;

    // 오늘 날짜 조회 시 주말/공휴일 fallback (최대 5일 전)
    if ((!results || Object.keys(results).length === 0) && targetDate === getDateStr(0)) {
      for (let d = 1; d <= 5; d++) {
        const fb = getDateStr(d);
        results = await fetchFromGsheet(fb);
        if (results && Object.keys(results).length > 0) { usedDate = fb; break; }
      }
    }

    if (results && Object.keys(results).length > 0) {
      const isToday = (usedDate === getDateStr(0));
      const isFallback = (usedDate !== targetDate);
      const label = isToday ? '실시간' : usedDate.replace(/-/g, '.') + ' 종가';
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key]     = price;
        savedPriceDates[key] = _resolvePriceDateLabel(label, key);
      });
      lastUpdated = usedDate.replace(/-/g, '.');
      updateDateBadge(lastUpdated, isToday);
      savePriceCache();
      const cnt   = Object.keys(results).length;
      const total = getEPWithCode().length;
      const dayLabel = isToday ? '실시간' : usedDate.replace(/-/g,'.') + ' 종가';
      let html = `✅ 업데이트 완료 · <span class="c-gold">${dayLabel}</span> · <b>${cnt}/${total}개</b>`;
      html += _priceDiagSummary(results);
      if (isFallback) {
        html += ` · <span style="color:var(--amber)">↩ 요청일(${targetDate.replace(/-/g,'.')}) 데이터 없음 → ${usedDate.replace(/-/g,'.')} 사용</span>`;
      }
      const missing = window._gsheetMissingCodes || [];
      if (missing.length > 0) {
        const missingStr = missing.map(m => `${m.code} ${m.name}`).join(', ');
        html += ` · <span style="color:var(--red-lt)">⚠️ 미조회 ${missing.length}개: ${missingStr}</span>`;
      }
      setStatusLabel(html, 'ok');
      refreshAll();
    } else {
      setStatusLabel('❌ ' + targetDate + ' 데이터 없음 (주말/공휴일 또는 종목코드 미등록)', 'error');
    }
  } catch(e) {
    setStatusLabel('❌ 조회 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.querySelector('span').textContent = '업데이트';
  }
}

// ── 접속 시 자동 종가 조회
// 날짜 문자열 생성 (daysAgo=0: 오늘, 1: 어제, ...)
function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - (daysAgo || 0));
  return d.getFullYear() + '-'
    + String(d.getMonth()+1).padStart(2,'0') + '-'
    + String(d.getDate()).padStart(2,'0');
}

async function autoLoadPrices() {
  const dateStr = getDateStr(0);
  const badge = $el('dateBadge');

  // ── 중요: GSHEET 연동 시에는 항상 원격 재조회 ──
  // 과거에는 "오늘 캐시가 있으면 스킵" 최적화가 있었지만,
  // 같은 날짜 내 다른 기기/GAS 수동저장 최신값을 놓쳐 평가금액 불일치가 발생할 수 있어 제거.
  const cachedDate = lastUpdated;
  const todayLabel = dateStr.replace(/-/g,'.');
  const cacheCount = Object.keys(savedPrices).length;

  if (!GSHEET_API_URL) {
    updateDateBadge(cachedDate || todayLabel, false);
    if (cacheCount > 0) {
      const total = getEPWithCode().length;
      setStatusLabel(`📦 캐시 종가 사용 중 · ${cacheCount}/${total}개 · <button onclick="switchView('gsheet')" class="btn-link-blue">⚙️ 재동기화 설정 →</button>`, 'warn');
    } else {
      setStatusLabel('💡 재동기화 설정 시 자동 종가 조회 · <button onclick="switchView(\'gsheet\')" class="btn-link-blue">⚙️ 설정하기 →</button>', 'idle');
    }
    refreshAll();
    return;
  }

  if (badge) {
    badge.textContent = '⏳ 종가 조회 중...';
    badge.style.display = 'inline-block';
    badge.style.background = 'rgba(59,130,246,.15)';
    badge.style.color = 'var(--blue-lt)';
    badge.style.border = '1px solid var(--c-blue2-30)';
  }
  setStatusLabel('⏳ GOOGLEFINANCE로 종가 조회 중...', 'loading');

  try {
    let results = null;
    let usedDateStr = dateStr;

    // 오늘 조회
    results = await fetchFromGsheet(dateStr);

    // 주말/공휴일 fallback (최대 5일 전)
    if (!results || Object.keys(results).length === 0) {
      for (let d = 1; d <= 5; d++) {
        const fb = getDateStr(d);
        results = await fetchFromGsheet(fb);
        if (results && Object.keys(results).length > 0) { usedDateStr = fb; break; }
      }
    }

    if (results && Object.keys(results).length > 0) {
      const isToday = (usedDateStr === dateStr);
      const isFallback = (usedDateStr !== dateStr);
      const dateLabel = isToday ? '실시간' : usedDateStr.replace(/-/g,'.') + ' 종가';
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key]     = price;
        savedPriceDates[key] = _resolvePriceDateLabel(dateLabel, key);
      });
      lastUpdated = usedDateStr.replace(/-/g,'.');
      updateDateBadge(lastUpdated, isToday);
      savePriceCache();
      const cnt      = Object.keys(results).length;
      const total    = getEPWithCode().length;
      const dayLabel = isToday ? '실시간' : usedDateStr.replace(/-/g,'.') + ' 종가';
      const fallbackMsg = isFallback
        ? ` · <span style="color:var(--amber)">↩ 오늘(${dateStr.replace(/-/g,'.')}) 데이터 없음 → ${usedDateStr.replace(/-/g,'.')} 사용</span>`
        : '';
      const diagMsg = _priceDiagSummary(results);
      setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">${dayLabel}</span> · ${cnt}/${total}개${diagMsg}${fallbackMsg}`, 'ok');

      const missing = window._gsheetMissingCodes || [];
      if (missing.length > 0) {
        const missingStr = missing.map(m => `${m.code} ${m.name}`).join(', ');
        const hint = document.createElement('span');
        hint.id = 'gsheetMissingHint';
        hint.title = '미조회 종목: ' + missingStr;
        hint.style.cssText = 'margin-left:6px;cursor:pointer;font-size:.70rem;color:var(--red)';
        hint.textContent = '⚠️ 미조회 ' + missing.length + '개: ' + missingStr;
        hint.onclick = () => switchView('gsheet');
        const existing = $el('gsheetMissingHint');
        if (existing) existing.remove();
        if (badge) badge.appendChild(hint);
      }
      refreshAll();
    } else {
      // ── GSheet 실패 → 캐시 가격으로 대체 ──
      if (cacheCount > 0) {
        const total = getEPWithCode().length;
        updateDateBadge(cachedDate || todayLabel, false);
        setStatusLabel(`⚠️ 조회 실패 · 캐시 종가 사용 중 <span class="c-muted">(${cachedDate||'?'})</span> · ${cacheCount}/${total}개`, 'warn');
        refreshAll();
      } else {
        updateDateBadge(todayLabel, false);
        setStatusLabel('❌ 종가 조회 실패 · 재동기화 설정 및 종목코드 등록 확인 필요', 'error');
      }
    }
  } catch(e) {
    if (cacheCount > 0) {
      const total = getEPWithCode().length;
      updateDateBadge(cachedDate || todayLabel, false);
      setStatusLabel(`⚠️ 조회 오류 · 캐시 종가 사용 중 <span class="c-muted">(${cachedDate||'?'})</span> · ${cacheCount}/${total}개`, 'warn');
      refreshAll();
    } else {
      updateDateBadge(todayLabel, false);
      setStatusLabel('❌ 조회 오류: ' + e.message, 'error');
    }
  }
}

// ── applyPrices 날짜 뱃지 연동 (특정일 지정 시)

// INIT — localStorage 불러오기가 이미 완료된 상태에서 렌더링
// quickDateInput 오늘 날짜로 초기화
(function() {
  const qi = $el('quickDateInput');
  if (qi) qi.value = (function() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  })();
})();
// EDITABLE_PRICES 기본값 (하드코딩) — syncEditables에서 localStorage로 덮어씌워짐

// _showNavPanelIfNeeded 제거됨 (현재가 편집창으로 통합)

// GS URL이 이미 저장돼 있으면 앱 시작 시 1회 자동 복원
// ★ 기존 펀드·TDF 가상코드 마이그레이션 (코드 없는 종목 → F001~)
setTimeout(() => { if (typeof migrateFundCodes === 'function') migrateFundCodes(); }, 0);
setTimeout(() => { bootstrapGsheetSettings(); }, 100);
