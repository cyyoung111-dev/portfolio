// ════════════════════════════════════════════════════════════════
//  settings.js — 설정 저장·로드, GAS 연동 초기화, 탭 동기화 UI
//  의존: data.js, core_storage.js
// ════════════════════════════════════════════════════════════════
// PRICE EDITOR
const SECTOR_LABELS = {
  'semi':'반도체/IT', 'battery':'2차전지', 'ai':'AI/전력',
  'overseas_growth':'해외 성장', 'overseas_div':'해외 배당',
  'finance':'금융', 'casino':'카지노/레저', 'beauty':'화장품/소비재',
  'auto':'자동차', 'ship':'조선/방산', 'telecom':'통신',
  'holding':'지주', 'mixed':'국내혼합', 'display':'디스플레이',
  'fintech':'핀테크', 'const':'건설', 'div':'국내배당', 'fund':'펀드/TDF'
};

// Editable price list - grouped by sector
// Format: {name, code, sector, currentPrice}
// 종가 조회: 구글시트 GOOGLEFINANCE 사용 (Apps Script 웹앱 연동)

// ── 구글 시트 API URL (브라우저 재시작해도 유지)
let GSHEET_API_URL = lsGet(GSHEET_KEY, '');

// ════════════════════════════════════════════════════════════════════
//  설정 GS 저장 / 복원 — 브라우저 독립 복원용
// ════════════════════════════════════════════════════════════════════
// debounce 타이머
let _saveSettingsTimer = null;
let _saveDividendTimer = null;
let _saveRealEstateTimer = null;
const TAB_SYNC_STATUS_KEY = 'tab_sync_status';
let TAB_SYNC_STATUS = lsGet(TAB_SYNC_STATUS_KEY, {});
const TAB_SYNC_BUSY = {};

function _toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ★ 버그수정: loadSettings에서 EDITABLE_PRICES 코드 복원 시 사용
// normalizeStockCode(data.js)의 settings.js 내 별칭
// 이 함수가 없으면 loadSettings에서 ReferenceError → 코드가 undefined로 저장됨
function _normalizeCodeForSync(raw) {
  return (typeof normalizeStockCode === 'function')
    ? normalizeStockCode(raw)
    : String(raw || '').trim().toUpperCase().replace(/^A(?=\d{6}$)/, '');
}

function _toMonths(v) {
  if (Array.isArray(v)) {
    return v.map(m => Number(m)).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  }
  if (typeof v === 'string') {
    return v.split(',').map(m => Number(String(m).trim())).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  }
  return [];
}

function _normalizeDivData(raw) {
  const next = {};
  if (!raw || typeof raw !== 'object') return next;
  Object.entries(raw).forEach(([key, v]) => {
    const prev = (v && typeof v === 'object') ? v : {};
    // ★ key가 name이면 code로 변환 (getDivKey 사용)
    const storeKey = (typeof getDivKey === 'function') ? getDivKey(key) : key;
    next[storeKey] = {
      perShare: _toNum(prev.perShare, 0),
      freq: typeof prev.freq === 'string' ? prev.freq : '-',
      months: _toMonths(prev.months),
      note: typeof prev.note === 'string' ? prev.note : '',
    };
  });
  return next;
}

function _applyDivData(raw) {
  const normalized = _normalizeDivData(raw);
  Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]);
  Object.assign(DIVDATA, normalized);
}


