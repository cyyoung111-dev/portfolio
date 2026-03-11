const $el = id => document.getElementById(id);
const lsSave   = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} };
const lsGet    = (key, def) => { try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) : def; } catch(e) { return def; } };
const lsRemove = (key) => { try { localStorage.removeItem(key); } catch(e) {} };

// 필터 버튼 클래스 헬퍼
function _fBtnClass(active) { return active ? 'f-btn active' : 'f-btn'; }

// 배당 탭 — 배당 주기 버튼 선택
// nameKey = name.replace(/\s/g,'_') 형태, hidden input id와 일치
function _dvPickFreq(nameKey, freq) {
  // 버튼 active 클래스 갱신
  const grp = $el('dv_freq_grp_' + nameKey);
  if (grp) {
    grp.querySelectorAll('button').forEach(btn => {
      btn.className = _fBtnClass(btn.textContent.trim() === freq);
    });
  }
  // hidden input 값 갱신 → applyDivChanges()가 이 값을 읽음
  const inp = $el('dv_freq_' + nameKey);
  if (inp) inp.value = freq;
  // 지급월 자동 추천 (월배당이면 전체, '-' 이면 클리어)
  const monthsEl = $el('dv_months_' + nameKey);
  if (monthsEl) {
    if (freq === '월배당') monthsEl.value = '1,2,3,4,5,6,7,8,9,10,11,12';
    else if (freq === '-') monthsEl.value = '';
  }
  // DIVDATA는 applyDivChanges() 호출 시 일괄 저장되므로
  // 여기서는 hidden input 갱신만으로 충분 (즉시 저장 불필요)
}

const pColor = v => v >= 0 ? 'var(--green)' : 'var(--red)';
const pSign  = v => v >= 0 ? '+' : '';

// 토스트 알림 헬퍼 (alert 대체)
// type: 'ok' | 'error' | 'warn' | 'info'
function showToast(msg, type='info', duration=3200) {
  const container = $el('toast-container');
  if (!container) { alert(msg); return; }
  const icons = {ok:'✅', error:'❌', warn:'⚠️', info:'💡'};
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), {once:true});
  }, duration);
}

// DATA
// 계좌 색상 팔레트 (신규 계좌 추가 시 순환 사용)
const ACCT_PALETTE = ['var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)','var(--pink)','var(--cyan)','var(--gold2)','#84cc16','var(--purple-lt)'];

// ─────────────────────────────────────────────────────────────
// resolveColor: CSS 변수 → Canvas/HTML 실제 색상값 변환
//
// ★ 규칙 (절대 변경 금지) ★
//  1. Canvas fillStyle/strokeStyle 에는 반드시 resolveColor() 통과값만 사용
//  2. ctx.fillStyle = 'var(--xxx)'  ← 직접 전달 절대 금지
//  3. ctx.fillStyle = resolveColor('var(--xxx)')  ← 항상 이 형태
//  4. 이 함수 자체와 _CSS_VAR_MAP 을 수정할 때는 donut 렌더링 전체를 테스트할 것
// ─────────────────────────────────────────────────────────────

// CSS 변수 → hex 고정 매핑 (getComputedStyle 의존 제거 — 항상 올바른 색상 보장)
const _CSS_VAR_MAP = {
  '--bg':         '#080d18',
  '--s1':         '#0e1726',
  '--s2':         '#141f33',
  '--border':     '#1c2a42',
  '--green':      '#10b981',
  '--red':        '#E52E2E',
  '--blue':       '#0057FF',
  '--amber':      '#f59e0b',
  '--purple':     '#8b5cf6',
  '--cyan':       '#06b6d4',
  '--pink':       '#ec4899',
  '--text':       '#e2e8f0',
  '--muted':      '#64748b',
  '--gold':       '#f59e0b',
  '--gold2':      '#f97316',
  '--red-lt':     '#FF6B6B',
  '--green-lt':   '#4ade80',
  '--green-md':   '#34d399',
  '--blue-lt':    '#5B8EFF',
  '--purple-lt':  '#a78bfa',
  '--purple-dk':  '#7c3aed',
};

const _colorCache = {};
function resolveColor(c) {
  if (!c || typeof c !== 'string') return 'var(--muted)';
  const cs = c.trim();
  // 이미 hex / rgb / rgba → 그대로
  if (cs.startsWith('#') || cs.startsWith('rgb')) return cs;
  // var(--xxx) 형식
  if (cs.startsWith('var(--')) {
    if (_colorCache[cs]) return _colorCache[cs];
    const varName = cs.slice(4, -1).trim(); // '--green'
    // 1순위: 고정 매핑
    if (_CSS_VAR_MAP[varName]) {
      _colorCache[cs] = _CSS_VAR_MAP[varName];
      return _colorCache[cs];
    }
    // 2순위: getComputedStyle (사용자 커스텀 변수 대응)
    try {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (resolved && !resolved.startsWith('var(')) {
        _colorCache[cs] = resolved;
        return _colorCache[cs];
      }
    } catch(e) { console.warn('[resolveColor]', e.message); }
    // fallback
    _colorCache[cs] = 'var(--muted)';
    return 'var(--muted)';
  }
  // 그 외 (named color 등) → 그대로
  return cs;
}

