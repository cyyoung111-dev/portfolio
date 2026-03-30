
// 배당 탭 — 배당 주기 버튼 선택
// nameKey = name.replace(/\s/g,'_') 형태, hidden input id와 일치
// DATA
// 계좌 색상 팔레트 (신규 계좌 추가 시 순환 사용)
const ACCT_PALETTE = [
  'var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)',
  'var(--pink)','var(--cyan)','var(--gold2)','#84cc16','var(--purple-lt)',
  '#f97316','#06b6d4','#8b5cf6','#ec4899','#14b8a6',
  '#a3e635','#fb923c','#38bdf8','#c084fc','#f43f5e'
];

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

function normName(n){ return n || ''; }
let SECTOR_COLORS = {}; // 섹터 색상: 기초정보 관리탭에서 직접 입력

let fundDirect = {}; // localStorage 또는 GSheet 복원으로 채워짐

const prices = {};  // 구글시트 자동 조회로 채워짐

const STOCK_CODE = {};  // 거래 이력 입력 시 자동 누적, localStorage 복원
let rawHoldings = [];  // localStorage 또는 rawTrades에서 자동 복원
//  거래 이력 (rawTrades)
//  {id, acct, type, name, code, qty, buyDate, buyPrice, sellDate, sellPrice, memo}
let rawTrades = [];