function saveDividendSettings(immediate) {
  if (!GSHEET_API_URL) return Promise.resolve(false);
  clearTimeout(_saveDividendTimer);
  const delay = immediate ? 0 : 2500;
  return new Promise(resolve => {
    _saveDividendTimer = setTimeout(async () => {
      try {
        const body = 'action=saveDividendSettings&data=' + encodeURIComponent(JSON.stringify(DIVDATA));
        const res = await fetchWithTimeout(GSHEET_API_URL, 15000, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
        resolve(true);
      } catch(e) {
        // 별도 배당 저장 미지원 Apps Script면 기존 saveSettings(DIVDATA 포함)로 백업됨
        console.warn('saveDividendSettings 실패:', e);
        resolve(false);
      }
    }, delay);
  });
}

function saveRealEstateSettings(immediate) {
  if (!GSHEET_API_URL) return Promise.resolve(false);
  clearTimeout(_saveRealEstateTimer);
  const delay = immediate ? 0 : 2500;
  return new Promise(resolve => {
    _saveRealEstateTimer = setTimeout(async () => {
      try {
        const payload = {
          LOAN,
          REAL_ESTATE,
          LOAN_SCHEDULE,
          RE_VALUE_HIST,
        };
        const body = 'action=saveRealEstateSettings&data=' + encodeURIComponent(JSON.stringify(payload));
        const res = await fetchWithTimeout(GSHEET_API_URL, 15000, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
        resolve(true);
      } catch(e) {
        console.warn('saveRealEstateSettings 실패:', e);
        resolve(false);
      }
    }, delay);
  });
}

async function loadRealEstateSettings() {
  if (!GSHEET_API_URL) return false;
  try {
    const res = await fetchWithTimeout(GSHEET_API_URL + '?action=getRealEstateSettings', 10000);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status !== 'ok' || !data.settings || typeof data.settings !== 'object') return false;
    const s = data.settings;
    if (s.LOAN && typeof s.LOAN === 'object') {
      Object.assign(LOAN, {
        ...s.LOAN,
        originalAmt: _toNum(s.LOAN.originalAmt, LOAN.originalAmt),
        balance: _toNum(s.LOAN.balance, LOAN.balance),
        annualRate: _toNum(s.LOAN.annualRate, LOAN.annualRate),
        totalMonths: _toNum(s.LOAN.totalMonths, LOAN.totalMonths),
        remainingMonths: _toNum(s.LOAN.remainingMonths, LOAN.remainingMonths),
        monthlyInterestPaid: _toNum(s.LOAN.monthlyInterestPaid, LOAN.monthlyInterestPaid),
        totalInterestPaid: _toNum(s.LOAN.totalInterestPaid, LOAN.totalInterestPaid),
      });
    }
    if (s.REAL_ESTATE && typeof s.REAL_ESTATE === 'object') {
      Object.assign(REAL_ESTATE, {
        ...s.REAL_ESTATE,
        currentValue: _toNum(s.REAL_ESTATE.currentValue, REAL_ESTATE.currentValue),
        purchasePrice: _toNum(s.REAL_ESTATE.purchasePrice, REAL_ESTATE.purchasePrice),
        taxCost: _toNum(s.REAL_ESTATE.taxCost, REAL_ESTATE.taxCost),
        interiorCost: _toNum(s.REAL_ESTATE.interiorCost, REAL_ESTATE.interiorCost),
        etcCost: _toNum(s.REAL_ESTATE.etcCost, REAL_ESTATE.etcCost),
      });
    }
    if (Array.isArray(s.LOAN_SCHEDULE)) {
      LOAN_SCHEDULE.length = 0;
      s.LOAN_SCHEDULE.forEach(r => {
        if (!r || !r.date) return;
        LOAN_SCHEDULE.push({
          date: String(r.date),
          balance: _toNum(r.balance, 0),
          principal: _toNum(r.principal, 0),
          interest: _toNum(r.interest, 0),
        });
      });
    }
    if (Array.isArray(s.RE_VALUE_HIST)) {
      RE_VALUE_HIST.length = 0;
      s.RE_VALUE_HIST.forEach(r => {
        if (!r || !r.date) return;
        RE_VALUE_HIST.push({ date: String(r.date), value: _toNum(r.value, 0) });
      });
    }
    return true;
  } catch(e) {
    return false;
  }
}

async function loadDividendSettings() {
  if (!GSHEET_API_URL) return false;
  try {
    const res = await fetchWithTimeout(GSHEET_API_URL + '?action=getDividendSettings', 10000);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status !== 'ok' || !data.divData || typeof data.divData !== 'object') return false;
    _applyDivData(data.divData);
    lsSave(DIVDATA_KEY, DIVDATA);
    return true;
  } catch(e) {
    return false;
  }
}
function saveSettings(immediate) {
  if (!GSHEET_API_URL) return Promise.resolve(false);
  clearTimeout(_saveSettingsTimer);
  const delay = immediate ? 0 : 4000;
  return new Promise(resolve => {
    _saveSettingsTimer = setTimeout(async () => {
      try {
        const settings = {
          ACCT_COLORS,
          ACCT_ORDER,
          SECTOR_COLORS,
          fundDirect,
          EDITABLE_PRICES,
          // 하위 호환: 별도 시트 액션(save/getDividendSettings, save/getRealEstateSettings)
          // 이 없는 Apps Script에서도 Settings 시트에 함께 저장해 복원 가능하도록 유지
          DIVDATA,
          LOAN,
          REAL_ESTATE,
          LOAN_SCHEDULE,
          RE_VALUE_HIST,
        };
        const body = 'action=saveSettings&data=' + encodeURIComponent(JSON.stringify(settings));
        const res = await fetchWithTimeout(GSHEET_API_URL, 15000, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
        resolve(true);
      } catch(e) {
        console.warn('saveSettings 실패:', e);
        resolve(false);
      }
    }, delay);
  });
}

async function persistDividendSettings(immediate) {
  if (!GSHEET_API_URL) return false;
  const ok = await saveDividendSettings(immediate);
  if (ok) return true;
  return saveSettings(true);
}

async function persistRealEstateSettings(immediate) {
  if (!GSHEET_API_URL) return false;
  const ok = await saveRealEstateSettings(immediate);
  if (ok) return true;
  return saveSettings(true);
}

function _tabSyncText(tabId) {
  const info = TAB_SYNC_STATUS[tabId];
  if (!GSHEET_API_URL) return { text: '재동기화 설정 필요', color: 'var(--muted)' };
  if (!info || !info.ts) return { text: '동기화 기록 없음', color: 'var(--muted)' };
  const t = new Date(info.ts);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const base = `${hh}:${mm}`;
  if (info.state === 'ok') return { text: `✅ 마지막 동기화 ${base}`, color: 'var(--green)' };
  if (info.state === 'syncing') return { text: `⏳ 동기화 중... (${base})`, color: 'var(--amber)' };
  return { text: `⚠️ 마지막 동기화 실패 ${base}`, color: 'var(--red-lt)' };
}

function renderTabSyncPanel(tabId) {
  const st = _tabSyncText(tabId);
  const disabled = !GSHEET_API_URL ? 'disabled' : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:10px">
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:.70rem;font-weight:700;color:var(--text)">🔄 수동 재동기화</div>
      <span id="sync-badge-${tabId}" style="font-size:.68rem;color:${st.color}">${st.text}</span>
    </div>
    <button data-sync-tab="${tabId}" id="sync-btn-${tabId}" class="btn-purple-sm" ${disabled}>🔄 재동기화</button>
  </div>`;
}

function _setTabSyncStatus(tabId, state, msg) {
  TAB_SYNC_STATUS[tabId] = { state, msg: msg || '', ts: Date.now() };
  lsSave(TAB_SYNC_STATUS_KEY, TAB_SYNC_STATUS);
  const badge = $el('sync-badge-' + tabId);
  if (badge) {
    const st = _tabSyncText(tabId);
    badge.textContent = msg || st.text;
    badge.style.color = st.color;
  }
}

async function manualSyncByTab(tabId) {
  if (TAB_SYNC_BUSY[tabId]) return;
  if (!GSHEET_API_URL) {
    _setTabSyncStatus(tabId, 'fail', '⚠️ 재동기화 설정 필요');
    showToast('재동기화 설정 후 사용해주세요', 'warn');
    return;
  }
  TAB_SYNC_BUSY[tabId] = true;
  const btn = $el('sync-btn-' + tabId);
  if (btn) btn.disabled = true;
  _setTabSyncStatus(tabId, 'syncing', '⏳ 동기화 중...');

  let ok = false;
  try {
    if (tabId === 'div') {
      const r1 = await persistDividendSettings(true);
      ok = !!r1;
    } else if (tabId === 'asset') {
      const r1 = await persistRealEstateSettings(true);
      ok = !!r1;
    } else {
      // ★ 기초정보 탭: 로컬 데이터 있으면 로컬→GAS, 없으면 GAS→로컬
      const hasLocalData = EDITABLE_PRICES.length > 0 || rawTrades.length > 0;
      if (hasLocalData) {
        // 로컬 데이터 있음 → GAS에 업로드
        const r0 = await saveSettings(true);
        const r1 = await syncCodesToGsheet();
        await syncHoldingsToGsheet();
        await syncTradesToGsheet();
        ok = !!(r0 || r1);
        if (ok) {
          try { refreshAll(); } catch(e) {}
          try { if (typeof buildStockMgmt  === 'function') buildStockMgmt();  } catch(e) {}
          try { if (typeof buildSectorMgmt === 'function') buildSectorMgmt(); } catch(e) {}
          try { if (typeof buildAcctMgmt   === 'function') buildAcctMgmt();   } catch(e) {}
        }
      } else {
        // 로컬 데이터 없음 (새 기기) → GAS에서 불러오기
        const loaded = await loadSettings();
        if (loaded) {
          try { refreshAll(); } catch(e) {}
          try { if (typeof buildStockMgmt  === 'function') buildStockMgmt();  } catch(e) {}
          try { if (typeof buildSectorMgmt === 'function') buildSectorMgmt(); } catch(e) {}
          try { if (typeof buildAcctMgmt   === 'function') buildAcctMgmt();   } catch(e) {}
          ok = true;
        }
      }
    }
  } catch (e) {
    ok = false;
  } finally {
    TAB_SYNC_BUSY[tabId] = false;
    if (btn) btn.disabled = false;
  }

  if (ok) {
    _setTabSyncStatus(tabId, 'ok');
    showToast('재동기화 완료', 'ok');
  } else {
    _setTabSyncStatus(tabId, 'fail');
    showToast('재동기화 실패', 'error');
  }
}

async function loadSettings(onProgress) {
  const prog = onProgress || function(){};
  if (!GSHEET_API_URL) return false;
  try {
    prog('설정 데이터 로드 중...');
    const res = await fetchWithTimeout(GSHEET_API_URL + '?action=getSettings', 10000);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status !== 'ok' || !data.settings) return false;
    const s = data.settings;

    // ACCT_COLORS
    if (s.ACCT_COLORS && typeof s.ACCT_COLORS === 'object') {
      Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]);
      Object.entries(s.ACCT_COLORS).forEach(([k,v]) => {
        if (!k || !v) return; // ★ 빈 키/값 방어
        ACCT_COLORS[k] = (typeof v==='string' && v.startsWith('var('))
          ? resolveColor(v)   // var(--xxx) → hex 변환
          : v;
      });
    }
    // ACCT_ORDER
    if (Array.isArray(s.ACCT_ORDER)) {
      ACCT_ORDER.length = 0;
      s.ACCT_ORDER.forEach(a => ACCT_ORDER.push(a));
    }
    // SECTOR_COLORS
    if (s.SECTOR_COLORS && typeof s.SECTOR_COLORS === 'object') {
      Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
      Object.entries(s.SECTOR_COLORS).forEach(([k,v]) => {
        SECTOR_COLORS[k] = (typeof v==='string' && v.startsWith('var(')) ? resolveColor(v) : v;
      });
    }
    // fundDirect
    if (s.fundDirect && typeof s.fundDirect === 'object') {
      Object.keys(fundDirect).forEach(k => delete fundDirect[k]);
      Object.assign(fundDirect, s.fundDirect);
    }
    // EDITABLE_PRICES — 기초정보(종목명·코드·유형·섹터) 복원
    if (Array.isArray(s.EDITABLE_PRICES) && s.EDITABLE_PRICES.length > 0) {
      EDITABLE_PRICES.length = 0;
      // ★ normName 적용: 구버전 종목명 자동 변환 + 중복 제거
      const seenNames = new Set();
      const seenCodes = new Set();
      s.EDITABLE_PRICES.forEach(ep => {
        const normalizedName = (typeof normName === 'function') ? normName(ep?.name || '') : (ep?.name || '');
        if (!normalizedName) return;
        if (seenNames.has(normalizedName)) return;
        seenNames.add(normalizedName);
        const normalizedCode = _normalizeCodeForSync(ep?.code);
        if (normalizedCode && seenCodes.has(normalizedCode)) return;
        if (normalizedCode) seenCodes.add(normalizedCode);
        const next = {
          ...ep,
          name: normalizedName,
          code: normalizedCode,
          sector: ep?.sector || '기타',
          assetType: ep?.assetType || ep?.type || '주식',
        };
        EDITABLE_PRICES.push(next);
      });
      // STOCK_CODE master 동기화
      EDITABLE_PRICES.forEach(ep => { if (ep.name && ep.code) STOCK_CODE[ep.name] = _normalizeCodeForSync(ep.code); });
    }
    // ── GSheet 복원 후 localStorage 일괄 저장 (개별 중복 저장 제거)
    saveHoldings();
    saveAcctColors();
    saveAcctOrder();
    const divLoaded = await loadDividendSettings();   // 배당 별도 시트 우선
    const reLoaded  = await loadRealEstateSettings(); // 부동산/대출 별도 시트 우선

    // 하위 호환 fallback: 별도 시트 액션이 없으면 기존 Settings 시트 데이터 사용
    if (!divLoaded && s.DIVDATA && typeof s.DIVDATA === 'object') {
      _applyDivData(s.DIVDATA);
    }
    if (!reLoaded && s.LOAN && typeof s.LOAN === 'object') {
      Object.assign(LOAN, {
        ...s.LOAN,
        originalAmt: _toNum(s.LOAN.originalAmt, LOAN.originalAmt),
        balance: _toNum(s.LOAN.balance, LOAN.balance),
        annualRate: _toNum(s.LOAN.annualRate, LOAN.annualRate),
        totalMonths: _toNum(s.LOAN.totalMonths, LOAN.totalMonths),
        remainingMonths: _toNum(s.LOAN.remainingMonths, LOAN.remainingMonths),
        monthlyInterestPaid: _toNum(s.LOAN.monthlyInterestPaid, LOAN.monthlyInterestPaid),
        totalInterestPaid: _toNum(s.LOAN.totalInterestPaid, LOAN.totalInterestPaid),
      });
    }
    if (!reLoaded && s.REAL_ESTATE && typeof s.REAL_ESTATE === 'object') {
      Object.assign(REAL_ESTATE, {
        ...s.REAL_ESTATE,
        currentValue: _toNum(s.REAL_ESTATE.currentValue, REAL_ESTATE.currentValue),
        purchasePrice: _toNum(s.REAL_ESTATE.purchasePrice, REAL_ESTATE.purchasePrice),
        taxCost: _toNum(s.REAL_ESTATE.taxCost, REAL_ESTATE.taxCost),
        interiorCost: _toNum(s.REAL_ESTATE.interiorCost, REAL_ESTATE.interiorCost),
        etcCost: _toNum(s.REAL_ESTATE.etcCost, REAL_ESTATE.etcCost),
      });
    }
    if (!reLoaded && Array.isArray(s.LOAN_SCHEDULE)) {
      LOAN_SCHEDULE.length = 0;
      s.LOAN_SCHEDULE.forEach(r => {
        if (!r || !r.date) return;
        LOAN_SCHEDULE.push({
          date: String(r.date),
          balance: _toNum(r.balance, 0),
          principal: _toNum(r.principal, 0),
          interest: _toNum(r.interest, 0),
        });
      });
    }
    if (!reLoaded && Array.isArray(s.RE_VALUE_HIST)) {
      RE_VALUE_HIST.length = 0;
      s.RE_VALUE_HIST.forEach(r => {
        if (!r || !r.date) return;
        RE_VALUE_HIST.push({ date: String(r.date), value: _toNum(r.value, 0) });
      });
    }

    // ── 거래이력 복원 (localStorage가 비어있을 때만 — 기존 데이터 우선)
    if (rawTrades.length === 0) {
      try {
        prog('거래이력 복원 중...');
        const trRes  = await fetchWithTimeout(GSHEET_API_URL + '?action=getTrades', 15000);
        const trData = await trRes.json();
        if (trData.status === 'ok' && Array.isArray(trData.trades) && trData.trades.length > 0) {
          rawTrades.length = 0;
          trData.trades.forEach(t => {
            rawTrades.push({ ...t, id: t.id || genTradeId() });
          });
          syncHoldingsFromTrades();
          saveHoldings();
        } else {
          // ── 거래이력도 없을 때 → 보유현황 시트에서 직접 복원 (최후 fallback)
          try {
            prog('보유현황 복원 중...');
            const hRes  = await fetchWithTimeout(GSHEET_API_URL + '?action=getHoldings', 15000);
            const hData = await hRes.json();
            if (hData.status === 'ok' && Array.isArray(hData.holdings) && hData.holdings.length > 0) {
              rawHoldings.length = 0;
              hData.holdings.forEach(h => {
                // ★ fundDirect 항목(TDF/펀드, qty=1 & 코드 없음)은 fundDirect로 복원
                const isFundEntry = ['TDF','펀드'].includes(h.assetType) && !h.code && h.qty === 1;
                if (isFundEntry) {
                  fundDirect[h.name] = { eval: h.costAmt || 0, cost: h.costAmt || 0, type: h.assetType || 'TDF' };
                  return;
                }
                rawHoldings.push({
                  acct:      h.acct      || '기타',
                  name:      h.name      || '',
                  code:      h.code      || '',
                  qty:       h.qty       || 0,
                  cost:      h.qty > 0 ? (h.costAmt / h.qty) : 0,
                  assetType: h.assetType || '주식',
                });
              });
              saveHoldings();
            }
          } catch(e) { console.warn('보유현황 복원 실패:', e); }
        }
      } catch(e) { console.warn('거래이력 복원 실패:', e); }
    }

    return true;
  } catch(e) {
    console.warn('loadSettings 실패:', e);
    return false;
  }
}

// AbortSignal.timeout 미지원 브라우저 대응
function fetchWithTimeout(url, ms, options) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

let _gsBootRestored = false;
async function bootstrapGsheetSettings() {
  if (_gsBootRestored) return;
  if (!GSHEET_API_URL) return;
  _gsBootRestored = true;
  try {
    const ok = await loadSettings();
    if (!ok) {
      // Settings 시트 읽기 실패 시에도 배당/부동산 별도 액션은 시도
      try { await loadDividendSettings(); } catch(e) {}
      try { await loadRealEstateSettings(); } catch(e) {}
    }
    try { refreshAll(); } catch(e) {}
    try { if (typeof _mgmtRefresh === 'function') _mgmtRefresh(); } catch(e) {}
    try { await loadGsheetCodeList(); } catch(e) {}
  } catch(e) {
    console.warn('bootstrapGsheetSettings 실패:', e);
  }
}
function saveGsheetUrl(url) {
  GSHEET_API_URL = url.trim();
  lsSave(GSHEET_KEY, GSHEET_API_URL);
}