// ════════════════════════════════════════════════════════════════
//  데이터 · 비즈니스 로직
// ════════════════════════════════════════════════════════════════

let ACCT_COLORS = {};  // localStorage 복원 (KEY 선언 후 아래에서 복원)

function saveAcctColors() {
  // ACCT_COLORS: var() 문자열 → hex 변환 후 저장 (Canvas fillStyle 깨짐 방지)
  Object.keys(ACCT_COLORS).forEach(k => {
    if (typeof ACCT_COLORS[k] === 'string' && ACCT_COLORS[k].startsWith('var('))
      ACCT_COLORS[k] = resolveColor(ACCT_COLORS[k]);
  });
  lsSave(ACCT_COLORS_KEY, ACCT_COLORS);
}

function getAcctNames() {
  // rawTrades + rawHoldings + ACCT_COLORS 등록 계좌 모두 포함
  const fromTrades   = rawTrades.map(t => t.acct).filter(Boolean);
  const fromHoldings = rawHoldings.map(h => h.acct).filter(Boolean);
  const fromColors   = Object.keys(ACCT_COLORS);
  return [...new Set(['전체', ...fromColors, ...fromTrades, ...fromHoldings])];
}

// '전체' 제외 계좌 목록 단축 헬퍼
function getAcctList() {
  return getAcctNames().filter(a => a !== '전체');
}

function getOrAssignColor(acct) {
  if (!ACCT_COLORS[acct]) {
    const used = Object.values(ACCT_COLORS);
    const next = ACCT_PALETTE.find(c => !used.includes(c)) || ACCT_PALETTE[Object.keys(ACCT_COLORS).length % ACCT_PALETTE.length];
    ACCT_COLORS[acct] = resolveColor(next); // ★ 원칙3: 대입 시점에 var()→hex 변환
    saveAcctColors();
    if (!ACCT_ORDER.includes(acct)) { ACCT_ORDER.push(acct); saveAcctOrder(); }
  }
  return ACCT_COLORS[acct];
}

function normName(n){
  const MAP = {
    'TIME Korea플러스배당액티브': 'TIMEFOLIO Korea플러스배당액티브',
  };
  return MAP[n] || n;
}
let SECTOR_COLORS = {}; // 섹터 색상: 기초정보 관리탭에서 직접 입력

let fundDirect = {}; // localStorage 또는 GSheet 복원으로 채워짐

const prices = {};  // 구글시트 자동 조회로 채워짐

const STOCK_CODE = {};  // 거래 이력 입력 시 자동 누적, localStorage 복원
let rawHoldings = [];  // localStorage 또는 rawTrades에서 자동 복원
//  거래 이력 (rawTrades)
//  {id, acct, type, name, code, qty, buyDate, buyPrice, sellDate, sellPrice, memo}
let rawTrades = [];

function genTradeId() {
  return 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
}

// rawTrades → rawHoldings 동기화
// 데이터 우선순위: ① EDITABLE_PRICES(기초정보) → ② rawTrades(거래이력) → ③ rawHoldings
//  데이터 우선순위:
//  ① EDITABLE_PRICES (기초정보 관리탭) — 코드·섹터·타입의 최고 기준
//  ② rawTrades (거래 이력탭)           — 수량·단가·계좌의 기준
//  ③ rawHoldings                       — ①②를 합산한 결과물
//  ④ rows                              — ③ + 현재가 계산 결과물
// ── 레거시 거래 레코드 → 새 형식 자동 마이그레이션
// 구형: { buyDate, buyPrice, sellDate, sellPrice } 한 레코드에 묶인 형식
// 신형: tradeType:'buy' | 'sell' 로 분리된 형식
function migrateLegacyTrades() {
  let changed = false;
  const toAdd = [];
  const toRemove = [];

  rawTrades.forEach(t => {
    // 이미 새 형식이면 스킵
    if (t.tradeType) return;

    // 구형 레코드를 새 형식으로 변환
    changed = true;
    // 매수 레코드
    const buyRec = {
      id: t.id,
      tradeType: 'buy',
      acct: t.acct, assetType: t.type || '주식',  // t.type: 구형 레코드 필드 (마이그레이션 전용)
      name: t.name, code: t.code || '',
      qty: t.qty || 0, price: t.buyPrice || 0,
      date: t.buyDate || '', memo: t.memo || '',
      fund: t.fund || false,
    };
    toAdd.push(buyRec);

    // 매도 레코드 (sellDate 있을 때만)
    if (t.sellDate && t.sellPrice) {
      toAdd.push({
        id: genTradeId(),
        tradeType: 'sell',
        acct: t.acct, assetType: t.type || '주식',  // t.type: 구형 레코드 필드 (마이그레이션 전용)
        name: t.name, code: t.code || '',
        qty: t.qty || 0, price: t.sellPrice || 0,
        date: t.sellDate, memo: t.memo || '',
        fund: t.fund || false,
      });
    }
    toRemove.push(t.id);
  });

  if (changed) {
    toRemove.forEach(id => {
      const idx = rawTrades.findIndex(t => t.id === id);
      if (idx !== -1) rawTrades.splice(idx, 1);
    });
    toAdd.forEach(t => rawTrades.push(t));
    // 날짜순 정렬
    rawTrades.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  }

  // id 없는 레코드 자동 보정 (레거시 데이터 안전망)
  let idFixed = 0;
  rawTrades.forEach(t => {
    if (!t.id) { t.id = genTradeId(); idFixed++; }
  });

}