// ★ DIVDATA 선언 — loadHoldings()보다 반드시 먼저 위치해야 함
// { [종목명]: { freq, months, perShare, currency } }
let DIVDATA = {};

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

  // ★ normName 정규화: 구버전 종목명 → 현재 종목명으로 자동 변환
  // 예) 'TIME Korea플러스배당액티브' → 'TIMEFOLIO Korea플러스배당액티브'
  rawTrades.forEach(t => {
    if (!t.name) return;
    const normalized = normName(t.name);
    if (normalized !== t.name) {
      t.name = normalized;
      changed = true;
    }
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

  // ── Step 4: fund 항목을 fundDirect에 초기 등록 (미등록 시 computeRows에서 null 처리됨)
  if (typeof fundDirect !== 'undefined') {
    newH.filter(h => h.fund && h.name).forEach(h => {
      if (!fundDirect[h.name]) {
        fundDirect[h.name] = { eval: h.cost, cost: h.cost, type: h.type || 'TDF' };
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
const PRICE_BACKUP_KEY  = 'pf_price_backup';   // GAS 실패 시 백업
const DIV_HIDE_ZERO_KEY = 'pf_div_hide_zero';  // 배당 수량0 숨김 상태

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
    // ★ LOAN / REAL_ESTATE도 localStorage에 저장 (부동산탭 데이터 유지)
    if (typeof LOAN !== 'undefined') lsSave(LOAN_KEY, LOAN);
    if (typeof REAL_ESTATE !== 'undefined') lsSave(REALESTATE_KEY, REAL_ESTATE);
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
    // 구글시트 즉시 동기화 (저장과 동시에 GAS 반영)
    // ★ saveSettings는 여기서 호출하지 않음 — loadSettings 도중 빈 DIVDATA를 덮어쓰는 문제 방지
    if (typeof syncCodesToGsheet    === 'function') syncCodesToGsheet();
    if (typeof syncHoldingsToGsheet === 'function') syncHoldingsToGsheet();
    if (typeof syncTradesToGsheet   === 'function') syncTradesToGsheet();
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
      // ★ fundDirect.eval이 취득가와 같으면(초기값) savedPrices 이름키 우선 사용
      const evalPrice = (savedPrices[h.name] > 0 && savedPrices[h.name] !== fd.cost)
        ? savedPrices[h.name]
        : (fd.eval > 0 ? fd.eval : fd.cost);
      const evalAmt = evalPrice;
      return {...h, qty:1, cost:fd.cost, evalAmt, costAmt:fd.cost, pnl:evalAmt-fd.cost, price:evalPrice, pct:fd.cost>0?(evalAmt-fd.cost)/fd.cost*100:0, sector:getSector(h.name), code:''};
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
  // 데이터 변경 시 뷰 캐시 전체 무효화
  if (typeof invalidateViewCache === 'function') invalidateViewCache();
  renderSummary();
  try { buildTabBar(); } catch(e) {}
  renderDonut();
  renderView();
}

// 기준일 지정 → 해당 날짜 종가로 즉시 업데이트
// ── 진행현황 라벨 상태 헬퍼
let EDITABLE_PRICES = [];  // 현재가 편집기에서 관리, localStorage 복원

function normalizeStockCode(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  s = s
    .replace(/^KRX:/, '')
    .replace(/^KOSDAQ:/, '')
    .replace(/^NASDAQ:/, '')
    .replace(/^NYSE:/, '')
    .replace(/^AMEX:/, '')
    .replace(/^A(?=\d{6}$)/, ''); // A000001 → 000001 (한국 거래소 prefix 제거)

  // ★ 순수 숫자만 있는 경우 6자리로 패딩 (005930, 000001 등)
  if (/^\d{1,6}$/.test(s)) return s.padStart(6, '0');

  // ★ 영문+숫자 혼합 코드 허용 (F00001, 0046Y0, EDGF35 등)
  //   특수문자만 제거하고 대문자+숫자+.-는 그대로 유지
  return s.replace(/[^A-Z0-9.-]/g, '');
}

// EDITABLE_PRICES 단일 조회 헬퍼 (name 기준) — 전체에서 공통 사용
function getEP(name) {
  return EDITABLE_PRICES.find(i => i.name === name) || null;
}
function getEPByCode(code) {
  if (!code) return null;
  const c = normalizeStockCode(code);
  return EDITABLE_PRICES.find(i => i.code && normalizeStockCode(i.code) === c) || null;
}

// 종목코드가 있는 EDITABLE_PRICES 항목만 반환
function getEPWithCode() {
  return EDITABLE_PRICES
    .filter(i => i.code)
    .map(i => ({ ...i, code: normalizeStockCode(i.code) }))
    .filter(i => i.code);
}
function getEPType(ep, fallback) {
  return (ep && (ep.assetType || ep.type)) || fallback || '주식';
}
function epPush(name, code, assetType) {
  EDITABLE_PRICES.push({ name, code: normalizeStockCode(code), sector: '기타', assetType: assetType||'주식' });
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
  if (ep && ep.code) return normalizeStockCode(ep.code);
  return normalizeStockCode(STOCK_CODE[name] || '');
}

// ★ 특정 날짜 기준 보유수량 계산 (배당 계산용)
// dateStr: 'YYYY-MM-DD' 형식, 해당 날짜 이하의 거래만 반영
// 미래 날짜 → 현재 수량(rawHoldings) 사용
function getQtyAtDate(name, dateStr) {
  const todayStr = (()=>{
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
  })();
  // 미래 날짜면 현재 보유수량 사용
  if (dateStr > todayStr) {
    return rawHoldings.filter(h => h.name === name && !h.fund)
      .reduce((s, h) => s + (h.qty || 0), 0);
  }
  // 과거/오늘: rawTrades에서 해당 날짜 이하 buy/sell 합산
  let qty = 0;
  rawTrades
    .filter(t => t.name === name && t.date && t.date <= dateStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(t => {
      if (t.tradeType === 'buy')  qty += (t.qty || 0);
      if (t.tradeType === 'sell') qty -= (t.qty || 0);
    });
  return Math.max(0, qty);
}

// ★ 해당 연도의 월별 배당 기준일 계산 (월 말일)
function getDivRefDate(year, month) {
  // month: 1~12
  const lastDay = new Date(year, month, 0).getDate(); // 해당 월 말일
  return year + '-' + String(month).padStart(2,'0') + '-' + String(lastDay).padStart(2,'0');
}

// ★ DIVDATA 키 결정: 코드 있으면 코드, 없으면 name (펀드·TDF)
function getDivKey(name) {
  const code = getCode(name);
  return code || name;
}

// ★ DIVDATA name 기반 → code 기반 마이그레이션
function migrateDivDataToCode() {
  const toAdd = {};
  const toDelete = [];
  Object.keys(DIVDATA).forEach(key => {
    // 이미 코드 형식이면 스킵 (6자리 숫자 또는 영문+숫자)
    const isCodeKey = /^[0-9]{6}$/.test(key) || /^[A-Z0-9]{2,10}$/.test(key);
    if (isCodeKey) return;
    // name 기반 키 → code로 변환
    const code = getCode(key);
    if (code && code !== key) {
      toAdd[code] = DIVDATA[key];
      toDelete.push(key);
    }
  });
  toDelete.forEach(k => delete DIVDATA[k]);
  Object.assign(DIVDATA, toAdd);
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
      // ★ normName 적용: 구버전 종목명 자동 변환 후 중복 제거
      const seenNames = new Set();
      const seenCodes = new Set();
      savedE.forEach(e => {
        const normalizedName = normName(e?.name || '');
        if (!normalizedName) return;
        // 같은 이름 중복 제거 (normName 변환으로 동일해진 항목)
        if (seenNames.has(normalizedName)) return;
        seenNames.add(normalizedName);
        const normalizedCode = normalizeStockCode(e?.code);
        // 같은 코드 중복 제거 (코드 있는 항목만)
        if (normalizedCode && seenCodes.has(normalizedCode)) return;
        if (normalizedCode) seenCodes.add(normalizedCode);
        const next = {
          ...e,
          name: normalizedName,
          code: normalizedCode,
          sector: e?.sector || '기타',
          assetType: e?.assetType || e?.type || '주식',
        };
        EDITABLE_PRICES.push(next);
      });
    }

    // ② 기초정보의 코드를 STOCK_CODE에 반영 (기초정보 → STOCK_CODE 단방향)
    EDITABLE_PRICES.forEach(ep => {
      if (ep.code && ep.name) STOCK_CODE[ep.name] = normalizeStockCode(ep.code);
    });

    // ③ EDITABLE_PRICES 로드 완료 후 거래이력으로 rawHoldings 재생성
    //    이 시점에서 syncHoldingsFromTrades가 기초정보를 참조할 수 있음
    if (rawTrades.length > 0) {
      syncHoldingsFromTrades();
    }

    // ★ DIVDATA 마이그레이션: name 기반 → code 기반
    migrateDivDataToCode();

    // ④ 거래이력에 있는데 EDITABLE_PRICES에 없는 종목 자동 등록
    // ※ 기초정보에 이미 있으면 절대 덮어쓰지 않음 — 기초정보 우선순위 보장
    // ★ rawTrades normName 정규화 (TIME Korea → TIMEFOLIO 등 구버전명 변환)
    rawTrades.forEach(t => {
      if (!t.name) return;
      const nn = normName(t.name);
      if (nn !== t.name) {
        // DIVDATA 키도 함께 변환
        if (DIVDATA[t.name] !== undefined && DIVDATA[nn] === undefined) {
          DIVDATA[nn] = DIVDATA[t.name]; delete DIVDATA[t.name];
        }
        t.name = nn;
      }
      // ★ 거래이력 코드를 기초정보 코드로 교정
      // 기초정보에 이 종목이 있으면 거래이력 코드를 기초정보 코드로 맞춤
      const epForTrade = getEP(t.name);
      if (epForTrade && epForTrade.code && t.code !== epForTrade.code) {
        t.code = epForTrade.code;
      }
    });
    rawTrades.filter(t => t.name).forEach(t => {
      // ★ 기초정보에 이미 같은 이름 OR 같은 코드가 있으면 추가하지 않음
      const epExist = getEP(t.name);
      if (epExist) return; // 이름 일치 → 스킵
      const tCode = normalizeStockCode(t.code || STOCK_CODE[t.name] || '');
      if (tCode && EDITABLE_PRICES.some(ep => ep.code && normalizeStockCode(ep.code) === tCode)) return; // 코드 일치 → 스킵
      epPush(t.name, tCode, t.assetType);
      if (tCode) STOCK_CODE[t.name] = tCode;
    });

    // ⑤ rawHoldings에도 없는 종목 추가 (펀드/TDF 포함)
    rawHoldings.forEach(h => {
      if (!h.name) return;
      // ★ 기초정보에 이름 일치 항목이 있으면 스킵
      if (getEP(h.name)) return;
      const code = h.fund ? '' : (STOCK_CODE[h.name] || '');
      const nCode = normalizeStockCode(code);
      // ★ 코드 일치 항목이 있어도 스킵 (다른 이름으로 등록된 경우)
      if (nCode && EDITABLE_PRICES.some(ep => ep.code && normalizeStockCode(ep.code) === nCode)) return;
      epPush(h.name, code, h.type);
    });

  } catch(e) { console.warn('syncEditables 실패:', e); }
})();
// ★ 초기화는 모든 JS 로드 후 views_misc.js 맨 끝에서 실행

// ★ GSheet 연동 초기화는 views_misc.js 맨 끝 initApp()에서 실행

// checkAndShowMigration()은 views_misc.js의 initApp()에서 호출됨
