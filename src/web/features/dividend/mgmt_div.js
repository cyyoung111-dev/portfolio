// ── 배당 관리 상수
const FREQ_OPTIONS = ['-', '월배당', '분기', '반기', '연간'];
const DIV_AUTO_SOURCE_LABEL = '공공데이터 우선 · GOOGLEFINANCE fallback';
const DIV_GF_SOURCE_LABEL = 'GOOGLEFINANCE(가능 종목만)';
const DIV_PUBLIC_KEY = 'public_data_api_key';
const DIV_MANUAL_GUIDE = '공공데이터포털 키가 있으면 KRX상장종목정보로 종목코드를 공식명/법인번호에 매핑한 뒤 주식배당정보를 조회합니다.';
const MONTHS_OPTIONS = {
  '-':    [],
  '월배당': [1,2,3,4,5,6,7,8,9,10,11,12],
  '분기':  [[1,4,7,10],[2,5,8,11],[3,6,9,12]],
  '반기':  [[1,7],[2,8],[3,9],[4,10],[5,11],[6,12]],
  '연간':  [1,2,3,4,5,6,7,8,9,10,11,12],
};

// ── 공통 인라인 메시지 헬퍼 (계좌·섹터·종목 관리 탭 공용)
function showMgmtMsg(id, text, isError) {
  const el = $el(id);
  if(!el) { if(isError) showToast(text, 'error'); return; }
  el.textContent = text;
  el.style.display = 'block';
  if(isError) {
    el.style.background = 'rgba(239,68,68,.13)';
    el.style.color = 'var(--red-lt)';
    el.style.border = '1px solid rgba(239,68,68,.28)';
  } else {
    el.style.background = 'rgba(16,185,129,.13)';
    el.style.color = 'var(--green)';
    el.style.border = '1px solid rgba(16,185,129,.28)';
  }
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, isError ? 3500 : 1800);
}

// ★ 배당 주기 버튼 클릭 핸들러 (buildDivMgmt의 위임 이벤트에서 호출)
function _dvPickFreq(key, freq) {
  // 1. hidden input 값 갱신
  const freqInp = $el('dv_freq_' + key);
  if (freqInp) freqInp.value = freq;

  // 2. 버튼 active 상태 토글
  const grp = $el('dv_freq_grp_' + key);
  if (grp) {
    grp.querySelectorAll('button').forEach(btn => {
      btn.className = _fBtnClass(btn.textContent === freq);
    });
  }

  // 3. MONTHS_OPTIONS에 따라 지급월 자동 채움
  const monthsOpt = MONTHS_OPTIONS[freq];
  const monthsInp = $el('dv_months_' + key);
  if (monthsInp && monthsOpt !== undefined) {
    if (freq === '-') {
      monthsInp.value = '';
    } else if (Array.isArray(monthsOpt) && Array.isArray(monthsOpt[0])) {
      // 2D 배열 (분기·반기): 첫 번째 옵션 자동 선택
      monthsInp.value = monthsOpt[0].join(',');
    } else if (Array.isArray(monthsOpt)) {
      monthsInp.value = monthsOpt.join(',');
    }
  }
}

function _divKey(name) {
  return 'k' + Array.from(String(name || ''))
    .map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
}

// ★ [버그수정] DOM id용 키 — getDivKey(종목코드/종목명) 기반으로 통일
// 기존 _divKey()는 유니코드 hex 인코딩 → getDivKey()와 키 불일치 → 배당 저장 항상 실패
function _divIdKey(name) {
  const base = (typeof getDivKey === 'function') ? getDivKey(name) : name;
  return 'dik_' + String(base || '').replace(/[^A-Za-z0-9\-\.]/g, '_');
}

