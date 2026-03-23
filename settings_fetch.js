// ════════════════════════════════════════════════════════════════
//  settings_fetch.js — GAS 가격 조회·자동로드 (fetchFromGsheet, autoLoadPrices)
//  의존: settings.js, data.js
// ════════════════════════════════════════════════════════════════
async function fetchFromGsheet(dateStr) {
  if (!GSHEET_API_URL) return null;
  try {
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
                const entry = (data2.prices[m.code] || [])[0];
                if (entry && entry.price > 0) { codeResults[m.code] = Math.round(entry.price); return false; }
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
            const entry = (data.prices[i.code] || [])[0];
            if (entry && entry.price > 0) codeResults[i.code] = Math.round(entry.price);  // ★ 코드 키로 저장
            else missingCodes.push({ name: i.name, code: i.code });
          });
        }
      }
    }

    // ── 코드 없는 종목: getPriceHistory로 name 키로 조회
    let noCodeResults = {};
    if (epNoCode.length > 0) {
      const names = epNoCode.map(i => encodeURIComponent(i.name)).join(',');
      const url   = GSHEET_API_URL + '?action=getPriceHistory&from=' + dateStr + '&to=' + dateStr + '&codes=' + encodeURIComponent(epNoCode.map(i=>i.name).join(','));
      try {
        const res  = await fetchWithTimeout(url, 15000);
        const data = await res.json();
        if (data.status === 'ok' && data.prices) {
          epNoCode.forEach(i => {
            const entry = (data.prices[i.name] || [])[0];
            if (entry && entry.price > 0) noCodeResults[i.name] = Math.round(entry.price);
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
    return Object.keys(results).length > 0 ? results : null;

  } catch(e) {
    console.warn('[fetchFromGsheet]', e.message);
    return null;
  }
}

function setStatusLabel(html, type) {
  // type: 'idle' | 'loading' | 'ok' | 'warn' | 'error'
  const el = $el('price-updated-label');
  if (!el) return;
  el.className = `action-status-label sl-${type in {idle:1,loading:1,ok:1,warn:1,error:1} ? type : 'idle'}`;
  el.innerHTML = html;
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
      const label = isToday ? '실시간' : usedDate.replace(/-/g, '.') + ' 종가';
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key]     = price;
        savedPriceDates[key] = label;
      });
      lastUpdated = usedDate.replace(/-/g, '.');
      updateDateBadge(lastUpdated, isToday);
      savePriceCache();
      const cnt   = Object.keys(results).length;
      const total = getEPWithCode().length;
      const dayLabel = isToday ? '실시간' : usedDate.replace(/-/g,'.') + ' 종가';
      let html = `✅ 업데이트 완료 · <span class="c-gold">${dayLabel}</span> · <b>${cnt}/${total}개</b>`;
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

  // ── 캐시된 가격이 오늘 날짜면 GSheet 재조회 스킵 ──
  const cachedDate = lastUpdated;
  const todayLabel = dateStr.replace(/-/g,'.');
  const cacheCount = Object.keys(savedPrices).length;
  if (cachedDate && cachedDate.startsWith(todayLabel) && cacheCount > 0 && GSHEET_API_URL) {
    updateDateBadge(todayLabel, true);
    const total = getEPWithCode().length;
    setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">실시간 (캐시)</span> · ${cacheCount}/${total}개`, 'ok');
    refreshAll();
    return;
  }

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
      const dateLabel = isToday ? '실시간' : usedDateStr.replace(/-/g,'.') + ' 종가';
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key]     = price;
        savedPriceDates[key] = dateLabel;
      });
      lastUpdated = usedDateStr.replace(/-/g,'.');
      updateDateBadge(lastUpdated, isToday);
      savePriceCache();
      // GAS 성공 시 백업 저장
      try {
        lsSave(PRICE_BACKUP_KEY, { prices: savedPrices, dates: savedPriceDates, ts: lastUpdated });
      } catch(e) {}

      const cnt      = Object.keys(results).length;
      const total    = getEPWithCode().length;
      const dayLabel = isToday ? '실시간' : usedDateStr.replace(/-/g,'.') + ' 종가';
      setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">${dayLabel}</span> · ${cnt}/${total}개`, 'ok');

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
        // 백업 데이터 복구 시도
        const backup = lsGet(PRICE_BACKUP_KEY, null);
        if (backup && backup.prices && Object.keys(backup.prices).length > 0) {
          Object.assign(savedPrices, backup.prices);
          Object.assign(savedPriceDates, backup.dates || {});
          lastUpdated = backup.ts || '';
          updateDateBadge(lastUpdated, false);
          setStatusLabel(`⚠️ 조회 실패 · 백업 가격 복구됨 <span class="c-muted">(${lastUpdated||'?'})</span>`, 'warn');
          refreshAll();
          showToast('GAS 조회 실패 — 마지막 백업 가격으로 복구했습니다', 'warn');
        } else {
          updateDateBadge(todayLabel, false);
          setStatusLabel('❌ 종가 조회 실패 · 재동기화 설정 및 종목코드 등록 확인 필요', 'error');
        }
      }
    }
  } catch(e) {
    if (cacheCount > 0) {
      const total = getEPWithCode().length;
      updateDateBadge(cachedDate || todayLabel, false);
      setStatusLabel(`⚠️ 조회 오류 · 캐시 종가 사용 중 <span class="c-muted">(${cachedDate||'?'})</span> · ${cacheCount}/${total}개`, 'warn');
      refreshAll();
    } else {
      const backup = lsGet(PRICE_BACKUP_KEY, null);
      if (backup && backup.prices && Object.keys(backup.prices).length > 0) {
        Object.assign(savedPrices, backup.prices);
        Object.assign(savedPriceDates, backup.dates || {});
        lastUpdated = backup.ts || '';
        updateDateBadge(lastUpdated, false);
        setStatusLabel(`⚠️ 조회 오류 · 백업 가격 복구됨 <span class="c-muted">(${lastUpdated||'?'})</span>`, 'warn');
        refreshAll();
        showToast('GAS 오류 — 마지막 백업 가격으로 복구했습니다', 'warn');
      } else {
        updateDateBadge(todayLabel, false);
        setStatusLabel('❌ 조회 오류: ' + e.message, 'error');
      }
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
setTimeout(() => { bootstrapGsheetSettings(); }, 0);