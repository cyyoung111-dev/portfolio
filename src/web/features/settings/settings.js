// ═══════════════════════════════════════════════════════════════=
//  settings.js — 설정 통합 번들 (integration step 4)
// ═══════════════════════════════════════════════════════════════=

// ════════════════════════════════════════════════════════════════
//  settings_constants.js — 설정 상수/공유 상태
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
// URL이 A→B→A로 돌아와도 중간 전환을 구분하기 위한 세대 번호입니다.
let GSHEET_CONNECTION_GENERATION = 0;
let _gsPortfolioRestoreRequired = false;

function getGsheetConnectionGeneration() {
  return GSHEET_CONNECTION_GENERATION;
}

function isGsheetConnectionCurrent(target, generation) {
  return String(GSHEET_API_URL || '').trim() === String(target || '').trim()
    && GSHEET_CONNECTION_GENERATION === generation;
}

// debounce 타이머
let _saveSettingsTimer = null;
let _dividendSaveQueue = Promise.resolve();
let _saveRealEstateQueue = Promise.resolve();
let _saveSettingsQueue = Promise.resolve();
let _saveRealEstateTimer = null;
let _saveSettingsWaiters = [];
let _saveRealEstateWaiters = [];
let _saveSettingsPendingKey = '';
let _saveRealEstatePendingKey = '';

const TAB_SYNC_STATUS_KEY = 'tab_sync_status';
let TAB_SYNC_STATUS = lsGet(TAB_SYNC_STATUS_KEY, {});
const TAB_SYNC_BUSY = {};

let _gsBootRestored = false;
let _gsBootPromise = null;
let _gsSettingsLoadEpoch = 0;

function isGsheetPortfolioWriteReady(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation) ? options.generation : null;
  if (!targetUrl) return false;
  if (generation !== null && !isGsheetConnectionCurrent(targetUrl, generation)) return false;
  if (options?.allowDuringRestore === true) return true;
  const currentTarget = String(GSHEET_API_URL || '').trim();
  // 연결된 GSheet의 초기/전환 복원이 끝나기 전에는 현재 메모리의 출처를 증명할 수 없습니다.
  // 새 브라우저의 빈 상태나 이전 연결의 상태를 원격에 덮어쓰지 않습니다.
  if (targetUrl === currentTarget && (!_gsBootRestored || _gsPortfolioRestoreRequired)) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════
//  settings_persistence.js — 설정 저장/복원
// ════════════════════════════════════════════════════════════════

// ★ 버그수정: loadSettings에서 EDITABLE_PRICES 코드 복원 시 사용
// normalizeStockCode(data.js)의 settings.js 내 별칭
// 이 함수가 없으면 loadSettings에서 ReferenceError → 코드가 undefined로 저장됨
function _normalizeCodeForSync(raw) {
  return (typeof normalizeStockCode === 'function')
    ? normalizeStockCode(raw)
    : String(raw || '').trim().toUpperCase().replace(/^A(?=\d{6}$)/, '');
}

