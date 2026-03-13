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

function _toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
  Object.entries(raw).forEach(([name, v]) => {
    const prev = (v && typeof v === 'object') ? v : {};
    next[name] = {
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
  if (!GSHEET_API_URL) return;
  clearTimeout(_saveDividendTimer);
  const delay = immediate ? 0 : 2500;
  _saveDividendTimer = setTimeout(async () => {
    try {
      const body = 'action=saveDividendSettings&data=' + encodeURIComponent(JSON.stringify(DIVDATA));
      await fetchWithTimeout(GSHEET_API_URL, 15000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch(e) {
      // 별도 배당 저장 미지원 Apps Script면 기존 saveSettings(DIVDATA 포함)로 백업됨
      console.warn('saveDividendSettings 실패:', e);
    }
  }, delay);
}

function saveRealEstateSettings(immediate) {
  if (!GSHEET_API_URL) return;
  clearTimeout(_saveRealEstateTimer);
  const delay = immediate ? 0 : 2500;
  _saveRealEstateTimer = setTimeout(async () => {
    try {
      const payload = {
        LOAN,
        REAL_ESTATE,
        LOAN_SCHEDULE,
        RE_VALUE_HIST,
      };
      const body = 'action=saveRealEstateSettings&data=' + encodeURIComponent(JSON.stringify(payload));
      await fetchWithTimeout(GSHEET_API_URL, 15000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch(e) {
      console.warn('saveRealEstateSettings 실패:', e);
    }
  }, delay);
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

function _toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

function saveSettings(immediate) {
  if (!GSHEET_API_URL) return;
  clearTimeout(_saveSettingsTimer);
  const delay = immediate ? 0 : 4000;
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
      await fetchWithTimeout(GSHEET_API_URL, 15000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch(e) {
      console.warn('saveSettings 실패:', e);
    }
  }, delay);
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
        ACCT_COLORS[k] = (typeof v==='string' && v.startsWith('var(')) ? resolveColor(v) : v;
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
      s.EDITABLE_PRICES.forEach(ep => EDITABLE_PRICES.push(ep));
      // STOCK_CODE master 동기화 (원칙8: HTML STOCK_CODE가 master)
      EDITABLE_PRICES.forEach(ep => { if (ep.name && ep.code) STOCK_CODE[ep.name] = ep.code; });
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
    if (ok) {
      try { refreshAll(); } catch(e) {}
      try { if (typeof _mgmtRefresh === 'function') _mgmtRefresh(); } catch(e) {}
    }
    try { await loadGsheetCodeList(); } catch(e) {}
  } catch(e) {
    console.warn('bootstrapGsheetSettings 실패:', e);
  }
}
function saveGsheetUrl(url) {
  GSHEET_API_URL = url.trim();
  lsSave(GSHEET_KEY, GSHEET_API_URL);
}

// ── 구글시트 종목코드 목록 로드
let _gsheetCodeList = []; // [{code, name}]

async function loadGsheetCodeList() {
  if (!GSHEET_API_URL) return;
  try {
    const url = GSHEET_API_URL + '?action=getCodeList';
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.codes)) {
      _gsheetCodeList = data.codes;
      // ⚠️ STOCK_CODE는 건드리지 않음 — HTML 직접 입력이 항상 우선
      // GSheet 코드는 _gsheetCodeList에만 보관, lookupNameByCode()에서 3순위 참고용으로만 사용
    }
  } catch(e) {
  }
}

// ── 종목코드 GSheet 자동 등록
async function syncCodesToGsheet() {
  if (!GSHEET_API_URL) return;
  try {
    // ★ EDITABLE_PRICES 기준으로 {name: {code, type, sector}} 구조 전송
    // type/sector를 함께 보내야 GAS에서 유형 컬럼을 덮어쓰지 않음
    const codeMap = {};
    EDITABLE_PRICES.forEach(i => {
      if (!i.name) return;
      codeMap[i.name] = {
        code:   i.code      || '',
        type:   i.assetType || i.type || '주식',
        sector: i.sector    || '기타',
      };
    });
    // STOCK_CODE에만 있는 항목도 병합 (하위 호환 — 코드만 있고 EDITABLE_PRICES 미등록 종목)
    Object.entries(STOCK_CODE).forEach(([n, c]) => {
      if (n && c && !codeMap[n]) codeMap[n] = { code: c, type: '주식', sector: '기타' };
    });
    if (Object.keys(codeMap).length === 0) { console.warn('[syncCodes] 전송할 코드 없음'); return null; }
    const body = 'action=syncCodes&codes=' + encodeURIComponent(JSON.stringify(codeMap));
    const res = await fetchWithTimeout(GSHEET_API_URL, 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[GSheet 동기화] HTTP', res.status); return null; }
    const data = await res.json();
    if (data.status !== 'ok') { console.warn('[GSheet 동기화] 응답 오류', data); return null; }
    return data; // { synced, updated, removed, total }
  } catch(e) {
    console.warn('[GSheet 동기화] 예외:', e);
    return null;
  }
}

// ★ v8.1 — 보유현황 GSheet 동기화 (트리거 자동 스냅샷을 위해 필요)
// rawHoldings(수량·원금)를 GSheet 보유현황 시트에 저장
async function syncHoldingsToGsheet() {
  if (!GSHEET_API_URL) return;
  try {
    // rows에서 종목별 합산 데이터 추출 (계좌 합산 기준)
    const holdMap = {};
    rawHoldings.forEach(h => {
      if (!h.name || h.qty <= 0) return;
      const ep   = getEP(h.name);
      const code = ep?.code || STOCK_CODE[h.name] || '';
      const key  = h.name;
      if (!holdMap[key]) holdMap[key] = { code, name: h.name, qty: 0, costAmt: 0, assetType: getEPType(ep, h.type), accts: [] };
      if (h.acct && !holdMap[key].accts.includes(h.acct)) holdMap[key].accts.push(h.acct);
      holdMap[key].qty     += h.qty;
      holdMap[key].costAmt += (h.qty * (h.cost || 0));
    });
    // ★ fundDirect(TDF/펀드) 항목 추가 — qty 개념 없으므로 qty=1, costAmt=cost로 저장
    Object.entries(fundDirect).forEach(([name, fd]) => {
      if (!name || !fd || fd.cost <= 0) return;
      if (holdMap[name]) return; // rawHoldings에 이미 있으면 중복 스킵
      holdMap[name] = { code: '', name, qty: 1, costAmt: fd.cost || 0, assetType: fd.type || 'TDF' };
    });
    // accts 배열 → acct 문자열로 변환 (쉼표 연결)
    Object.values(holdMap).forEach(h => { h.acct = (h.accts||[]).join(','); delete h.accts; });
    const holdings = Object.values(holdMap).filter(h => h.qty > 0);
    if (holdings.length === 0) return;

    const body = 'action=syncHoldings&data=' + encodeURIComponent(JSON.stringify(holdings));
    const res  = await fetchWithTimeout(GSHEET_API_URL, 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[보유현황 동기화] HTTP', res.status); return; }
    const data = await res.json();
    if (data.status === 'ok') console.log('[보유현황 동기화] ✅', data.synced + '개');
  } catch(e) {
    console.warn('[보유현황 동기화]', e.message);
  }
}

// ★ v8.2 — 거래이력 GSheet 동기화 (backfillMonth 소급 계산용)
async function syncTradesToGsheet() {
  if (!GSHEET_API_URL || rawTrades.length === 0) return;
  try {
    const trades = rawTrades
      .filter(t => t.name && t.tradeType && t.date)
      .map(t => ({
        date:      t.date,
        tradeType: t.tradeType,
        acct:      t.acct      || '',
        name:      t.name,
        code:      t.code      || STOCK_CODE[t.name] || '',
        qty:       t.qty       || 0,
        price:     t.price     || 0,
        assetType: t.assetType || '주식',
        memo:      t.memo      || '',
      }));
    if (trades.length === 0) return;

    const body = 'action=syncTrades&data=' + encodeURIComponent(JSON.stringify(trades));
    const res  = await fetchWithTimeout(GSHEET_API_URL, 30000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[거래이력 동기화] HTTP', res.status); return; }
    const data = await res.json();
    if (data.status === 'ok') console.log('[거래이력 동기화] ✅', data.synced + '건');
  } catch(e) {
    console.warn('[거래이력 동기화]', e.message);
  }
}

async function lookupNameByCode(code) {
  if (!code) return '';
  const trimCode = code.trim();
  // 1. EDITABLE_PRICES 역방향 검색 (최우선)
  const epItem = getEPByCode(trimCode);
  if (epItem) return epItem.name;
  // 2. 로컬 STOCK_CODE 역방향 검색
  const localEntry = Object.entries(STOCK_CODE).find(([n,c]) => c.trim() === trimCode);
  if (localEntry) return localEntry[0];
  // 3. GSheet 캐시 검색
  const gItem = _gsheetCodeList.find(item => item.code === trimCode);
  if (gItem) return gItem.name;
  // 4. GSheet API 조회 (GOOGLEFINANCE name)
  if (!GSHEET_API_URL) return '';
  try {
    const url = GSHEET_API_URL + '?action=name&code=' + encodeURIComponent(trimCode);
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return '';
    const data = await res.json();
    return data.name || data.officialName || '';
  } catch(e) { return ''; }
}
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

    window._gsheetMissingCodes = missingCodes;
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
      setStatusLabel(`📦 캐시 종가 사용 중 · ${cacheCount}/${total}개 · <button onclick="switchView('gsheet')" class="btn-link-blue">🔗 구글시트 연동 →</button>`, 'warn');
    } else {
      setStatusLabel('💡 구글시트 연동 시 자동 종가 조회 · <button onclick="switchView(\'gsheet\')" class="btn-link-blue">🔗 연동하기 →</button>', 'idle');
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
        updateDateBadge(todayLabel, false);
        setStatusLabel('❌ 종가 조회 실패 · 구글시트 연동 및 종목코드 등록 확인 필요', 'error');
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

// ── NAV 패널: buildEditorUI 완료 후 펀드·TDF 있으면 자동 표시
// mgmt_editor.js의 buildEditorUI에서 fund 항목 생성 직후 호출됨
function _showNavPanelIfNeeded() {
  const navPanel = $el('pe-panel-nav');
  if (!navPanel) return;
  // fund 항목이 editorBody 안에 있으면 NAV 패널 표시
  const hasFund = !!$el('editorBody')?.querySelector('.nav-price-inp, [data-fund="true"]');
  // fundDirect 키가 있어도 표시
  const hasFundDirect = Object.keys(window.fundDirect || {}).length > 0;
  navPanel.style.display = (hasFund || hasFundDirect) ? '' : 'none';
  // navDate 오늘 날짜로 초기화
  const nd = $el('navDate');
  if (nd && !nd.value) {
    const d = new Date();
    nd.value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  // navPriceRows: fundDirect 항목을 입력란으로 채움 (mgmt_editor.js 미호출 시 fallback)
  const rows = $el('navPriceRows');
  if (rows && hasFundDirect) {
    let h = '';
    Object.keys(fundDirect).forEach(name => {
      const cur = fundDirect[name]?.eval || '';
      h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--text)">${name}</span>
        <input type="number" class="nav-price-inp w-150" data-name="${name}" placeholder="NAV 입력" value="${cur || ''}"
          style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem;text-align:right;width:130px">
      </div>`;
    });
    rows.innerHTML = h || '<div style="font-size:.72rem;color:var(--muted)">등록된 펀드·TDF 없음</div>';
  }
}

// GS URL이 이미 저장돼 있으면 앱 시작 시 1회 자동 복원
setTimeout(() => { bootstrapGsheetSettings(); }, 0);
