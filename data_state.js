// 배당 탭 — 배당 주기 버튼 선택
// nameKey = name.replace(/\s/g,'_') 형태, hidden input id와 일치
// DATA shared state

// 계좌 색상 팔레트 (신규 계좌 추가 시 순환 사용)
const ACCT_PALETTE = [
  'var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)',
  'var(--pink)','var(--cyan)','var(--gold2)','#84cc16','var(--purple-lt)',
  '#f97316','#06b6d4','#8b5cf6','#ec4899','#14b8a6',
  '#a3e635','#fb923c','#38bdf8','#c084fc','#f43f5e'
];

let ACCT_COLORS = {};  // localStorage 복원 (KEY 선언 후 아래에서 복원)
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

function normName(n){ return n || ''; }

function saveAcctColors() {
  // ACCT_COLORS: var() 문자열 → hex 변환 후 저장 (Canvas fillStyle 깨짐 방지)
  Object.keys(ACCT_COLORS).forEach(k => {
    if (typeof ACCT_COLORS[k] === 'string' && ACCT_COLORS[k].startsWith('var(')) {
      ACCT_COLORS[k] = resolveColor(ACCT_COLORS[k]);
    }
  });
  lsSave(ACCT_COLORS_KEY, ACCT_COLORS);
}

function getAcctNames() {
  // rawTrades + rawHoldings + ACCT_COLORS 등록 계좌 모두 포함
  const fromTrades = rawTrades.map(t => t.acct).filter(Boolean);
  const fromHoldings = rawHoldings.map(h => h.acct).filter(Boolean);
  const fromColors = Object.keys(ACCT_COLORS);
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
    if (!ACCT_ORDER.includes(acct)) {
      ACCT_ORDER.push(acct);
      saveAcctOrder();
    }
  }
  return ACCT_COLORS[acct];
}