// ── 계좌+종목별 평균매수단가 계산 (FIFO 누적 방식)
function calcRealizedPnl() {
  const sorted = [...rawTrades].sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const costMap = {}; // acct||name → { qty, totalCost }
  let totalPnl = 0, totalCost = 0;

  sorted.forEach(t => {
    if (!t.name || !t.acct || !t.tradeType) return;
    const key = t.acct + '||' + t.name;
    if (!costMap[key]) costMap[key] = { qty: 0, totalCost: 0 };
    if (t.tradeType === 'buy') {
      costMap[key].qty       += (t.qty || 0);
      costMap[key].totalCost += (t.qty || 0) * (t.price || 0);
    } else if (t.tradeType === 'sell') {
      const avgCost = costMap[key].qty > 0 ? costMap[key].totalCost / costMap[key].qty : 0;
      const sellQty = Math.min(t.qty || 0, costMap[key].qty);
      const pnl = (t.price - avgCost) * sellQty;
      totalPnl  += pnl;
      totalCost += avgCost * sellQty;
      costMap[key].qty       -= sellQty;
      costMap[key].totalCost -= sellQty * avgCost;
      if (costMap[key].qty <= 0) { costMap[key].qty = 0; costMap[key].totalCost = 0; }
    }
  });
  const pct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
  return { totalPnl, totalCost, pct };
}

function syncHoldingsFromTrades() {
  if (rawTrades.length === 0) return;

  // 레거시 데이터 자동 마이그레이션
  migrateLegacyTrades();

  // ── Step 1: 매수/매도 분리하여 보유 수량·평균단가 계산
  const map = {};
  const sorted = [...rawTrades].sort((a,b) => (a.date||'').localeCompare(b.date||''));

  sorted.filter(t => t.name && t.acct).forEach(t => {
    const key = t.acct + '||' + t.name;
    if (!map[key]) {
      // 우선순위 ①: EDITABLE_PRICES.assetType/type  ②: 거래이력.assetType  ③: '주식'
      const _ep = getEP(t.name);
      const epType = getEPType(_ep, t.assetType);
      map[key] = { acct: t.acct, name: t.name, type: epType, qty: 0, totalCost: 0, fund: !!t.fund };
    }
    if (t.tradeType === 'buy') {
      map[key].qty       += (t.qty || 0);
      map[key].totalCost += (t.qty || 0) * (t.price || 0);
    } else if (t.tradeType === 'sell') {
      const avgCost = map[key].qty > 0 ? map[key].totalCost / map[key].qty : 0;
      const sellQty = Math.min(t.qty || 0, map[key].qty);
      map[key].qty       -= sellQty;
      map[key].totalCost -= sellQty * avgCost;
      if (map[key].qty < 0.0001) { map[key].qty = 0; map[key].totalCost = 0; }
    }
  });

  // ── Step 2: rawHoldings 재생성
  const newH = Object.values(map).filter(m => m.qty > 0).map(m => ({
    acct: m.acct, type: m.type, name: m.name, qty: m.qty,
    cost: m.qty > 0 ? Math.round(m.totalCost / m.qty) : 0,
    ...(m.fund ? {fund: true} : {})
  }));
  if (newH.length > 0) {
    rawHoldings.length = 0;
    newH.forEach(h => rawHoldings.push(h));
  }

  // ── Step 3: 거래이력 종목을 EDITABLE_PRICES에 자동 등록
  // 우선순위: EDITABLE_PRICES에 없는 종목만 추가, 있으면 절대 덮어쓰지 않음
  if (typeof EDITABLE_PRICES !== 'undefined') {
    rawTrades.filter(t => t.name).forEach(t => {
      if (!getEP(t.name)) {
        const code = t.code || STOCK_CODE[t.name] || '';
        // sector는 '기타'로 — 사용자가 기초정보 관리탭에서 직접 설정해야 함
        epPush(t.name, code, t.assetType);
        if (code) STOCK_CODE[t.name] = code;
      }
    });
  }
}

//  holdings localStorage 저장/불러오기
//  키를 고정값으로 사용 (파일 경로 무관)
const ACCT_COLORS_KEY   = 'pf_v6_acct_colors';
const ACCT_ORDER_KEY    = 'pf_v6_acct_order';
const SECTOR_COLORS_KEY = 'pf_v6_sector_colors';
const LOAN_KEY          = 'pf_v6_loan';
const REALESTATE_KEY    = 'pf_v6_realestate';
const LOAN_SCHEDULE_KEY = 'pf_v6_loan_schedule'; // 상환스케줄 CSV 데이터
const RE_VALUE_KEY      = 'pf_v6_re_value_hist'; // 부동산 시가 이력
const FUNDDIRECT_KEY    = 'pf_v6_funddirect';
const DIVDATA_KEY       = 'pf_v6_divdata';
const PRICES_KEY        = 'pf_v6_prices';
const PRICE_DATES_KEY   = 'pf_v6_price_dates';
const LAST_UPDATED_KEY  = 'pf_v6_last_updated';
const GSHEET_KEY        = 'gsheet_api_url';
const TAB_ORDER_KEY     = 'pf_v6_tab_order';
const HOLDINGS_KEY   = 'pf_v6_holdings';
const STOCKCODE_KEY  = 'pf_v6_stockcodes';
const EDITABLES_KEY  = 'pf_v6_editables';
const TRADES_KEY     = 'pf_v6_trades';