// ── 배당 관리 DOM 생성 (buildDivMgmt)
function buildDivMgmt() {
  const container = $el('divMgmtBody');
  if (!container) return;

  // 보유 종목 기준으로 DIVDATA 기본값 초기화
  const names = [...new Set(rawHoldings.filter(h => !h.fund).map(h => h.name))];
  names.forEach(name => {
    const divKey = (typeof getDivKey === 'function') ? getDivKey(name) : name;
    if (!DIVDATA[divKey]) DIVDATA[divKey] = { perShare: 0, freq: '-', months: [], note: '' };
  });

  const renderItems = (items, label, color) => {
    if (!items.length) return '';
    let section = `<div style="font-size:.66rem;font-weight:800;color:${color};padding:8px 2px 5px;border-bottom:1px solid var(--border)">${label} <span style="color:var(--muted);font-weight:500">${items.length}종목</span></div>`;
    items.forEach(name => {
    const divKey = (typeof getDivKey === 'function') ? getDivKey(name) : name;
    const d = DIVDATA[divKey];
    const source = d.source === 'MANUAL' ? '수동 입력' : (d.note || '배당 정보 없음');
    const eventCount = Array.isArray(d.events) ? d.events.length : 0;
    section += `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(255,255,255,.06);padding:10px 2px">
      <div style="min-width:0">
        <div style="font-size:.72rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escapeHtml(name)}</div>
        <div class="lbl-60-muted-mt">${eventCount ? `배당 ${eventCount}건 · ${_escapeHtml(source)}` : d.perShare > 0 ? `주당 ${Number(d.perShare).toLocaleString()}원 · ${_escapeHtml(d.freq || '-')}` : _escapeHtml(source)}</div>
      </div>
      <button type="button" data-div-action="manual-open" data-div-name="${_escapeHtml(name)}" class="btn-amber-sm" style="flex-shrink:0">✏️ 입력</button>
    </div>`;
    });
    return section;
  };

  const etfNames = names.filter(name => {
    const ep = typeof getEP === 'function' ? getEP(name) : null;
    return (ep?.assetType || ep?.type) === 'ETF';
  });
  const stockNames = names.filter(name => !etfNames.includes(name));
  const h = renderItems(stockNames, '📈 일반 종목', 'var(--text)')
    + renderItems(etfNames, '🧺 ETF', 'var(--cyan)');

  container.innerHTML = h || '<div style="color:var(--muted);font-size:.75rem;padding:20px;text-align:center">보유 종목이 없어요</div>';

}

let _divManualName = '';
function openDivManualEditor(name) {
  const modal = $el('divManualModal');
  if (!modal || !name) return;
  _divManualName = name;
  const divKey = (typeof getDivKey === 'function') ? getDivKey(name) : name;
  const d = DIVDATA[divKey] || DIVDATA[name] || { perShare: 0, freq: '-', months: [] };
  const freq = d.freq || '-';
  $el('divManualTitle').textContent = `${name} 배당 입력`;
  $el('dv_amt_manual').value = Number(d.perShare || 0) || '';
  $el('dv_freq_manual').value = freq;
  $el('dv_months_manual').value = Array.isArray(d.months) ? d.months.join(',') : '';
  const group = $el('dv_freq_grp_manual');
  group.innerHTML = FREQ_OPTIONS.map(f => `<button type="button" data-div-freq-key="manual" data-div-freq="${_escapeHtml(f)}" class="${_fBtnClass(freq === f)}">${_escapeHtml(f)}</button>`).join('');
  const events = Array.isArray(d.events) ? d.events : [];
  $el('divManualEvents').innerHTML = '';
  if (events.length) events.forEach(event => addDivManualEventRow(event));
  else addDivManualEventRow();
  modal.style.display = 'flex';
  setTimeout(() => $el('dv_amt_manual')?.focus(), 30);
}