function _isGasVersionAtLeast(current, minimum) {
  const left = String(current || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const right = String(minimum || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const a = left[i] || 0;
    const b = right[i] || 0;
    if (a !== b) return a > b;
  }
  return true;
}

function saveDividendSettings(_immediate, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const expectedGeneration = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return Promise.resolve(false);
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation: expectedGeneration,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return Promise.resolve(false);
  // 호출 시점의 데이터·연결을 함께 캡처하고 저장을 직렬화합니다. 큐 대기 중 A→B로
  // 연결이 바뀌어도 A payload를 B에 전송하지 않습니다.
  const payload = JSON.stringify(DIVDATA);
  const run = async () => {
    try {
      if (!isGsheetConnectionCurrent(targetUrl, expectedGeneration)) return false;
      const data = await requestGsheetFormJson(
        'saveDividendSettings',
        { data: payload },
        { timeoutMs: 15000, retry: 1, targetUrl }
      );
      if (!data) throw new Error('네트워크 오류');
      if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
      return true;
    } catch(e) {
      // 별도 배당 저장 미지원 Apps Script면 기존 saveSettings(DIVDATA 포함)로 백업됨
      logWarn('settings', 'saveDividendSettings 실패:', e);
      return false;
    }
  };
  _dividendSaveQueue = _dividendSaveQueue.then(run, run);
  return _dividendSaveQueue;
}

function saveRealEstateSettings(immediate, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const expectedGeneration = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return Promise.resolve(false);
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation: expectedGeneration,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return Promise.resolve(false);
  const pendingKey = targetUrl + '|' + expectedGeneration;
  const payload = JSON.stringify({
    LOAN,
    REAL_ESTATE,
    LOAN_SCHEDULE,
    RE_VALUE_HIST,
  });
  if (_saveRealEstateTimer) {
    clearTimeout(_saveRealEstateTimer);
    if (_saveRealEstatePendingKey && _saveRealEstatePendingKey !== pendingKey) {
      const staleWaiters = _saveRealEstateWaiters;
      _saveRealEstateWaiters = [];
      staleWaiters.forEach(done => done(false));
    }
  }
  _saveRealEstatePendingKey = pendingKey;
  const delay = immediate ? 0 : 2500;
  return new Promise(resolve => {
    _saveRealEstateWaiters.push(resolve);
    _saveRealEstateTimer = setTimeout(async () => {
      const waiters = _saveRealEstateWaiters;
      _saveRealEstateWaiters = [];
      _saveRealEstateTimer = null;
      _saveRealEstatePendingKey = '';
      const run = async () => {
        try {
          if (!isGsheetConnectionCurrent(targetUrl, expectedGeneration)) return false;
          const data = await requestGsheetFormJson(
            'saveRealEstateSettings',
            { data: payload },
            { timeoutMs: 15000, retry: 1, targetUrl }
          );
          if (!data) throw new Error('네트워크 오류');
          if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
          return true;
        } catch(e) {
          logWarn('settings', 'saveRealEstateSettings 실패:', e);
          return false;
        }
      };
      _saveRealEstateQueue = _saveRealEstateQueue.then(run, run);
      const ok = await _saveRealEstateQueue;
      waiters.forEach(done => done(ok));
    }, delay);
  });
}

async function loadRealEstateSettings(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return false;
  if (_gsPortfolioRestoreRequired && options?.allowDuringRestore !== true) return false;
  try {
    const data = await requestGsheetActionJson(
      'getRealEstateSettings',
      {},
      { timeoutMs: 10000, retry: 1, targetUrl }
    );
    if (!isGsheetConnectionCurrent(targetUrl, generation)) return false;
    if (!data || data.status !== 'ok' || !data.settings || typeof data.settings !== 'object') return false;
    const s = data.settings;
    // fundDirect 키가 존재하면 빈 객체도 포함해 Settings를 완전한 authoritative 상태로 봅니다.
    // holdings fallback은 키 자체가 없는 레거시 응답에서만 허용합니다.
    const hasAuthoritativeFundDirect = Object.prototype.hasOwnProperty.call(s, 'fundDirect');
    window.GAS_API_KEY_STATUS = (s.apiKeyStatus && typeof s.apiKeyStatus === 'object') ? s.apiKeyStatus : {};
    // ★ [개선] GAS 버전 저장 — bootstrapGsheetSettings에서 불일치 감지에 사용
    if (data.gasVersion) window._lastGasVersion = String(data.gasVersion);
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
    // GAS에서 상환스케줄을 모두 복원한 뒤 현재월 잔액을 다시 계산합니다.
    // bootstrap 초기에 로컬 스케줄로 계산했던 값이 원격 LOAN에 덮이는 것을 방지합니다.
    const loanChanged = typeof syncLoanFromSchedule === 'function' && syncLoanFromSchedule();
    if (loanChanged) {
      if (!isGsheetConnectionCurrent(targetUrl, generation)) return false;
      await persistRealEstateSettings(true, { targetUrl, generation, allowDuringRestore: true });
      if (!isGsheetConnectionCurrent(targetUrl, generation)) return false;
    }
    return true;
  } catch(e) {
    return false;
  }
}

async function loadDividendSettings(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return false;
  if (_gsPortfolioRestoreRequired && options?.allowDuringRestore !== true) return false;
  try {
    const data = await requestGsheetActionJson(
      'getDividendSettings',
      {},
      { timeoutMs: 10000, retry: 1, targetUrl }
    );
    if (!isGsheetConnectionCurrent(targetUrl, generation)) return false;
    if (!data || data.status !== 'ok' || !data.divData || typeof data.divData !== 'object') return false;
    _applyDivData(data.divData);
    return true;
  } catch(e) {
    return false;
  }
}

function saveSettings(immediate, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const expectedGeneration = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return Promise.resolve(false);
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation: expectedGeneration,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return Promise.resolve(false);
  const pendingKey = targetUrl + '|' + expectedGeneration;
  const settings = {
    ACCT_COLORS,
    ACCT_ORDER,
    SECTOR_COLORS,
    fundDirect,
    EDITABLE_PRICES,
    ACCT_TAX_TYPES,
    ACCOUNTS_MASTER,
    SAVED_PRICES: savedPrices,
    SAVED_PRICE_DATES: savedPriceDates,
    APP_THEME: (typeof lsGet === 'function') ? lsGet('app_theme', 'ocean') : 'ocean',
    APP_THEME_MODE: (typeof lsGet === 'function') ? lsGet('app_theme_mode', 'dark') : 'dark',
    APP_FONT: (typeof lsGet === 'function') ? lsGet('app_font', 'pretendard') : 'pretendard',
    DIVDATA,
    LOAN,
    REAL_ESTATE,
    LOAN_SCHEDULE,
    RE_VALUE_HIST,
  };
  const payload = JSON.stringify(settings);
  if (_saveSettingsTimer) {
    clearTimeout(_saveSettingsTimer);
    if (_saveSettingsPendingKey && _saveSettingsPendingKey !== pendingKey) {
      const staleWaiters = _saveSettingsWaiters;
      _saveSettingsWaiters = [];
      staleWaiters.forEach(done => done(false));
    }
  }
  _saveSettingsPendingKey = pendingKey;
  const delay = immediate ? 0 : 4000;
  return new Promise(resolve => {
    _saveSettingsWaiters.push(resolve);
    _saveSettingsTimer = setTimeout(async () => {
      const waiters = _saveSettingsWaiters;
      _saveSettingsWaiters = [];
      _saveSettingsTimer = null;
      _saveSettingsPendingKey = '';
      const run = async () => {
        try {
          if (!isGsheetConnectionCurrent(targetUrl, expectedGeneration)) return false;
          const data = await requestGsheetFormJson(
            'saveSettings',
            { data: payload },
            { timeoutMs: 15000, retry: 1, targetUrl }
          );
          if (!data) throw new Error('네트워크 오류');
          if (data.status !== 'ok') throw new Error(data.message || '응답 오류');
          return true;
        } catch(e) {
          console.warn('saveSettings 실패:', e);
          return false;
        }
      };
      _saveSettingsQueue = _saveSettingsQueue.then(run, run);
      const ok = await _saveSettingsQueue;
      waiters.forEach(done => done(ok));
    }, delay);
  });
}

async function persistDividendSettings(immediate, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation)
    ? options.generation
    : getGsheetConnectionGeneration();
  if (!targetUrl) return false;
  const pinnedOptions = { targetUrl, generation };
  const ok = await saveDividendSettings(immediate, pinnedOptions);
  if (ok) return true;
  // 최신 GAS에서 전용 저장이 실패했는데 일반 설정 저장으로 우회하면
  // 기존 DIVDATA를 보존하는 서버 병합 정책 때문에 성공처럼 보일 수 있습니다.
  if (_isGasVersionAtLeast(window._lastGasVersion, '9.34')) return false;
  return saveSettings(true, pinnedOptions);
}