// ── localStorage 복원 (KEY 상수 선언 후 실행)
(function(){
  const saved = lsGet(ACCT_COLORS_KEY, null);
  if (saved) {
    // var() 문자열 → hex 변환 (Canvas fillStyle 깨짐 방지)
    Object.entries(saved).forEach(([k, v]) => {
      ACCT_COLORS[k] = (typeof v === 'string' && v.startsWith('var(')) ? resolveColor(v) : v;
    });
  }
})();

function saveHoldings() {
  // 항상 저장 (기초정보 관리 변경도 저장되어야 함)
  try {
    lsSave(HOLDINGS_KEY, rawHoldings);
    lsSave(STOCKCODE_KEY, STOCK_CODE);
    lsSave(EDITABLES_KEY, EDITABLE_PRICES);
    lsSave(TRADES_KEY, rawTrades);
    // SECTOR_COLORS: var() 문자열 → hex 변환 후 저장 (도넛 색상 깨짐 방지)
    Object.keys(SECTOR_COLORS).forEach(k => {
      if (typeof SECTOR_COLORS[k] === 'string' && SECTOR_COLORS[k].startsWith('var('))
        SECTOR_COLORS[k] = resolveColor(SECTOR_COLORS[k]);
    });
    lsSave(SECTOR_COLORS_KEY, SECTOR_COLORS);
    lsSave(FUNDDIRECT_KEY, fundDirect);
    lsSave(DIVDATA_KEY, DIVDATA);
    // 현재가 캐시 저장
    if (Object.keys(savedPrices).length > 0) savePriceCache();
    saveAcctColors();
    saveAcctOrder();
    const badge = $el('holdingsSavedBadge');
    if (badge) {
      badge.style.display = 'inline';
      clearTimeout(badge._t);
      badge._t = setTimeout(() => { badge.style.display = 'none'; }, 2000);
    }
    // 구글시트 종목코드 백그라운드 동기화 (debounce 3초)
    clearTimeout(saveHoldings._syncTimer);
    saveHoldings._syncTimer = setTimeout(() => {
      syncCodesToGsheet();
      syncHoldingsToGsheet();   // ★ v8.1: 보유현황도 함께 동기화
      syncTradesToGsheet();     // ★ v8.2: 거래이력도 함께 동기화
      saveSettings();           // ★ 설정 GS 동기화 (브라우저 독립 복원)
    }, 3000);
  } catch(e) {
    console.error('saveHoldings 실패:', e);
    showToast('저장 실패: ' + e.message + ' · 브라우저 설정에서 로컬 저장소를 허용해주세요.', 'error', 5000);
  }
}

// ── LOAN / REAL_ESTATE 초기값 선언 (loadHoldings 복원보다 반드시 먼저 위치해야 함)
let LOAN = {
  originalAmt: 0,
  balance: 0,
  annualRate: 0,
  totalMonths: 0,
  remainingMonths: 0,
  startYear: new Date().getFullYear(),
  startDate: '',          // 대출실행일 (YYYY-MM-DD)
  monthlyInterestPaid: 0, // 실제 이자지급액 (원, 이번달 기준)
  totalInterestPaid: 0,   // 누적 이자 지급액 (대출 실행일부터 현재까지 합산)
};
let REAL_ESTATE = {
  currentValue: 0,        // 실거래가 (0이면 미입력)
  purchasePrice: 0,       // 매입가
  taxCost: 0,             // 취득세 등 세금
  interiorCost: 0,        // 인테리어 비용
  etcCost: 0,             // 기타 비용
  name: '보유 부동산',
  memo: '',
};