function addDivManualEventRow(event) {
  const container = $el('divManualEvents');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'div-manual-event-row';
  row.style.cssText = `display:grid;grid-template-columns:${window.innerWidth <= 480 ? '1fr 1fr' : '1fr 1fr 90px 30px'};gap:5px;align-items:end;margin-bottom:6px`;
  row.innerHTML = `
    <label class="lbl-60-muted-mt">배당 기준일<input type="date" data-div-event="date" value="${_escapeHtml(String(event?.date || '').slice(0, 10))}" class="input-full-73" style="margin-top:3px"/></label>
    <label class="lbl-60-muted-mt">지급일<input type="date" data-div-event="payDate" value="${_escapeHtml(String(event?.payDate || '').slice(0, 10))}" class="input-full-73" style="margin-top:3px"/></label>
    <label class="lbl-60-muted-mt">주당 금액<input type="number" min="0" step="any" data-div-event="amount" value="${Number(event?.amount || 0) || ''}" placeholder="원" class="input-full-73" style="margin-top:3px"/></label>
    <button type="button" data-div-action="manual-event-remove" class="btn-cancel-sm" title="배당 건 삭제">−</button>`;
  container.appendChild(row);
}

function removeDivManualEventRow(button) {
  const row = button?.closest?.('.div-manual-event-row');
  if (row) row.remove();
  if (!$el('divManualEvents')?.children.length) addDivManualEventRow();
}

function closeDivManualEditor() {
  const modal = $el('divManualModal');
  if (modal) modal.style.display = 'none';
  _divManualName = '';
}

async function saveDivManualEditor() {
  if (!_divManualName) return;
  const savedName = _divManualName;
  const perShare = Number($el('dv_amt_manual')?.value || 0);
  const freq = $el('dv_freq_manual')?.value || '-';
  const months = String($el('dv_months_manual')?.value || '').split(',')
    .map(m => Number(m.trim())).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  const events = [...document.querySelectorAll('#divManualEvents .div-manual-event-row')].map(row => ({
    date: row.querySelector('[data-div-event="date"]')?.value || '',
    payDate: row.querySelector('[data-div-event="payDate"]')?.value || '',
    amount: Number(row.querySelector('[data-div-event="amount"]')?.value || 0),
    source: 'MANUAL',
  })).filter(event => event.date || event.payDate || event.amount).sort((a, b) => a.date.localeCompare(b.date));
  if (events.some(event => !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || event.amount <= 0)) {
    showToast('각 배당 건의 기준일과 주당 금액을 확인해주세요', 'error'); return;
  }
  if (!events.length && perShare <= 0) { showToast('배당 건 또는 예상 주당 배당금을 입력해주세요', 'error'); return; }
  if (!events.length && (freq === '-' || months.length === 0)) { showToast('예상 배당의 지급 주기와 지급 월을 입력해주세요', 'error'); return; }
  const eventMonths = events.map(event => Number((event.payDate || event.date).slice(5, 7))).filter(Boolean);
  const savedMonths = [...new Set([...months, ...eventMonths])].sort((a, b) => a - b);
  const latestEventAmount = events.length ? events[events.length - 1].amount : perShare;
  const divKey = (typeof getDivKey === 'function') ? getDivKey(_divManualName) : _divManualName;
  const hadPrevious = Object.prototype.hasOwnProperty.call(DIVDATA, divKey);
  const previous = hadPrevious ? DIVDATA[divKey] : undefined;
  DIVDATA[divKey] = {
    ...(DIVDATA[divKey] || DIVDATA[_divManualName] || {}),
    perShare: perShare > 0 ? perShare : latestEventAmount,
    freq, months: savedMonths, events,
    source: 'MANUAL', note: `수동 입력${events.length ? ` · 배당 ${events.length}건` : ''}`, updatedAt: new Date().toISOString(),
  };
  const saveButton = document.querySelector('#divManualModal [data-div-action="manual-save"]');
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = '저장 중...'; }
  const savedToGas = await persistDividendSettings(true);
  if (!savedToGas) {
    if (hadPrevious) DIVDATA[divKey] = previous;
    else delete DIVDATA[divKey];
    if (saveButton) { saveButton.disabled = false; saveButton.textContent = '💾 저장'; }
    showToast('GAS 저장에 실패했습니다. 구글시트 연동 상태를 확인해주세요.', 'error', 5000);
    return;
  }
  if (saveButton) { saveButton.disabled = false; saveButton.textContent = '💾 저장'; }
  closeDivManualEditor();
  showToast(`${savedName} 배당 정보가 GAS에 저장되었습니다`, 'ok');
  const area = $el('view-area');
  if (area) renderDivView(area, true);
}