async function persistRealEstateSettings(immediate, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  if (!targetUrl) return false;
  const ok = await saveRealEstateSettings(immediate, options);
  if (ok) return true;
  if (_isGasVersionAtLeast(window._lastGasVersion, '9.34')) return false;
  return saveSettings(true, options);
}

// ════════════════════════════════════════════════════════════════
//  settings.js — 설정 통합 로드/부트스트랩
//  의존: settings_constants.js, settings_net.js, settings_persistence.js
// ════════════════════════════════════════════════════════════════

async function loadSettings(onProgress, options) {
  const prog = onProgress || function(){};
  if (!GSHEET_API_URL) return false;
  const explicitAuthoritativePull = options?.forcePortfolioRestore === true;
  if (explicitAuthoritativePull) {
    // 명시적 pull이 끝날 때까지 다른 저장 경로가 현재 메모리를 원격에 쓰지 못하게 합니다.
    _gsPortfolioRestoreRequired = true;
    _gsBootRestored = false;
  }
  const loadEpoch = ++_gsSettingsLoadEpoch;
  const loadTarget = String(GSHEET_API_URL || '').trim();
  const loadGeneration = getGsheetConnectionGeneration();
  const isLoadConnectionCurrent = () => isGsheetConnectionCurrent(loadTarget, loadGeneration)
    && loadEpoch === _gsSettingsLoadEpoch;
  const connectionForcePortfolioRestore = _gsPortfolioRestoreRequired === true;
  const forcePortfolioRestore = connectionForcePortfolioRestore
    || explicitAuthoritativePull;
  // 마지막 거래 삭제가 원격에 완전히 반영되기 전 새로고침된 경우,
  // 원격의 과거 거래를 다시 복원하기 전에 영속 pending 삭제를 먼저 재시도합니다.
  const pendingEmptySyncAtLoad = typeof _getPendingExplicitEmptyTradeSync === 'function'
    ? _getPendingExplicitEmptyTradeSync()
    : null;
  const blockRemotePortfolioRestore = !!pendingEmptySyncAtLoad;
  try {
    prog('설정 데이터 로드 중...');
    // 설정·거래·보유·종목코드를 단일 GAS 실행에서 받아 웹앱 왕복 지연을 줄입니다.
    // 구버전 GAS는 getBootstrap을 모르므로 기존 getSettings 요청으로 자동 대체합니다.
    let data = await requestGsheetActionJson('getBootstrap', {}, { timeoutMs: 15000, retry: 1, targetUrl: loadTarget });
    if (!isLoadConnectionCurrent()) return false;
    const isBootstrap = !!(data && data.status === 'ok' && data.settings && Array.isArray(data.codes));
    if (!isBootstrap) {
      data = await requestGsheetActionJson('getSettings', {}, { timeoutMs: 10000, retry: 1, targetUrl: loadTarget });
      if (!isLoadConnectionCurrent()) return false;
    }
    if (!data || data.status !== 'ok' || !data.settings) return false;
    const s = data.settings;
    // 설정·배당·부동산 처리와 동시에 거래/보유 시트를 미리 읽습니다.
    // 기존에는 모든 설정 복원이 끝난 뒤 순차 요청해 주식 데이터 표시가 불필요하게 늦었습니다.
    const shouldRestorePortfolio = rawTrades.length === 0 || forcePortfolioRestore;
    const bootstrapPortfolioStatus = isBootstrap && data.portfolioReadStatus && typeof data.portfolioReadStatus === 'object'
      ? data.portfolioReadStatus
      : null;
    // 구버전 GAS는 하위 읽기 성공 여부가 없으므로 일반 초기복원은 기존 동작을 유지하되,
    // 연결 변경 강제복원에서는 "빈 배열"을 성공으로 추정하지 않습니다.
    const bootstrapTradesOk = bootstrapPortfolioStatus
      ? bootstrapPortfolioStatus.tradesOk === true
      : !forcePortfolioRestore;
    const bootstrapHoldingsOk = bootstrapPortfolioStatus
      ? bootstrapPortfolioStatus.holdingsOk === true
      : !forcePortfolioRestore;
    const portfolioRestorePromise = blockRemotePortfolioRestore
      ? null
      : shouldRestorePortfolio && isBootstrap
      ? Promise.resolve([
          { status: bootstrapTradesOk ? 'ok' : 'error', trades: Array.isArray(data.trades) ? data.trades : [] },
          { status: bootstrapHoldingsOk ? 'ok' : 'error', holdings: Array.isArray(data.holdings) ? data.holdings : [] },
        ])
      : shouldRestorePortfolio
      ? Promise.all([
          requestGsheetActionJson('getTrades', {}, { timeoutMs: 15000, retry: 1, targetUrl: loadTarget }).catch(() => null),
          requestGsheetActionJson('getHoldings', {}, { timeoutMs: 15000, retry: 1, targetUrl: loadTarget }).catch(() => null),
        ])
      : null;

    // pending 빈 원장을 적용하기 전에는 레거시 직접펀드(TDF/펀드, 코드 없음)를 보존할
    // holdings 원천을 반드시 확보합니다. 이 읽기가 실패한 상태에서 []를 쓰면 비거래 직접펀드까지 삭제될 수 있습니다.
    const pendingHoldingsPromise = !pendingEmptySyncAtLoad || hasAuthoritativeFundDirect
      ? null
      : isBootstrap
      ? Promise.resolve(
          bootstrapHoldingsOk && Array.isArray(data.holdings)
            ? { status: 'ok', holdings: data.holdings }
            : { status: 'error', holdings: [] }
        )
      : requestGsheetActionJson(
          'getHoldings',
          {},
          { timeoutMs: 15000, retry: 1, targetUrl: loadTarget }
        ).catch(() => null);

    // 연결 변경 강제 복원은 설정 전역상태를 건드리기 전에 거래/보유 원격 읽기가 둘 다
    // 성공했는지 먼저 확인합니다. 실패한 B의 설정 일부와 A의 포트폴리오가 섞이지 않게 합니다.
    let forcedPortfolioRestoreData = null;
    if (forcePortfolioRestore && portfolioRestorePromise) {
      forcedPortfolioRestoreData = await portfolioRestorePromise;
      if (!isLoadConnectionCurrent()) return false;
      const preflightTrades = forcedPortfolioRestoreData?.[0];
      const preflightHoldings = forcedPortfolioRestoreData?.[1];
      const preflightTradesOk = !!(preflightTrades && preflightTrades.status === 'ok' && Array.isArray(preflightTrades.trades));
      const preflightHoldingsOk = !!(preflightHoldings && preflightHoldings.status === 'ok' && Array.isArray(preflightHoldings.holdings));
      if (!preflightTradesOk || !preflightHoldingsOk) return false;
    }

    // Theme (기기 간 동일 UI 유지)
    if (s.APP_THEME_MODE && typeof lsSave === 'function') {
      lsSave('app_theme_mode', s.APP_THEME_MODE);
    }
    if (s.APP_THEME && typeof lsSave === 'function') {
      lsSave('app_theme', s.APP_THEME);
    }
    const restoredFont = s.APP_FONT === 'system' ? 'system' : 'pretendard';
    if (typeof lsSave === 'function') lsSave('app_font', restoredFont);
    // 비밀키 원문은 GAS Script Properties에만 두고 브라우저에는 상태만 복원합니다.
    lsRemove('public_data_api_key');
    lsRemove('krx_auth_key');
    if (typeof applyTheme === 'function' && s.APP_THEME) {
      applyTheme(s.APP_THEME, { skipModeSave: true });
    }
    if (typeof applyFont === 'function') {
      applyFont(restoredFont, { skipSave: true });
    }

    // ACCT_COLORS
    if (s.ACCT_COLORS && typeof s.ACCT_COLORS === 'object') {
      Object.keys(ACCT_COLORS).forEach(k => delete ACCT_COLORS[k]);
      Object.entries(s.ACCT_COLORS).forEach(([k,v]) => {
        if (!k || !v) return;
        ACCT_COLORS[k] = (typeof v==='string' && v.startsWith('var('))
          ? resolveColor(v)
          : v;
      });
    }
    // ACCT_ORDER
    if (Array.isArray(s.ACCT_ORDER)) {
      ACCT_ORDER.length = 0;
      s.ACCT_ORDER.forEach(a => ACCT_ORDER.push(a));
    }
    if (Array.isArray(s.ACCOUNTS_MASTER)) {
      ACCOUNTS_MASTER.length = 0;
      s.ACCOUNTS_MASTER.forEach(item => ACCOUNTS_MASTER.push({ ...item }));
      saveAccountsMaster();
    }
    // ★ [계좌별 taxType] 계좌→세금구분 매핑 복원
    if (s.ACCT_TAX_TYPES && typeof s.ACCT_TAX_TYPES === 'object') {
      Object.keys(ACCT_TAX_TYPES).forEach(k => delete ACCT_TAX_TYPES[k]);
      Object.entries(s.ACCT_TAX_TYPES).forEach(([k,v]) => { if (k && v) ACCT_TAX_TYPES[k] = v; });
      if (typeof ensureAccountsMaster === 'function') {
        ensureAccountsMaster();
        Object.entries(ACCT_TAX_TYPES).forEach(([name,label]) => {
          const account = getAccountByName(name);
          if (account) account.taxType = ({ '일반':'GENERAL', ISA:'ISA', '연금':'PENSION_SAVINGS', '연금저축':'PENSION_SAVINGS', IRP:'IRP' })[label] || 'UNCLASSIFIED';
        });
        saveAccountsMaster();
      }
      saveAcctTaxTypes();
    }
    // SECTOR_COLORS
    if (s.SECTOR_COLORS && typeof s.SECTOR_COLORS === 'object') {
      Object.keys(SECTOR_COLORS).forEach(k => delete SECTOR_COLORS[k]);
      Object.entries(s.SECTOR_COLORS).forEach(([k,v]) => {
        SECTOR_COLORS[k] = (typeof v==='string' && v.startsWith('var(')) ? resolveColor(v) : v;
      });
    }
    // fundDirect
    // 연결 변경 강제 복원에서는 키 자체가 없는 신규/레거시 원격도 "직접펀드 없음"으로 취급해
    // 이전 연결의 TDF/직접펀드가 새 연결에 남지 않도록 먼저 비웁니다.
    if (forcePortfolioRestore || hasAuthoritativeFundDirect) {
      Object.keys(fundDirect).forEach(k => delete fundDirect[k]);
      if (s.fundDirect && typeof s.fundDirect === 'object') Object.assign(fundDirect, s.fundDirect);
    }
    // SAVED_PRICES / SAVED_PRICE_DATES (기기 간 현재가 일치)
    if (s.SAVED_PRICES && typeof s.SAVED_PRICES === 'object') {
      Object.keys(savedPrices).forEach(k => delete savedPrices[k]);
      Object.assign(savedPrices, s.SAVED_PRICES);
      if (typeof lsSave === 'function' && typeof PRICES_KEY !== 'undefined') lsSave(PRICES_KEY, savedPrices);
    }
    if (s.SAVED_PRICE_DATES && typeof s.SAVED_PRICE_DATES === 'object') {
      Object.keys(savedPriceDates).forEach(k => delete savedPriceDates[k]);
      Object.assign(savedPriceDates, s.SAVED_PRICE_DATES);
      if (typeof lsSave === 'function' && typeof PRICE_DATES_KEY !== 'undefined') lsSave(PRICE_DATES_KEY, savedPriceDates);
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
          name:      normalizedName,
          code:      normalizedCode,
          sector:    ep?.sector || '기타',
          assetType: ep?.assetType || ep?.type || '주식',
        };
        EDITABLE_PRICES.push(next);
      });
      // STOCK_CODE master 동기화
      EDITABLE_PRICES.forEach(ep => { if (ep.name && ep.code) STOCK_CODE[ep.name] = _normalizeCodeForSync(ep.code); });

    }
    // ★ rawTrades 코드 교정: 일반 복원에서만 기존 로컬 거래를 교정합니다.
    // 연결 변경/명시적 authoritative pull에서는 현재 rawTrades가 이전/오래된 로컬 원장일 수 있으므로
    // 원격 거래를 적용하기 전에 이를 GAS로 재전송하지 않습니다.
    if (!forcePortfolioRestore) {
      let tradeCodeCorrected = false;
      const unmatchedTrades = [];
      rawTrades.forEach(t => {
        if (!t.name) return;
        const tCode = _normalizeCodeForSync(t.code || '');
        // ★ [개선] EDITABLE_PRICES.find() → getEPByCode() / getEP() 교체
        //   Map 인덱스 캐시를 활용해 O(n) 선형 탐색 → O(1) 조회로 성능 개선
        const epByCode = tCode ? getEPByCode(tCode) : null;
        const epByName = getEP(t.name);
        const ep = epByCode || epByName;
        if (!ep) {
          unmatchedTrades.push({
            date: t.date || '',
            name: t.name || '',
            code: tCode || '',
            acct: t.acct || ''
          });
          return;
        }

        // ★ 코드 우선 매칭: 코드가 같으면 기초정보 종목명으로 강제 통일
        if (t.name !== ep.name) {
          t.name = ep.name;
          tradeCodeCorrected = true;
        }
        // ★ 기초정보 코드가 기준
        if (t.code !== (ep.code || '')) {
          t.code = ep.code || '';
          tradeCodeCorrected = true;
        }
      });
      if (tradeCodeCorrected) {
        lsSave(TRADES_KEY, rawTrades); // ★ localStorage 즉시 저장
        syncHoldingsFromTrades();
        // ★ [버그수정] 중복 saveHoldings() 호출 제거
        //   tradeCodeCorrected 분기에서 saveHoldings()를 호출하면
        //   직후 아래 saveHoldings()와 2번 GAS syncTrades가 발생함
        //   → lsSave(TRADES_KEY)로 로컬 저장 완료 + GAS 재저장만 수행
        if (GSHEET_API_URL && typeof syncTradesToGsheet === 'function') {
          syncTradesToGsheet().catch(e => console.warn('거래이력 코드 교정 후 GAS 재저장 실패:', e));
        }
        console.log('[loadSettings] 거래이력 코드 교정 완료 — localStorage+GAS 저장됨');
      }
      if (unmatchedTrades.length > 0) {
        const uniq = Array.from(new Set(unmatchedTrades.map(t => `${t.name}|${t.code}`)));
        console.warn('[loadSettings] 기초정보 미매칭 거래 발견:', unmatchedTrades);
        if (typeof showToast === 'function') {
          showToast(`⚠️ 기초정보 미매칭 거래 ${uniq.length}건 발견 (설정 > 기초정보 확인 필요)`, 'warn');
        }
        if (GSHEET_API_URL && typeof syncIssuesToGsheet === 'function') {
          syncIssuesToGsheet('loadSettings', unmatchedTrades).catch(()=>{});
        }
      }
    }
    // 마지막 거래 삭제 pending은 fundDirect·기초정보 복원이 끝난 뒤 재시도합니다.
    // 새로고침 직후 빈 메모리 상태로 보유현황을 먼저 동기화하면 TDF/직접펀드까지 지울 수 있으므로
    // 반드시 비거래 보유 원자료를 복원한 다음, 아래 거래/보유 원격 복원보다 먼저 처리합니다.
    let pendingEmptySyncResolvedAtLoad = false;
    if (pendingEmptySyncAtLoad
        && typeof _retryPendingExplicitEmptyTradeSync === 'function') {
      if (!hasAuthoritativeFundDirect) {
        const pendingHoldingsData = pendingHoldingsPromise ? await pendingHoldingsPromise : null;
        if (!isLoadConnectionCurrent()) return false;
        const pendingHoldingsLoaded = !!(
          pendingHoldingsData
          && pendingHoldingsData.status === 'ok'
          && Array.isArray(pendingHoldingsData.holdings)
        );
        // 레거시 연결에서는 직접펀드 보존 원천 읽기 실패 시 파괴적 빈 holdings 쓰기를 하지 않습니다.
        if (!pendingHoldingsLoaded) return false;
        pendingHoldingsData.holdings.forEach(h => {
          const isFundEntry = ['TDF','펀드'].includes(h.assetType)
            && !h.code
            && Number(h.qty) === 1;
          if (!isFundEntry || !h.name || Object.prototype.hasOwnProperty.call(fundDirect, h.name)) return;
          fundDirect[h.name] = {
            eval: h.costAmt || 0,
            cost: h.costAmt || 0,
            type: h.assetType || 'TDF'
          };
        });
      }
      prog('빈 거래원장 동기화 재시도 중...');
      let pendingRetryOk = false;
      try {
        pendingRetryOk = await _retryPendingExplicitEmptyTradeSync({ quiet: true, allowDuringRestore: true });
      } catch (e) {
        console.warn('빈 거래원장 부트스트랩 재시도 실패:', e);
      }
      if (!isLoadConnectionCurrent()) return false;
      // 성공 확인 전에는 복원 완료/쓰기 가능 상태로 승격하지 않습니다.
      if (!pendingRetryOk) return false;
      pendingEmptySyncResolvedAtLoad = true;
    }

    // ── GSheet 설정 복원 후 localStorage 일괄 저장 (개별 중복 저장 제거)
    // pending이 있던 요청은 portfolioRestorePromise=null이므로 오래된 원격 거래/보유를 적용하지 않습니다.
    saveHoldings({ skipGsheet: true });
    saveAcctColors();
    saveAcctOrder();
    // 통합 응답의 settings에는 전용 데이터도 포함됩니다. 최신 GAS에서는 같은 설정
    // 시트를 다시 두 번 읽지 않고 아래 하위 호환 적용 경로를 그대로 사용합니다.
    const [divLoaded, reLoaded] = isBootstrap
      ? [false, false]
      : await Promise.all([
          loadDividendSettings({ targetUrl: loadTarget, generation: loadGeneration, allowDuringRestore: true }),   // 배당 별도 시트 우선
          loadRealEstateSettings({ targetUrl: loadTarget, generation: loadGeneration, allowDuringRestore: true }), // 부동산/대출 별도 시트 우선
        ]);
    if (!isLoadConnectionCurrent()) return false;

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

    // pending 삭제 재시도가 성공한 강제 복원에서는 서버에 방금 확정한 빈 거래/보유 상태를
    // 메모리에도 즉시 적용합니다. 이전 연결의 rawTrades/rawHoldings를 남긴 채 복원 완료로 표시하지 않습니다.
    if (forcePortfolioRestore && pendingEmptySyncResolvedAtLoad) {
      rawTrades.length = 0;
      rawHoldings.length = 0;
      saveHoldings({ skipGsheet: true });
    }

    // pending 성공 직후에는 preflight 시점의 오래된 원격 거래/보유를 다시 적용하지 않습니다.
    const applyForcedPortfolioRestore = forcePortfolioRestore && !pendingEmptySyncResolvedAtLoad;
    // ── 거래이력 복원 (연결 변경/명시적 pull 시에는 성공한 빈 배열도 현재 원격 상태로 적용)
    if ((rawTrades.length === 0 && !pendingEmptySyncResolvedAtLoad) || applyForcedPortfolioRestore) {
      try {
        prog('거래이력 복원 중...');
        const restoredPortfolio = forcedPortfolioRestoreData
          || (portfolioRestorePromise ? await portfolioRestorePromise : [null, null]);
        if (!isLoadConnectionCurrent()) return false;
        const trData = restoredPortfolio[0];
        const hData = restoredPortfolio[1];
        const tradesLoaded = !!(trData && trData.status === 'ok' && Array.isArray(trData.trades));
        const holdingsLoaded = !!(hData && hData.status === 'ok' && Array.isArray(hData.holdings));

        // 레거시 Settings에 fundDirect가 없더라도 보유현황 시트의 코드 없는 TDF/펀드는
        // 거래 유무와 무관하게 직접펀드 원자료로 보완합니다. Settings 값이 있으면 우선 보존합니다.
        if (!hasAuthoritativeFundDirect && holdingsLoaded) {
          hData.holdings.forEach(h => {
            const isFundEntry = ['TDF','펀드'].includes(h.assetType) && !h.code && Number(h.qty) === 1;
            if (!isFundEntry || !h.name || Object.prototype.hasOwnProperty.call(fundDirect, h.name)) return;
            fundDirect[h.name] = { eval: h.costAmt || 0, cost: h.costAmt || 0, type: h.assetType || 'TDF' };
          });
        }

        if (applyForcedPortfolioRestore) {
          // 연결 변경/명시적 pull 강제 복원은 빈 배열도 유효한 원격 상태입니다.
          // 둘 중 하나라도 읽기 실패면 이전 연결 데이터를 섞지 않고 복원 플래그를 유지합니다.
          if (!tradesLoaded || !holdingsLoaded) return false;
          rawTrades.length = 0;
          trData.trades.forEach(t => {
            rawTrades.push({ ...t, id: t.id || genTradeId() });
          });
          if (rawTrades.length > 0) {
            syncHoldingsFromTrades();
          } else {
            rawHoldings.length = 0;
            hData.holdings.forEach(h => {
              const isFundEntry = ['TDF','펀드'].includes(h.assetType) && !h.code && h.qty === 1;
              if (isFundEntry) {
                if (!hasAuthoritativeFundDirect && !Object.prototype.hasOwnProperty.call(fundDirect, h.name)) {
                  fundDirect[h.name] = { eval: h.costAmt || 0, cost: h.costAmt || 0, type: h.assetType || 'TDF' };
                }
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
          }
          saveHoldings({ skipGsheet: true });
        } else if (tradesLoaded && trData.trades.length > 0) {
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
            if (holdingsLoaded && hData.holdings.length > 0) {
              rawHoldings.length = 0;
              hData.holdings.forEach(h => {
                // ★ fundDirect 항목(TDF/펀드, qty=1 & 코드 없음)은 fundDirect로 복원
                const isFundEntry = ['TDF','펀드'].includes(h.assetType) && !h.code && h.qty === 1;
                if (isFundEntry) {
                  if (!hasAuthoritativeFundDirect && !Object.prototype.hasOwnProperty.call(fundDirect, h.name)) {
                    fundDirect[h.name] = { eval: h.costAmt || 0, cost: h.costAmt || 0, type: h.assetType || 'TDF' };
                  }
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

    // 구버전 GAS fallback으로 LOAN_SCHEDULE을 복원한 경우에도 현재월 값을 반영합니다.
    const fallbackLoanChanged = typeof syncLoanFromSchedule === 'function' && syncLoanFromSchedule();
    if (fallbackLoanChanged) {
      await persistRealEstateSettings(true, {
        targetUrl: loadTarget,
        generation: loadGeneration,
        allowDuringRestore: true
      });
    }
    // 일반 Settings 저장이 과거에 실패했더라도 별도로 동기화된 종목코드 시트에서
    // 유형·섹터·통화를 복구합니다. 상단 업데이트와 수동 재동기화에도 동일하게 적용됩니다.
    try {
      if (isBootstrap && typeof applyGsheetCodeList === 'function') applyGsheetCodeList(data.codes);
      else await loadGsheetCodeList({ targetUrl: loadTarget, generation: loadGeneration, allowDuringRestore: true });
    } catch(e) {}
    if (!isLoadConnectionCurrent()) return false;
    const reconciled = typeof reconcileEditablesFromGsheetCodeList === 'function'
      ? reconcileEditablesFromGsheetCodeList()
      : 0;
    if (reconciled > 0) console.log(`[GAS 기초정보 복구] 종목코드 시트에서 ${reconciled}개 필드 반영`);
    _gsPortfolioRestoreRequired = false;
    _gsBootRestored = true;
    return true;
  } catch(e) {
    console.warn('loadSettings 실패:', e);
    return false;
  }
}

async function bootstrapGsheetSettings() {
  if (_gsBootRestored) return true;
  if (!GSHEET_API_URL) return false;
  if (_gsBootPromise) return _gsBootPromise;

  const bootTarget = String(GSHEET_API_URL || '').trim();
  const bootGeneration = getGsheetConnectionGeneration();
  const run = (async () => {
    try {
      const ok = await loadSettings();
      // ★ [개선] GAS 버전 불일치 감지 — 재배포 필요 여부를 사용자에게 알림
      if (ok && typeof EXPECTED_GAS_VERSION !== 'undefined') {
        const serverVer = window._lastGasVersion;
        if (serverVer && serverVer !== EXPECTED_GAS_VERSION) {
          showToast(`⚠️ GAS 버전 불일치 (서버: ${serverVer} / 기대: ${EXPECTED_GAS_VERSION}) — 재배포가 필요할 수 있어요`, 'warn', 6000);
          console.warn('[GAS 버전 불일치]', { serverVer, expected: EXPECTED_GAS_VERSION });
        }
      }
      if (!ok) {
        // 연결 자체가 바뀌었거나 새 연결 강제 복원이 미완료면 부분 설정을 섞지 않습니다.
        if (!isGsheetConnectionCurrent(bootTarget, bootGeneration) || _gsPortfolioRestoreRequired) return false;
        // 기존 연결의 일시적인 Settings 실패에서만 별도 읽기 fallback을 허용합니다.
        try { await loadDividendSettings({ targetUrl: bootTarget, generation: bootGeneration }); } catch(e) {}
        try { await loadRealEstateSettings({ targetUrl: bootTarget, generation: bootGeneration }); } catch(e) {}
        const loanChanged = typeof syncLoanFromSchedule === 'function' && syncLoanFromSchedule();
        if (loanChanged) {
          await persistRealEstateSettings(true, {
            targetUrl: bootTarget,
            generation: bootGeneration,
            allowDuringRestore: true
          });
        }
        return false;
      }
      _gsBootRestored = true;
      return true;
    } catch(e) {
      console.warn('bootstrapGsheetSettings 실패:', e);
      return false;
    } finally {
      try { refreshAll(); } catch(e) {}
      try { if (typeof _mgmtRefresh === 'function') _mgmtRefresh(); } catch(e) {}
    }
  })();

  _gsBootPromise = run;
  try {
    return await run;
  } finally {
    if (_gsBootPromise === run) _gsBootPromise = null;
  }
}