// ── 앱 시작 시 localStorage → rawHoldings 즉시 덮어쓰기
// rawHoldings 선언 직후, rows 계산 전에 실행
(function loadHoldings() {
  try {
    const savedH = lsGet(HOLDINGS_KEY, null);
    if (savedH && Array.isArray(savedH) && savedH.length > 0) {
      rawHoldings.length = 0;
      savedH.forEach(h => rawHoldings.push(h));
    }
    const savedC = lsGet(STOCKCODE_KEY, null);
    if (savedC) Object.assign(STOCK_CODE, savedC);
    // 거래 이력 불러오기
    const savedT = lsGet(TRADES_KEY, null);
    if (savedT && Array.isArray(savedT)) {
      rawTrades.length = 0;
      savedT.forEach(t => rawTrades.push(t));
      // ※ syncHoldingsFromTrades()는 EDITABLE_PRICES 로드 후 syncEditables()에서 호출
    }
    // EDITABLE_PRICES는 로드 후 재구성 (rawHoldings 기반으로 동기화)
    // LOAN / REAL_ESTATE 복원
    const savedLoan = lsGet(LOAN_KEY, null);
    if (savedLoan) { try { Object.assign(LOAN, savedLoan); } catch(e){} }
    const savedRE = lsGet(REALESTATE_KEY, null);
    if (savedRE) { try { Object.assign(REAL_ESTATE, savedRE); } catch(e){} }
    // fundDirect 복원
    const savedFD = lsGet(FUNDDIRECT_KEY, null);
    if (savedFD && typeof savedFD === 'object') { Object.keys(fundDirect).forEach(k => delete fundDirect[k]); Object.assign(fundDirect, savedFD); }
    // DIVDATA 복원
    const savedDD = lsGet(DIVDATA_KEY, null);
    if (savedDD && typeof savedDD === 'object') { Object.keys(DIVDATA).forEach(k => delete DIVDATA[k]); Object.assign(DIVDATA, savedDD); }
  } catch(e) {
    console.error('loadHoldings 실패:', e);
  }
})();

// PRICES STATE (선언을 computeRows 전으로 이동)
let savedPrices = {};
let savedPriceDates = {};
let lastUpdated = null;
let editedPrices = {};  // 현재가 편집기 임시 저장용

// ── 가격 캐시 localStorage 복원
(function restorePriceCache() {
  try {
    const sp = lsGet(PRICES_KEY, null);
    if (sp) Object.assign(savedPrices, sp);
    const sd = lsGet(PRICE_DATES_KEY, null);
    if (sd) Object.assign(savedPriceDates, sd);
    const lu = localStorage.getItem(LAST_UPDATED_KEY);
    if (lu && lu !== "null" && lu !== "undefined") lastUpdated = lu;
  } catch(e) { console.warn('가격 캐시 복원 실패:', e.message); }
})();

// ── 기존 이름 키 캐시 → 코드 키로 마이그레이션 (1회성, 이미 코드 키면 무시)
(function migratePriceCacheToCodeKey() {
  try {
    let migrated = 0;
    // EDITABLE_PRICES가 아직 로드 안 됐으므로 STOCK_CODE로 name→code 매핑
    Object.keys(savedPrices).forEach(key => {
      // 6자리 숫자면 이미 코드 키 → 스킵
      if (/^\d{6}$/.test(key)) return;
      const code = STOCK_CODE[key] || STOCK_CODE[normName(key)];
      if (code && /^\d{6}$/.test(code)) {
        if (!savedPrices[code]) {
          savedPrices[code] = savedPrices[key];
          if (savedPriceDates[key]) savedPriceDates[code] = savedPriceDates[key];
        }
        delete savedPrices[key];
        delete savedPriceDates[key];
        migrated++;
      }
    });
    if (migrated > 0) {
      if (migrated > 0) console.warn('[마이그레이션] 이름 키 → 코드 키 변환:', migrated, '개');
      lsSave(PRICES_KEY, savedPrices);
      lsSave(PRICE_DATES_KEY, savedPriceDates);
    }
  } catch(e) { console.warn('캐시 마이그레이션 실패:', e.message); }
})();

function computeRows(holdings) {
  return holdings.map(h => {
    if (h.fund) {
      const fd = fundDirect[h.name];
      if (!fd) return null;
      return {...h, qty:1, cost:fd.cost, evalAmt:fd.eval, costAmt:fd.cost, pnl:fd.eval-fd.cost, price:fd.eval, pct:(fd.eval-fd.cost)/fd.cost*100, sector:getSector(h.name), code:''};
    }
    const nn = normName(h.name);
    const code   = getCode(nn);
    // ★ 가격 우선순위: ① 코드 키 ② 이름 키(하위호환) ③ 취득단가
    const p = (code && savedPrices[code]) || savedPrices[nn] || savedPrices[h.name] || h.cost;
    const evalAmt = p * h.qty, costAmt = h.cost * h.qty;
    // 우선순위 ①: EDITABLE_PRICES.assetType 또는 .type
    //             ②: rawHoldings(거래이력 기반).type
    const ep = getEP(nn);
    const type = getEPType(ep, h.type);
    const sector = getSector(nn);
    return {...h, name:nn, type, sector, code, evalAmt, costAmt, pnl:evalAmt-costAmt, price:p, pct:(evalAmt-costAmt)/costAmt*100};
  }).filter(Boolean);
}

let rows = [];  // recomputeRows()로 초기화됨 (EDITABLE_PRICES 로드 후 refreshAll에서 호출)

function recomputeRows() {
  rows.length = 0;
  computeRows(rawHoldings).forEach(r => rows.push(r));
}

// FORMAT
function fmt(n){
  if(n===null||n===undefined||isNaN(n)) return '-';
  const sign=n<0?'-':'', a=Math.abs(n);
  if(a>=100000000){
    const uk=Math.floor(a/100000000);
    const man=Math.round((a%100000000)/10000);
    return sign+uk+'억'+(man>0?' '+man.toLocaleString()+'만':'');
  }
  if(a>=10000) return sign+Math.round(a/10000).toLocaleString()+'만';
  return sign+Math.round(a).toLocaleString();
}
function fmtW(n){return Math.round(n).toLocaleString()+'원';}
let _tradeFilter = { acct:'', name:'', type:'all' };   // all | buy | sell
let _tradeSort   = { key:'date', dir:-1 };            // key: date|name|acct|qty|price  dir: 1 asc / -1 desc