// ── 배당 탭 진입 시 자동 GS fetch (버튼 클릭 없이 조용히 갱신)
function _normDivCode(code) {
  const cleaned = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/^KRX:/, '')
    .replace(/^KOSDAQ:/, '')
    .replace(/^NASDAQ:/, '')
    .replace(/^NYSE:/, '')
    .replace(/^AMEX:/, '')
    .replace(/^A(?=\d{6}$)/, '')
    .replace(/[^A-Z0-9.-]/g, '');
  if (/^\d{1,6}$/.test(cleaned)) return cleaned.padStart(6, '0');
  return cleaned;
}

function _buildDivCodeToNameMap() {
  const map = {};
  EDITABLE_PRICES.filter(ep => ep.code).forEach(ep => {
    const raw = String(ep.code || '').trim();
    const norm = _normDivCode(raw);
    if (raw) map[raw] = ep.name;
    if (norm) map[norm] = ep.name;
  });
  return map;
}

function _normalizeDividendResponse(obj, prev) {
  const next = { ...prev };
  const perShare = Number(obj?.perShare || 0);
  if (perShare > 0) {
    next.perShare = perShare;
    next.freq = obj?.freq || prev?.freq || '-';
    if (Array.isArray(obj?.months)) {
      next.months = obj.months
        .map(m => Number(m))
        .filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
    } else if (typeof obj?.months === 'string') {
      next.months = obj.months
        .split(',')
        .map(m => Number(String(m).trim()))
        .filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
    } else {
      next.months = Array.isArray(prev?.months) ? prev.months : [];
    }
    if (Array.isArray(obj?.events)) {
      next.events = obj.events
        .map(ev => ({
          date: String(ev?.date || '').slice(0, 10),
          payDate: String(ev?.payDate || '').slice(0, 10),
          amount: Number(ev?.amount || 0),
          source: ev?.source || obj?.source || '',
        }))
        .filter(ev => /^\d{4}-\d{2}-\d{2}$/.test(ev.date) && ev.amount > 0);
    } else if (Array.isArray(prev?.events)) {
      next.events = prev.events;
    }
    next.source = obj?.source || 'GOOGLEFINANCE';
    next.listedName = obj?.listedName || prev?.listedName || '';
    next.crno = obj?.crno || prev?.crno || '';
    const srcLabel = next.source === 'PUBLIC_DATA' ? '공공데이터' : DIV_GF_SOURCE_LABEL;
    next.note = next.events?.length ? `${srcLabel} 실제 배당일 기준 자동갱신` : `${srcLabel} 자동갱신`;
    next.updatedAt = new Date().toISOString();
  } else {
    // 조회 실패/무배당 응답이 와도 기존 수동값/이전 정상값은 보존 (0으로 덮어쓰기 방지)
    if (Number(prev?.perShare || 0) > 0) {
      next.perShare = Number(prev.perShare || 0);
      next.freq = prev?.freq || next.freq || '-';
      next.months = Array.isArray(prev?.months) ? prev.months : (next.months || []);
      next.source = obj?.source || prev?.source || 'GOOGLEFINANCE';
      next.listedName = obj?.listedName || prev?.listedName || '';
      next.crno = obj?.crno || prev?.crno || '';
      next.note = `${next.source === 'PUBLIC_DATA' ? '공공데이터' : DIV_GF_SOURCE_LABEL}: 배당내역 없음(기존 값 유지)`;
    } else {
      next.perShare = 0;
      next.source = obj?.source || prev?.source || 'GOOGLEFINANCE';
      next.listedName = obj?.listedName || prev?.listedName || '';
      next.crno = obj?.crno || prev?.crno || '';
      next.note = prev?.note && !prev.note.startsWith('GOOGLEFINANCE')
        ? prev.note
        : `${next.source === 'PUBLIC_DATA' ? '공공데이터' : DIV_GF_SOURCE_LABEL}: 배당내역 없음`;
    }
  }
  return next;
}


function getPublicDataApiKey() {
  return (typeof lsGet === 'function') ? String(lsGet(DIV_PUBLIC_KEY, '') || '').trim() : '';
}

async function savePublicDataApiKeyFromUI() {
  const input = $el('publicDataKeyInput') || $el('divPublicKeyInput');
  const key = String(input?.value || '').trim();
  if (typeof lsSave === 'function') lsSave(DIV_PUBLIC_KEY, key);
  const status = $el('publicDataKeyStatus') || $el('divFetchStatus');
  const setStatus = (msg, ok) => {
    if (!status) return;
    status.style.color = ok ? 'var(--green-lt)' : 'var(--amber)';
    status.textContent = msg;
  };

  if (GSHEET_API_URL && typeof requestGsheetFormJson === 'function') {
    setStatus('공공데이터 API 키를 GAS에 저장 중...', true);
    const data = await requestGsheetFormJson(
      'savePublicDataApiKey',
      { key: key || '-' },
      { timeoutMs: 10000, retry: 1 }
    );
    if (data && data.status === 'ok') {
      showToast(key ? '공공데이터 API 키 저장 완료 (GAS 동기화)' : '공공데이터 API 키 삭제 완료 (GAS 동기화)', key ? 'ok' : 'warn');
      setStatus(key ? '공공데이터 우선 조회가 활성화됩니다. 다른 브라우저에서도 설정 복원됩니다.' : '키가 없으면 GOOGLEFINANCE fallback만 사용합니다.', !!key);
      return;
    }
    const reason = data && data.message ? ` · ${data.message}` : '';
    showToast('공공데이터 API 키는 이 브라우저에 저장됐지만 GAS 저장은 실패했습니다', 'warn', 5000);
    setStatus(`로컬 저장 완료 · GAS 저장 실패${reason} · 구글시트 연동 URL/배포 버전을 확인하세요.`, false);
    return;
  }

  showToast(key ? '공공데이터 API 키 저장 완료 (이 브라우저)' : '공공데이터 API 키를 비웠습니다', key ? 'ok' : 'warn');
  setStatus(key ? '공공데이터 우선 조회가 활성화됩니다. 구글시트 미연동 상태라 이 브라우저에만 저장됩니다.' : '키가 없으면 GOOGLEFINANCE fallback만 사용합니다.', !!key);
}