// ── 거래이력: 필터·정렬 적용 리스트 반환
function _getFilteredTrades() {
  let list = [...rawTrades];
  if (_tradeFilter.acct) list = list.filter(t => t.acct === _tradeFilter.acct);
  if (_tradeFilter.name) list = list.filter(t => t.name.includes(_tradeFilter.name));
  if (_tradeFilter.type === 'buy')  list = list.filter(t => t.tradeType === 'buy');
  if (_tradeFilter.type === 'sell') list = list.filter(t => t.tradeType === 'sell');
  const { key, dir } = _tradeSort;
  list.sort((a, b) => {
    let va, vb;
    if (key === 'date')  { va = a.date || a.buyDate || ''; vb = b.date || b.buyDate || ''; return dir * va.localeCompare(vb); }
    if (key === 'name')  { va = a.name || ''; vb = b.name || ''; return dir * va.localeCompare(vb, 'ko'); }
    if (key === 'acct')  { va = a.acct || ''; vb = b.acct || ''; return dir * va.localeCompare(vb, 'ko'); }
    if (key === 'qty')   { return dir * ((a.qty || 0) - (b.qty || 0)); }
    if (key === 'price') { return dir * ((a.price || 0) - (b.price || 0)); }
    return 0;
  });
  return list;
}

// ── 거래이력: 요약 카드 HTML 생성
function _buildTradesSummaryHTML() {
  const { totalPnl: realizedPnl, totalCost: realizedCost, pct: realizedPct } = calcRealizedPnl();
  const holdingCount = rawTrades.filter(t => t.tradeType === 'buy').length;
  const sellCount    = rawTrades.filter(t => t.tradeType === 'sell').length;
  const pC = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
  const pS = realizedPnl >= 0 ? '+' : '';
  return `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px">
      <div class="trade-stat-card">
        <div class="trade-stat-label">전체 거래</div>
        <div class="trade-stat-value">${rawTrades.length}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">매수 건수</div>
        <div class="trade-stat-value">${holdingCount}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">매도 건수</div>
        <div class="trade-stat-value">${sellCount}<span class="txt-70-400">건</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">실현손익</div>
        <div class="trade-stat-value" style="color:${pC}">${pS}${Math.round(realizedPnl).toLocaleString()}<span class="txt-70-400">원</span></div>
      </div>
      <div class="trade-stat-card">
        <div class="trade-stat-label">수익률</div>
        <div class="trade-stat-value" style="color:${pC}">${pS}${realizedPct.toFixed(1)}<span class="txt-70-400">%</span></div>
      </div>
    </div>`;
}