async function _fetchDividendSource(action, codeItems, extraParams) {
  const codes = codeItems.map(ep => _normDivCode(ep.code)).filter(Boolean).join(',');
  if (!codes) return null;
  const params = { codes, ...(extraParams || {}) };
  if (action === 'dividendPublic') {
    params.names = codeItems.map(ep => ep.name || '').join('|');
  }
  const url = buildGsheetActionUrl(action, params);
  // ★ [버그수정] dividendPublic은 종목당 공공데이터 API를 2회씩(상장정보+배당정보) 순차 호출하므로
  //   종목 수가 많으면(30개 이상) 45초를 넘겨 중간에 abort되는 문제가 있었음 → 150초로 상향
  const res = await fetchWithTimeout(url, action === 'dividendPublic' ? 150000 : 65000);
  if (!res.ok) throw new Error(action + ' HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'ok' || !data.dividends) throw new Error(data.message || action + ' 응답 오류');
  return data.dividends;
}

function _mergeDividendResults(targetCodes, primary, fallback) {
  const merged = {};
  targetCodes.forEach(code => {
    const p = primary && primary[code];
    const f = fallback && fallback[code];
    merged[code] = Number(p?.perShare || 0) > 0 ? p : (f || p || { perShare: 0, freq: '-', months: [], count: 0 });
  });
  return merged;
}

async function _autoFetchDiv(area) {
  const codeItems = EDITABLE_PRICES.filter(ep => {
    const holding = rawHoldings.find(h => h.name === ep.name && !h.fund);
    return holding && ep.code;
  });
  if (!codeItems.length) return;

  const codes = codeItems
    .map(ep => _normDivCode(ep.code))
    .filter(Boolean)
    .join(',');
  if (!codes) return;
  try {
    const publicKey = getPublicDataApiKey();
    let publicDividends = null;
    let gfDividends = null;
    const targetCodes = codes.split(',').filter(Boolean);
    if (publicKey) {
      try {
        publicDividends = await _fetchDividendSource('dividendPublic', codeItems, { serviceKey: publicKey });
      } catch(e) {
        console.warn('자동 공공데이터 배당 조회 실패, GOOGLEFINANCE fallback:', e.message);
      }
    }
    const missingCodeItems = publicDividends
      ? codeItems.filter(ep => Number(publicDividends[_normDivCode(ep.code)]?.perShare || 0) <= 0)
      : codeItems;
    if (missingCodeItems.length > 0) {
      gfDividends = await _fetchDividendSource('dividend', missingCodeItems, {});
    }
    const dividends = _mergeDividendResults(targetCodes, publicDividends, gfDividends);

    const codeToName = _buildDivCodeToNameMap();

    let changed = false;
    Object.entries(dividends).forEach(([code, obj]) => {
      const name = codeToName[String(code || '').trim()] || codeToName[_normDivCode(code)];
      if (!name) return;
      const divKey = (typeof getDivKey === 'function') ? getDivKey(name) : name;
      const normCode = _normDivCode(String(code || '').trim());
      const storeKey = normCode || divKey;
      const prev = DIVDATA[storeKey] || DIVDATA[divKey] || {};
      DIVDATA[storeKey] = _normalizeDividendResponse(obj, prev);
      changed = true;
    });

    if (changed) {
      const savedToGas = await persistDividendSettings(true);
      if (!savedToGas) console.warn('_autoFetchDiv: 배당 조회 결과 GAS 저장 실패');
      // 항상 현재 DOM의 view-area 참조 (area 클로저 stale 방지)
      if (currentView === 'div') {
        const _liveArea = $el('view-area');
        if (_liveArea) renderDivView(_liveArea, true);
      }
    }
  } catch(e) {
    // 자동 fetch 실패 시 조용히 무시 (수동 버튼으로 재시도 가능)
    console.warn('_autoFetchDiv 실패:', e.message);
  }
}

// ── 배당금 Claude API 자동 조회
async function startDivFetch() {
  const btn    = $el('divFetchBtn');
  const status = $el('divFetchStatus');

  // 구글시트 연동 여부 확인
  if (!GSHEET_API_URL) {
    if (status) {
      status.style.color = 'var(--amber)';
      status.textContent = '⚠️ 구글시트 미연동 — 배당금을 수동으로 입력해주세요. (✏️ 현재가 편집 → 📡 종가 자동 조회 탭에서 연동)';
    }
    return false;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ 조회 중...'; }
  if (status) {
    status.style.color = 'var(--amber)';
    status.textContent = `구글시트 ${DIV_AUTO_SOURCE_LABEL} 조회 중... · ${DIV_MANUAL_GUIDE}`;
  }

  // 보유 종목 코드 목록 (펀드 제외, 코드 있는 것만)
  const codeItems = EDITABLE_PRICES.filter(ep => {
    const holding = rawHoldings.find(h => h.name === ep.name && !h.fund);
    return holding && ep.code;
  });

  if (codeItems.length === 0) {
    if (status) {
      status.style.color = 'var(--amber)';
      status.textContent = '⚠️ 조회 가능한 종목코드가 없습니다. 종목코드를 먼저 등록해주세요.';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 배당금 불러오기'; }
    return false;
  }

  const codes = codeItems
    .map(ep => _normDivCode(ep.code))
    .filter(Boolean)
    .join(',');
  if (!codes) {
    if (status) {
      status.style.color = 'var(--amber)';
      status.textContent = '⚠️ 유효한 종목코드가 없습니다. 종목코드를 확인해주세요.';
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 배당금 불러오기'; }
    return false;
  }

  try {
    const publicKey = getPublicDataApiKey();
    let publicDividends = null;
    let gfDividends = null;
    const targetCodes = codes.split(',').filter(Boolean);
    const sourceStats = { public: 0, gf: 0 };
    if (publicKey) {
      try {
        publicDividends = await _fetchDividendSource('dividendPublic', codeItems, { serviceKey: publicKey });
      } catch(e) {
        console.warn('공공데이터 배당 조회 실패, GOOGLEFINANCE fallback:', e.message);
      }
    }
    const missingCodeItems = publicDividends
      ? codeItems.filter(ep => Number(publicDividends[_normDivCode(ep.code)]?.perShare || 0) <= 0)
      : codeItems;
    if (missingCodeItems.length > 0) {
      gfDividends = await _fetchDividendSource('dividend', missingCodeItems, {});
    }
    const dividends = _mergeDividendResults(targetCodes, publicDividends, gfDividends);

    // 코드 → 이름 역매핑
    const codeToName = _buildDivCodeToNameMap();

    let updated = 0, skipped = 0;
    Object.entries(dividends).forEach(([code, obj]) => {
      const name = codeToName[String(code || '').trim()] || codeToName[_normDivCode(code)];
      if (!name) return;
      const normCode = _normDivCode(String(code || '').trim());
      const storeKey = normCode || ((typeof getDivKey === 'function') ? getDivKey(name) : name);
      const prev = DIVDATA[storeKey] || {};
      DIVDATA[storeKey] = _normalizeDividendResponse(obj, prev);
      if (Number(obj?.perShare || 0) > 0) {
        DIVDATA[storeKey].source = obj?.source || 'GOOGLEFINANCE';
        const noteLabel = DIVDATA[storeKey].source === 'PUBLIC_DATA' ? '공공데이터' : DIV_GF_SOURCE_LABEL;
        DIVDATA[storeKey].note = `${noteLabel} 최근 배당정보 기준`;
        if (DIVDATA[storeKey].source === 'PUBLIC_DATA') sourceStats.public++;
        else sourceStats.gf++;
        updated++;
      } else {
        DIVDATA[storeKey].source = obj?.source || DIVDATA[storeKey].source || 'GOOGLEFINANCE';
        DIVDATA[storeKey].note = DIVDATA[storeKey].note === `${DIV_GF_SOURCE_LABEL}: 배당내역 없음`
          ? `${DIV_GF_SOURCE_LABEL}: 배당내역 없음 (수동입력 가능)`
          : DIVDATA[storeKey].note;
        skipped++;
      }
    });

    const resultMsg = `✅ ${updated}개 종목 배당 조회 완료 · 공공데이터 ${sourceStats.public}개 · GF ${sourceStats.gf}개` + (skipped > 0 ? ` (${skipped}개 배당없음/수동확인)` : '');
    const savedToGas = await persistDividendSettings(true);
    if (!savedToGas) throw new Error('배당 조회 결과를 GAS에 저장하지 못했습니다. 구글시트 연동 상태를 확인해주세요.');
    // ★ 상단 요약 숫자 + 테이블 전체 갱신 (skipFetch=true로 재귀 방지)
    const _area = $el('view-area');
    renderDivView(_area, true);
    // renderDivView 후 DOM이 새로 그려지므로 메시지·버튼 재설정
    const _st2 = $el('divFetchStatus');
    if (_st2) { _st2.style.color = 'var(--green-lt)'; _st2.textContent = resultMsg; }
    const _btn = $el('divFetchBtn');
    if (_btn) { _btn.disabled = false; _btn.textContent = '🔄 배당금 불러오기'; }

  } catch(e) {
    showToast('❌ 배당 조회 실패: ' + e.message, 'error', 5000);
    const _btnE = $el('divFetchBtn');
    if (_btnE) { _btnE.disabled = false; _btnE.textContent = '🔄 배당금 불러오기'; }
    return false;
  }

  return true;
}

// ── 종목 관리 탭
// ── 섹터 관리