// ── 거래이력: 테이블 HTML 생성 (행별 평균단가 계산 포함)
function _buildTradesTableHTML(list) {
  const { key, dir } = _tradeSort;
  const headerCols = [
    {k:'acct',  label:'계좌',   align:'left',  cls:''},
    {k:'name',  label:'종목명', align:'left',  cls:''},
    {k:null,    label:'구분',   align:'center',cls:''},
    {k:'qty',   label:'수량',   align:'right', cls:''},
    {k:'date',  label:'날짜',   align:'left',  cls:'col-hide-mobile'},
    {k:'price', label:'단가',   align:'right', cls:''},
    {k:null,    label:'손익',   align:'right', cls:''},
  ];
  const headerHTML = headerCols.map(col => {
    if (!col.k) return `<th style="padding:9px 10px;text-align:${col.align};font-weight:600"${col.cls?` class="${col.cls}"`:''} >${col.label}</th>`;
    const active = _tradeSort.key === col.k;
    const arrow  = active ? (_tradeSort.dir === 1 ? ' ▲' : ' ▼') : ' ⇅';
    const color  = active ? 'color:var(--purple-lt)' : '';
    return `<th${col.cls?` class="${col.cls}"`:''}
      style="padding:9px 10px;text-align:${col.align};font-weight:600;white-space:nowrap;cursor:pointer;user-select:none;${color}"
      onclick="tradeSetSort('${col.k}')">${col.label}<span style="font-size:.60rem;opacity:.7">${arrow}</span></th>`;
  }).join('');

  const avgMap = {};
  const rowsHTML = list.map((t) => {
    const mapKey = t.acct + '||' + t.name;
    if (!avgMap[mapKey]) avgMap[mapKey] = { qty: 0, totalCost: 0 };
    const isBuy  = t.tradeType === 'buy';
    const isSell = t.tradeType === 'sell';
    const price  = t.price ?? 0;
    const date   = t.date  || '';
    let pnl = null, pct = null;
    if (isBuy) {
      avgMap[mapKey].qty       += (t.qty || 0);
      avgMap[mapKey].totalCost += (t.qty || 0) * price;
    } else if (isSell) {
      const avgCost = avgMap[mapKey].qty > 0 ? avgMap[mapKey].totalCost / avgMap[mapKey].qty : 0;
      pnl = (price - avgCost) * (t.qty || 0);
      pct = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : 0;
      const sellQty = Math.min(t.qty || 0, avgMap[mapKey].qty);
      avgMap[mapKey].qty       -= sellQty;
      avgMap[mapKey].totalCost -= sellQty * avgCost;
    }
    const pC = pnl === null ? '' : pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pS = pnl === null ? '' : pnl >= 0 ? '+' : '';
    const noDate = !date;
    const acctColor = ACCT_COLORS[t.acct] || 'var(--muted)';
    return `
      <tr style="border-bottom:1px solid var(--border);background:${noDate?'var(--c-red-04)':'transparent'};cursor:pointer"
          onclick="editTrade('${t.id}')">
        <td class="td-center-plain" onclick="event.stopPropagation()">
          <input type="checkbox" class="trade-cb trade-check" data-id="${t.id}"
            onchange="tradeCheckChange()" title="선택"/>
        </td>
        <td onclick="editTrade('${t.id}')">
          <span class="adot" style="background:${acctColor}" title="${t.acct}"></span>
          <span class="txt-60-muted">${t.acct||'-'}</span>
        </td>
        <td onclick="editTrade('${t.id}')">
          <div style="font-weight:600">${t.name||'-'}</div>
          ${t.code ? `<span class="txt-mono-muted">${t.code}</span>` : ''}
          ${t.memo ? `<div style="font-size:.60rem;color:var(--muted);margin-top:1px">📝 ${t.memo}</div>` : ''}
        </td>
        <td style="text-align:center" onclick="editTrade('${t.id}')">
          <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:.65rem;font-weight:700;
            background:${isBuy?'var(--c-green2-15)':'var(--c-red-12)'};
            color:${isBuy?'var(--green-lt)':'var(--red-lt)'}">
            ${isBuy?'매수':'매도'}
          </span>
        </td>
        <td class="td-right-plain" onclick="editTrade('${t.id}')">${(t.qty||0).toLocaleString()}</td>
        <td class="col-hide-mobile" style="font-size:.70rem;color:var(--muted)" onclick="editTrade('${t.id}')">
          ${date || '<span style="color:var(--red-lt);font-size:.60rem">날짜없음</span>'}
        </td>
        <td class="td-right-plain" onclick="editTrade('${t.id}')">
          ${price.toLocaleString()}원
        </td>
        <td class="td-right-plain" onclick="editTrade('${t.id}')">
          ${pnl !== null ? `
            <div style="color:${pC};font-weight:600">${pS}${Math.round(pnl).toLocaleString()}원</div>
            <div style="font-size:.65rem;color:${pC}">${pS}${pct!==null?pct.toFixed(1):'0.0'}%</div>
          ` : `<span class="c-muted">-</span>`}
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px">
      <table class="tbl-inner-sm">
        <thead>
          <tr style="background:var(--s2);color:var(--muted);border-bottom:1px solid var(--border)">
            <th style="padding:9px 10px;text-align:center;width:36px">
              <input type="checkbox" class="trade-cb" id="tradeCheckAll" onchange="tradeToggleAll(this.checked)" title="전체선택"/>
            </th>
            ${headerHTML}
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    ${list.length === 0 ? `<div class="empty-msg">필터 결과가 없어요</div>` : ''}`;
}

// ── 거래이력 뷰 (조합자)
function savePriceCache() {
  lsSave(PRICES_KEY, savedPrices);
  lsSave(PRICE_DATES_KEY, savedPriceDates);
  // null을 그대로 저장하면 "null" 문자열이 되어 날짜 비교 오작동 방지
  if (lastUpdated) {
    lsSave(LAST_UPDATED_KEY, lastUpdated);
  } else {
    lsRemove(LAST_UPDATED_KEY);
  }
}

function _commitTrades() {
  syncHoldingsFromTrades();
  saveHoldings();
  refreshAll();
}

// ★ 상환스케줄 기준으로 LOAN 자동 갱신
// - 페이지 로드 시 1회 호출, 이후 날짜가 바뀐 달에만 재적용
// - annualRate / startDate / originalAmt 는 스케줄에 없으므로 유지
let _loanSyncedMonth = null; // 마지막으로 동기화한 YYYY-MM
function syncLoanFromSchedule() {
  if (!LOAN_SCHEDULE || LOAN_SCHEDULE.length === 0) return;
  const todayStr = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (_loanSyncedMonth === todayStr) return; // 이번 달 이미 동기화됨

  // 현재 월 행 (없으면 가장 최근 과거 행)
  let curRow = LOAN_SCHEDULE.find(r => r.date === todayStr);
  if (!curRow) curRow = [...LOAN_SCHEDULE].reverse().find(r => r.date <= todayStr);
  if (!curRow) return; // 스케줄이 모두 미래면 스킵

  const totalMonths     = LOAN_SCHEDULE.length;
  const remainingMonths = LOAN_SCHEDULE.filter(r => r.date >= todayStr).length;
  const totalInterestPaid = LOAN_SCHEDULE
    .filter(r => r.date <= todayStr)
    .reduce((s, r) => s + (r.interest || 0), 0);

  LOAN.balance             = curRow.balance;
  LOAN.monthlyInterestPaid = curRow.interest;
  LOAN.totalMonths         = totalMonths;
  LOAN.remainingMonths     = remainingMonths;
  LOAN.totalInterestPaid   = totalInterestPaid;
  _loanSyncedMonth = todayStr;
  lsSave(LOAN_KEY, LOAN);
  saveSettings();
}

function refreshAll() {
  recomputeRows();
  renderSummary();
  try { buildTabBar(); } catch(e) {}
  renderDonut();
  renderView();
}

// 기준일 지정 → 해당 날짜 종가로 즉시 업데이트
// ── 진행현황 라벨 상태 헬퍼
let EDITABLE_PRICES = [];  // 현재가 편집기에서 관리, localStorage 복원

// EDITABLE_PRICES 단일 조회 헬퍼 (name 기준) — 전체에서 공통 사용
function getEP(name) {
  return EDITABLE_PRICES.find(i => i.name === name) || null;
}
function getEPByCode(code) {
  if (!code) return null;
  const c = String(code).trim();
  return EDITABLE_PRICES.find(i => i.code && i.code.trim() === c) || null;
}

// 종목코드가 있는 EDITABLE_PRICES 항목만 반환
function getEPWithCode() {
  return EDITABLE_PRICES.filter(i => i.code);
}
function getEPType(ep, fallback) {
  return (ep && (ep.assetType || ep.type)) || fallback || '주식';
}
function epPush(name, code, assetType) {
  EDITABLE_PRICES.push({ name, code: code||'', sector: '기타', assetType: assetType||'주식' });
}

// EDITABLE_PRICES에서 섹터 조회 (기초정보 관리가 최우선 기준)
function getSector(name) {
  const ep = getEP(name);
  if (ep && ep.sector && ep.sector !== 'mixed') return ep.sector;
  return '기타';
}

// EDITABLE_PRICES에서 종목코드 조회
function getCode(name) {
  const ep = getEP(name);
  if (ep && ep.code) return ep.code;
  return STOCK_CODE[name] || '';
}
// EDITABLE_PRICES를 localStorage에서 복원 (신규 추가 종목 포함)
// SECTOR_COLORS localStorage 복원 (저장값으로 완전 교체 — 삭제 섹터 부활 방지)
(function() {
  const saved = lsGet(SECTOR_COLORS_KEY, null);
  if (saved) {
    // 하드코딩 기본값 전부 제거 후 저장값으로 대체
    Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
    // ★ var() 문자열이 저장된 레거시 데이터 자동 정리 (donut 색상 깨짐 방지)
    Object.entries(saved).forEach(([k, v]) => {
      SECTOR_COLORS[k] = (typeof v === 'string' && v.startsWith('var('))
        ? resolveColor(v)   // var(--xxx) → 실제 hex로 변환하여 저장
        : (v || 'var(--muted)'); // 빈값 방어
    });
  }
})();

(function syncEditables() {
  try {
    // ══ 초기화 순서: ① 기초정보 로드 → ② 거래이력 반영 → ③ rawHoldings 재생성 ══

    // ① localStorage에서 EDITABLE_PRICES 복원 (기초정보 관리탭 저장값 최우선)
    const savedE = lsGet(EDITABLES_KEY, null);
    if (savedE && Array.isArray(savedE) && savedE.length > 0) {
      EDITABLE_PRICES.length = 0;
      savedE.forEach(e => EDITABLE_PRICES.push(e));
    }

    // ② 기초정보의 코드를 STOCK_CODE에 반영 (기초정보 → STOCK_CODE 단방향)
    EDITABLE_PRICES.forEach(ep => {
      if (ep.code && ep.name) STOCK_CODE[ep.name] = ep.code;
    });

    // ③ EDITABLE_PRICES 로드 완료 후 거래이력으로 rawHoldings 재생성
    //    이 시점에서 syncHoldingsFromTrades가 기초정보를 참조할 수 있음
    if (rawTrades.length > 0) {
      syncHoldingsFromTrades();
    }

    // ④ 거래이력에 있는데 EDITABLE_PRICES에 없는 종목 자동 등록
    // ※ 기초정보에 이미 있으면 절대 덮어쓰지 않음 — 기초정보 우선순위 보장
    rawTrades.filter(t => t.name).forEach(t => {
      if (!getEP(t.name)) {
        const code = t.code || STOCK_CODE[t.name] || '';
        epPush(t.name, code, t.assetType);
        if (code) STOCK_CODE[t.name] = code;
      }
    });

    // ⑤ rawHoldings에도 없는 종목 추가 (펀드/TDF 포함)
    rawHoldings.forEach(h => {
      if (!h.name) return;
      const code = h.fund ? '' : (STOCK_CODE[h.name] || '');
      if (!getEP(h.name)) {
        epPush(h.name, code, h.type);
      }
    });

  } catch(e) { console.warn('syncEditables 실패:', e); }
})();
// ★ 초기화는 모든 JS 로드 후 views_misc.js 맨 끝에서 실행

// ★ GSheet 연동 초기화는 views_misc.js 맨 끝 initApp()에서 실행

// rawTrades 없고 rawHoldings 있으면 마이그레이션 팝업
checkAndShowMigration();
