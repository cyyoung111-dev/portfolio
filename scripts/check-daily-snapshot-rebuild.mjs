import assert from 'node:assert/strict';
import fs from 'node:fs';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/views/views_history_state.js', 'utf8');
const ui = fs.readFileSync('src/web/core/core_ui.js', 'utf8');
const history = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipeline = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const html = fs.readFileSync('src/web/index.html', 'utf8');
const sync = fs.readFileSync('src/web/features/settings/settings_sync.js', 'utf8');
const portfolioData = fs.readFileSync('src/web/domain/portfolio/data.js', 'utf8');
const settings = fs.readFileSync('src/web/features/settings/settings.js', 'utf8');
const tabSync = fs.readFileSync('src/web/features/settings/settings_tabsync.js', 'utf8');
const tradesView = fs.readFileSync('src/web/views/views_trades.js', 'utf8');

function holdingsAtDate(rows, date) {
  const map = {};
  for (const row of rows) {
    const [rowDate, type, , name, code, rawQty, rawPrice, assetType, , rawRatio] = row;
    if (!rowDate || rowDate > date || !name) continue;
    const qty = Number(rawQty) || 0;
    const price = Number(rawPrice) || 0;
    const ratio = Number(rawRatio) || 0;
    map[name] ||= { name, code, qty: 0, costAmt: 0, assetType: assetType || '주식' };
    const position = map[name];
    if (type === 'buy') {
      position.qty += qty;
      position.costAmt += qty * price;
    } else if (type === 'sell') {
      const sold = Math.min(qty, position.qty);
      const avg = position.qty > 0 ? position.costAmt / position.qty : 0;
      position.qty -= sold;
      position.costAmt -= sold * avg;
    } else if (type === 'split' && ratio > 0) {
      position.qty *= ratio;
    } else if (type === 'reverse_split' && ratio > 0) {
      position.qty /= ratio;
    }
    if (position.qty < 0.0001) { position.qty = 0; position.costAmt = 0; }
  }
  return Object.fromEntries(Object.entries(map).filter(([, p]) => p.qty > 0.0001));
}

// 과거일 수량, 매도 후 과거 오염 방지, 전량매도 후 0, 분할·병합 원가 불변
const trades = [
  ['2026-01-02', 'buy', 'A', '삼성전자', '005930', 10, 100, '주식', '', ''],
  ['2026-01-05', 'split', 'A', '삼성전자', '005930', 10, 0, '주식', '', 2],
  ['2026-01-07', 'sell', 'A', '삼성전자', '005930', 5, 0, '주식', '', ''],
];
assert.equal(holdingsAtDate(trades, '2026-01-03').삼성전자.qty, 10);
assert.equal(holdingsAtDate(trades, '2026-01-06').삼성전자.qty, 20);
assert.equal(holdingsAtDate(trades, '2026-01-08').삼성전자.qty, 15);
assert.equal(holdingsAtDate(trades, '2026-01-08').삼성전자.costAmt, 750);
assert.deepEqual(holdingsAtDate([...trades, ['2026-01-09', 'sell', 'A', '삼성전자', '005930', 15, 0, '주식', '', '']], '2026-01-10'), {});
const reverse = holdingsAtDate([...trades, ['2026-01-09', 'reverse_split', 'A', '삼성전자', '005930', 15, 0, '주식', '', 3]], '2026-01-10').삼성전자;
assert.equal(reverse.qty, 5);
assert.equal(reverse.costAmt, 750);

// 과거 일반 종목 매수수량 정정은 같은 평가단가에서 평가금액까지 즉시 달라져야 합니다.
const originalPast = holdingsAtDate(trades, '2026-01-03').삼성전자;
const correctedPastTrades = trades.map(row => row[0] === '2026-01-02' && row[4] === '005930'
  ? [row[0], row[1], row[2], row[3], row[4], 12, row[6], row[7], row[8], row[9]] : row);
const correctedPast = holdingsAtDate(correctedPastTrades, '2026-01-03').삼성전자;
assert.equal(originalPast.qty, 10);
assert.equal(correctedPast.qty, 12,'과거 거래수량 정정 반영');
// 가격·환율이 확정되지 않으면 기존 Snapshot을 덮지 않는 정책 모델
function buildValue(position, close, fx = 1) {
  if (!(close > 0) || !(fx > 0)) return null;
  const evalAmt = Math.round(position.qty * close * fx);
  return { evalAmt, pnl: evalAmt - position.costAmt };
}
const position = { qty: 2, costAmt: 1000 };
assert.deepEqual(buildValue(originalPast, 700), { evalAmt: 7000, pnl: 6000 },'정정 전 과거 평가금액');
assert.deepEqual(buildValue(correctedPast, 700), { evalAmt: 8400, pnl: 7200 },'수량 10→12 정정 후 과거 평가금액 자동 재계산');
assert.equal(buildValue(position, 0), null);
assert.equal(buildValue(position, 100, 0), null);
assert.deepEqual(buildValue(position, 700), { evalAmt: 1400, pnl: 400 });

// 주말·휴장일 carry-forward와 미래 가격 차단 모델
const confirmed = [{ date: '2026-01-07', price: 700 }, { date: '2026-01-09', price: 720 }];
const carry = confirmed.filter(x => x.date < '2026-01-10').at(-1);
assert.equal(carry.price, 720);
assert.equal(confirmed.filter(x => x.date <= '2026-01-06').at(-1)?.price, undefined);

// 구현 계약: Snapshot은 원자료만 읽고, persist=false는 Snapshot 저장 경로를 타지 않는다.
assert.match(gas, /function _currentNonTradeSnapshotHoldingNames\(ss\)[\s\S]*assetType !== 'TDF'[\s\S]*assetType !== '펀드'[\s\S]*_readSettingsMap\(ss\)[\s\S]*settings\.EDITABLE_PRICES[\s\S]*settings\.fundDirect/,
  '현재 보유뿐 아니라 Settings master에 남은 과거 코드 없는 TDF/펀드도 거래원장 밖 비거래 보유로 식별');
assert.match(gas, /function _preserveCurrentNonTradeSnapshotRows\(existingRows, expectedRows, nonTradeNames\)[\s\S]*out\.push\(row\)/,
  '거래기반 Snapshot 재생성은 기존 비거래 직접펀드 행을 삭제하지 않고 보존');
assert.match(gas, /var currentNonTradeHoldingNames = _currentNonTradeSnapshotHoldingNames\(ss\)[\s\S]*rows = _preserveCurrentNonTradeSnapshotRows\(existing, rows, currentNonTradeHoldingNames\)/,
  '일별 재생성 경로에 비거래 직접펀드 보존을 적용');
assert.match(gas, /function rebuildDailySnapshots\(fromStr, toStr, options\)/);
assert.match(gas, /function _collectDailySnapshotDates\(ss, fromDate, toDate, options\)/);
assert.match(gas, /function _getHistoricalExchangeRates\(ss, currencies, dateStr\)/);
assert.match(gas, /function _getFundEvaluationAtDate\(ss, code, dateStr\)/);
assert.match(gas, /getRange\(2, 1, tradeSh\.getLastRow\(\) - 1, Math\.min\(11, tradeSh\.getLastColumn\(\)\)\)/);
assert.match(gas, /var ratio = parseFloat\(row\[9\]\) \|\| 0/);
assert.match(gas, /if \(throwOnError\) \{\s*var invalid = \[\]/);
assert.match(gas, /확정 원자료 부족으로 기존 Snapshot 보존/);
assert.match(gas, /_getFundEvaluationAtDate\(ss, fundCode, dateStr\)/);
assert.match(gas, /sourceMap\[fundCode\] = \{ src: fundValue\.carried \? 'FUND_NAV_CARRY@' \+ fundValue\.sourceDate : 'FUND_NAV'/);
assert.match(gas, /cachedPayload\.priceLookup\.snapshotCreated = persist && cachedLatestDate/);
const priceBody = gas.slice(gas.indexOf('function handleGetPricesCompat'), gas.indexOf('function _latestDateFromPriceDates'));
assert.doesNotMatch(priceBody, /persists*=s*false/);
assert.match(priceBody, /if \(persist && confirmedPersistDates\.length\) _rebuildSnapshotForDateFromHistory/);
assert.match(gas, /var smoke = oauth.ok \? _tossPriceSmoke_\(token\)/);
assert.match(gas, /fetchMarketIndicatorCandlesToss\(key, fromDate, toDate\)/);
assert.match(gas, /fetchYahooIndexSeries\(key, fromDate, toDate\)/);
assert.doesNotMatch(gas.slice(gas.indexOf('function rebuildDailySnapshots'), gas.indexOf('function _readSnapshotRowsByDate')), /GOOGLEFINANCE\s*\(/);
assert.doesNotMatch(gas.slice(gas.indexOf('function rebuildDailySnapshots'), gas.indexOf('function _readSnapshotRowsByDate')), /fetchExchangeRates\(/);

// 기존 원자료/스냅샷/펀드·배당 시트 보호와 대상 날짜 비교 후 upsert
assert.match(gas, /var existing = _readSnapshotRowsByDate\(ss, date\)/);
assert.match(gas, /var rewritePlan = _snapshotRewritePlan\(ss, date, rows, rebuildFundConfigs\)[\s\S]*rewritePlan\.unsafe\.length[\s\S]*!rewritePlan\.needsRewrite\) unchanged\+\+/);
assert.match(gas, /if \(!rows\.length\)[\s\S]*rewritePlan\.lifecycleRemovedRows > 0[\s\S]*writeSnapshotRows\(ss, date, rewritePlan\.raw, true, null, rebuildFundConfigs\)/, '빈 기대 결과에서도 0좌 lifecycle 제거를 위해 재작성');
assert.match(gas, /var lifecycleRows = _filterSnapshotRowsByFundLifecycle\(rawRows, repairFundConfigs, snapshotDate\)[\s\S]*lifecycleRemovedRows[\s\S]*expected\.length === 0[\s\S]*lifecycleRemovedRows === 0[\s\S]*writeSnapshotRows\(ss, snapshotDate, existing, true, null, repairFundConfigs\)/, '전체 정합성 복구도 expected 0일 때 lifecycle 제거 수행');
assert.match(gas, /catch \(error\) \{\s*\/\/ 원자료 부족/);
assert.match(gas, /function _getHistoricalExchangeRates[\s\S]*?header\[0\] !== '날짜' \|\| header\[1\] !== '통화' \|\| header\[2\] !== '환율'/);
assert.match(gas, /SHEET_ETF_DIVIDENDS/);
assert.match(gas, /FUND_NAV_SHEET, \[0, 4\]/);
assert.match(gas, /addSheetDates\(CONFIG\.SHEET_SNAPSHOT, \[0\]\)/,'기존 Snapshot도 과거 거래 변경 비교 대상에 포함');
assert.match(gas, /affectedFrom = _earliestChangedTradeDate\(previousRows, currentRows\)/,'거래 추가·수정·삭제 최초 영향일 계산');
assert.match(gas, /rebuildDailySnapshots\(affectedFrom, affectedTo, \{ includeToday: explicitEmptyReset \}\)/,'최초 영향일부터 영향 종료일까지 공통 계산기로 갱신');
assert.match(gas, /function _hasSnapshotHoldingsAtDate\(ss, dateStr\)/,
  '빈 재계산 결과가 실제 무보유인지 거래원장에서 별도 판정');
assert.match(gas.match(/function _hasSnapshotHoldingsAtDate[\s\S]*?\n}/)?.[0] || '', /if \(!tradeSh\) return null;[\s\S]*if \(tradeSh\.getLastRow\(\) < 2\) return false;/,
  '시트 부재(null)와 헤더만 있는 빈 거래원장(false)을 구분');
assert.match(gas, /hasHoldings === true[\s\S]*확정 평가 원자료 부족으로 기존 Snapshot 보존/,
  '보유가 있는데 평가 rows가 비면 성공이 아니라 불완전 재생성으로 기록');
assert.match(gas, /hasHoldings === false[\s\S]*writeSnapshotRows\(ss, date, \[\], true, null, rebuildFundConfigs, true\)/,
  '전량매도 후 빈 포트폴리오는 기존 Snapshot을 명시적으로 비움');
assert.match(gas, /function writeSnapshotRows\(ss, dateStr, newRows, overwrite, manualKeys, lifecycleConfigs, allowEmptyOverwrite\)/,
  '빈 포트폴리오 덮어쓰기는 명시적 플래그에서만 허용');
assert.match(gas.match(/function handleSyncTrades[\s\S]*?\n}/)?.[0] || '', /saveState: 'partial'[\s\S]*followupRequired: true/,
  '거래원장 저장 후 Snapshot 재생성 실패는 partial 상태로 구분');
assert.match(sync, /data\.saveState === 'partial'[\s\S]*일부 반영:[\s\S]*영향기간/,
  '웹 거래동기화도 partial 상태를 사용자에게 명확히 표시');
assert.match(sync, /async function syncTradesToGsheet\(options\)[\s\S]*sourceTrades\.length === 0 && !allowEmpty[\s\S]*return/,
  '초기화되지 않은 빈 거래상태는 원격 거래원장을 삭제하지 않음');
assert.match(sync, /trades\.length === 0 && \(sourceTrades\.length > 0 \|\| !allowEmpty\)/,
  '명시적 빈 원장 권한이 없으면 [] 전송 차단');
assert.match(portfolioData, /PENDING_EMPTY_TRADE_SYNC_KEY = 'pf_v6_pending_empty_trade_sync'[\s\S]*lsGet\(PENDING_EMPTY_TRADE_SYNC_KEY, null\)/,
  '빈 원장 재시도 컨텍스트를 localStorage에서 복원');
assert.match(portfolioData, /target: _currentGsheetSyncTarget\(\)/,
  '빈 원장 삭제 권한을 생성 당시 GSheet 연결에 귀속');
assert.match(portfolioData, /pending\.target !== currentTarget[\s\S]*return null/,
  '다른 GSheet에서는 pending 삭제를 실행하지 않음');
assert.doesNotMatch(portfolioData, /pending\.target !== currentTarget[\s\S]{0,260}_setPendingExplicitEmptyTradeSync\(null\)/,
  '연결 변경만으로 성공하지 않은 빈 원장 pending을 폐기하지 않음');
assert.match(portfolioData, /_setPendingExplicitEmptyTradeSync[\s\S]*lsSave\(PENDING_EMPTY_TRADE_SYNC_KEY[\s\S]*lsRemove\(PENDING_EMPTY_TRADE_SYNC_KEY\)/,
  'pending 컨텍스트는 영속 저장하고 성공 후 제거 가능');
assert.match(portfolioData, /const currentRecoverySignature = \(\) => JSON\.stringify\([\s\S]*for \(let attempt = 0; attempt < 4; attempt\+\+\)[\s\S]*const recoveryTrades = rawTrades\.map\(t => \(\{ \.\.\.t \}\)\)[\s\S]*const recoveryHoldings = rawHoldings\.map\(h => \(\{ \.\.\.h \}\)\)[\s\S]*syncHoldingsToGsheet\(\{[\s\S]*holdingsOverride: recoveryHoldings[\s\S]*syncTradesToGsheet\(\{[\s\S]*tradesOverride: recoveryTrades[\s\S]*currentRecoverySignature\(\) !== recoverySignature[\s\S]*continue/,
  '복구 쓰기는 고정 payload를 함께 보내고 캡처 이후 거래/보유 변경 시 같은 single-flight에서 최신 상태를 재전송');
assert.match(portfolioData, /const retryTrades = \[\][\s\S]*syncTradesToGsheet\(\{[\s\S]*targetUrl: retryTarget,[\s\S]*tradesOverride: retryTrades/,
  '연결 변경 중에도 두 번째 쓰기는 캡처한 빈 거래 payload만 원래 GSheet에 적용');
assert.match(settings, /let GSHEET_CONNECTION_GENERATION = 0[\s\S]*function isGsheetConnectionCurrent\(target, generation\)/,
  'GSheet 연결 세대로 A→B→A 전환을 구분');
assert.match(settings, /const loadTarget = String\(GSHEET_API_URL[\s\S]*const loadGeneration = getGsheetConnectionGeneration\(\)[\s\S]*isLoadConnectionCurrent[\s\S]*requestGsheetActionJson\('getBootstrap'[\s\S]*targetUrl: loadTarget[\s\S]*if \(!isLoadConnectionCurrent\(\)\) return false/,
  'loadSettings는 시작 target/세대를 고정하고 stale 응답 적용을 중단');
assert.match(portfolioData, /const retryGeneration = typeof getGsheetConnectionGeneration[\s\S]*getGsheetConnectionGeneration\(\) !== retryGeneration[\s\S]*return false/,
  '빈 원장 재시도도 URL 동일성 외 연결 세대 변경을 검사');
assert.match(settings, /const explicitAuthoritativePull = options\?\.forcePortfolioRestore === true[\s\S]*const connectionForcePortfolioRestore = _gsPortfolioRestoreRequired === true[\s\S]*const forcePortfolioRestore = connectionForcePortfolioRestore[\s\S]*explicitAuthoritativePull[\s\S]*if \(forcePortfolioRestore && pendingEmptySyncResolvedAtLoad\)[\s\S]*rawTrades\.length = 0[\s\S]*rawHoldings\.length = 0[\s\S]*const applyForcedPortfolioRestore = forcePortfolioRestore && !pendingEmptySyncResolvedAtLoad/,
  'pending 성공 강제 복원은 방금 확정한 빈 원장을 메모리에 적용하고 stale preflight 재적용을 막음');
assert.match(settings, /if \(applyForcedPortfolioRestore\) \{[\s\S]*if \(!tradesLoaded \|\| !holdingsLoaded\) return false[\s\S]*rawTrades\.length = 0[\s\S]*else \{[\s\S]*rawHoldings\.length = 0[\s\S]*saveHoldings\(\{ skipGsheet: true \}\)/,
  '강제 원격 복원은 정상 빈 거래·보유 배열도 적용해 이전 로컬 데이터를 제거');
assert.match(tabSync, /tabId === 'trades'[\s\S]*loadSettings\(undefined, \{ forcePortfolioRestore: true \}\)[\s\S]*원격 복원/,
  '거래 탭 재동기화는 로컬 업로드가 아니라 원격 거래·보유 authoritative pull');
assert.doesNotMatch(tabSync, /tabId === 'trades' && rawTrades\.length === 0/,
  '로컬 거래 존재 여부로 거래 재동기화 방향을 바꾸지 않음');
assert.match(settings, /if \(forcePortfolioRestore \|\| \(s\.fundDirect[\s\S]*Object\.keys\(fundDirect\)\.forEach\(k => delete fundDirect\[k\]\)[\s\S]*Object\.assign\(fundDirect, s\.fundDirect\)/,
  '연결 변경 강제 복원은 원격 fundDirect 키가 없어도 이전 연결 직접펀드를 제거');
assert.match(settings, /const bootstrapPortfolioStatus = isBootstrap[\s\S]*bootstrapTradesOk[\s\S]*bootstrapHoldingsOk[\s\S]*status: bootstrapTradesOk \? 'ok' : 'error'[\s\S]*status: bootstrapHoldingsOk \? 'ok' : 'error'/,
  'bootstrap 하위 거래·보유 읽기 성공 여부를 강제 복원 판정에 보존');
assert.match(settings, /const bootstrapTradesOk = bootstrapPortfolioStatus[\s\S]*: !forcePortfolioRestore[\s\S]*const bootstrapHoldingsOk = bootstrapPortfolioStatus[\s\S]*: !forcePortfolioRestore/,
  '구버전 bootstrap의 성공 여부 누락은 연결 변경 강제 복원에서 안전 실패 처리');
assert.match(settings, /if \(forcePortfolioRestore && portfolioRestorePromise\)[\s\S]*forcedPortfolioRestoreData = await portfolioRestorePromise[\s\S]*preflightTradesOk[\s\S]*preflightHoldingsOk[\s\S]*if \(!preflightTradesOk \|\| !preflightHoldingsOk\) return false/,
  '연결 변경 강제 복원은 설정 전역상태 적용 전에 거래·보유 읽기를 preflight');
assert.match(settings, /if \(holdingsLoaded\) \{[\s\S]*\['TDF','펀드'\]\.includes\(h\.assetType\)[\s\S]*Object\.prototype\.hasOwnProperty\.call\(fundDirect, h\.name\)[\s\S]*fundDirect\[h\.name\]/,
  '거래가 있는 레거시 연결도 holdings의 직접펀드를 fundDirect에 보완 복원');
assert.match(settings, /async function loadDividendSettings\(options\)[\s\S]*targetUrl[\s\S]*generation[\s\S]*requestGsheetActionJson\([\s\S]*targetUrl[\s\S]*if \(!isGsheetConnectionCurrent\(targetUrl, generation\)\) return false[\s\S]*_applyDivData/,
  '배당 하위 응답은 캡처 target/generation 검증 후에만 전역 상태에 적용');
assert.match(settings, /function saveDividendSettings\(_immediate, options\)[\s\S]*expectedGeneration[\s\S]*isGsheetConnectionCurrent\(targetUrl, expectedGeneration\)[\s\S]*requestGsheetFormJson\([\s\S]*targetUrl/,
  '직렬화된 배당 저장도 호출 시점 target/generation에 고정해 연결 변경 cross-write를 차단');
assert.match(settings, /function saveRealEstateSettings\(immediate, options\)[\s\S]*expectedGeneration[\s\S]*const payload = JSON\.stringify\([\s\S]*_saveRealEstatePendingKey[\s\S]*isGsheetConnectionCurrent\(targetUrl, expectedGeneration\)[\s\S]*\{ data: payload \}/,
  '부동산 debounce 저장은 호출 시점 payload와 target/generation을 함께 고정');
assert.match(settings, /function saveSettings\(immediate, options\)[\s\S]*expectedGeneration[\s\S]*const payload = JSON\.stringify\(settings\)[\s\S]*_saveSettingsPendingKey[\s\S]*isGsheetConnectionCurrent\(targetUrl, expectedGeneration\)[\s\S]*\{ data: payload \}/,
  '일반 설정 debounce 저장도 호출 시점 payload와 target/generation을 함께 고정');
assert.match(settings, /let _saveRealEstateQueue = Promise\.resolve\(\)[\s\S]*let _saveSettingsQueue = Promise\.resolve\(\)/,
  '부동산·일반 설정 네트워크 저장 직렬화 큐 유지');
assert.match(settings, /_saveRealEstateQueue = _saveRealEstateQueue\.then\(run, run\)[\s\S]*const ok = await _saveRealEstateQueue/,
  '부동산 저장은 이전 네트워크 저장 완료 후 순차 실행');
assert.match(settings, /_saveSettingsQueue = _saveSettingsQueue\.then\(run, run\)[\s\S]*const ok = await _saveSettingsQueue/,
  '일반 설정 저장은 이전 네트워크 저장 완료 후 순차 실행');
assert.match(settings, /function isGsheetPortfolioWriteReady\(options\)[\s\S]*!_gsBootRestored \|\| _gsPortfolioRestoreRequired/,
  '초기·연결전환 복원 완료 전 일반 원격 쓰기를 차단');
assert.match(settings, /let _gsSettingsLoadEpoch = 0[\s\S]*const loadEpoch = \+\+_gsSettingsLoadEpoch[\s\S]*loadEpoch === _gsSettingsLoadEpoch/,
  '같은 연결에서 겹친 loadSettings도 최신 load epoch만 상태 적용');
assert.match(settings, /const explicitAuthoritativePull = options\?\.forcePortfolioRestore === true[\s\S]*_gsPortfolioRestoreRequired = true[\s\S]*_gsBootRestored = false/,
  '명시적 원격 pull은 시작 즉시 복원 잠금을 걸어 중간 원격 쓰기를 차단');
assert.match(settings, /_gsPortfolioRestoreRequired = false;[\s\S]*_gsBootRestored = true;[\s\S]*return true/,
  'loadSettings 성공 후에만 연결을 원격쓰기 가능 상태로 승격');
assert.match(settings, /let _gsBootPromise = null[\s\S]*if \(_gsBootPromise\) return _gsBootPromise[\s\S]*if \(_gsBootPromise === run\) _gsBootPromise = null/,
  '초기 bootstrap은 single-flight이며 실패 후 재시도 가능');
assert.match(sync, /async function loadGsheetCodeList\(options\)[\s\S]*targetUrl[\s\S]*generation[\s\S]*isGsheetConnectionCurrent\(targetUrl, generation\)[\s\S]*applyGsheetCodeList/,
  '종목코드 fallback 읽기도 stale 연결 응답 적용 전 generation 검증');
assert.match(sync, /async function syncCodesToGsheet\(options\)[\s\S]*isGsheetPortfolioWriteReady/,
  '종목코드 쓰기도 복원 완료된 연결에서만 실행');
assert.match(sync, /async function syncHoldingsToGsheet\(options\)[\s\S]*isGsheetPortfolioWriteReady/,
  '보유현황 쓰기도 복원 완료된 연결에서만 실행');
assert.match(sync, /async function syncTradesToGsheet\(options\)[\s\S]*isGsheetPortfolioWriteReady/,
  '거래원장 쓰기도 복원 완료된 연결에서만 실행');
assert.match(portfolioData, /allowDuringRestore = options\?\.allowDuringRestore === true[\s\S]*generation: retryGeneration[\s\S]*allowDuringRestore/,
  '원래 연결의 pending 빈원장 재시도만 캡처 generation으로 복원 중 내부쓰기 허용');
assert.match(settings, /function _isGasVersionAtLeast\(current, minimum\)[\s\S]*split\('\.'\)[\s\S]*return a > b/,
  'GAS 버전은 parseFloat가 아닌 segment 비교로 9.181 > 9.34를 올바르게 판정');
assert.doesNotMatch(settings, /parseFloat\(window\._lastGasVersion/,'GAS 버전 숫자형 소수 비교 금지');
assert.match(settings, /async function loadRealEstateSettings\(options\)[\s\S]*targetUrl[\s\S]*generation[\s\S]*requestGsheetActionJson\([\s\S]*targetUrl[\s\S]*if \(!isGsheetConnectionCurrent\(targetUrl, generation\)\) return false[\s\S]*Object\.assign\(LOAN/,
  '부동산 하위 응답은 캡처 target/generation 검증 후에만 전역 상태에 적용');
assert.match(settings, /loadDividendSettings\(\{ targetUrl: loadTarget, generation: loadGeneration, allowDuringRestore: true \}\)[\s\S]*loadRealEstateSettings\(\{ targetUrl: loadTarget, generation: loadGeneration, allowDuringRestore: true \}\)/,
  'loadSettings가 하위 복원 요청에도 시작 target/generation을 전달하고 복원-owned 읽기만 허용');
assert.match(sync, /async function syncHoldingsToGsheet\(options\)[\s\S]*targetUrl[\s\S]*requestGsheetFormJson\([\s\S]*targetUrl/,
  '보유현황 동기화가 호출자가 고정한 targetUrl을 사용');
assert.match(sync, /async function syncTradesToGsheet\(options\)[\s\S]*const hasTradesOverride = Array\.isArray\(options\?\.tradesOverride\)[\s\S]*const sourceTrades = hasTradesOverride \? options\.tradesOverride : rawTrades[\s\S]*sourceTrades\.length === 0 && !allowEmpty[\s\S]*requestGsheetFormJson\([\s\S]*targetUrl/,
  '거래원장 동기화는 캡처 payload를 지원하되 allowEmpty 없이는 빈 override 삭제를 차단');
assert.match(portfolioData, /rawTrades\.length > 0[\s\S]*const recoveryTrades = rawTrades\.map\(t => \(\{ \.\.\.t \}\)\)[\s\S]*syncHoldingsToGsheet\(\{[\s\S]*targetUrl: retryTarget,[\s\S]*generation: retryGeneration[\s\S]*syncTradesToGsheet\(\{[\s\S]*targetUrl: retryTarget,[\s\S]*generation: retryGeneration,[\s\S]*tradesOverride: recoveryTrades[\s\S]*Promise\.all[\s\S]*if \(holdingsOk && tradesOk\)[\s\S]*_setPendingExplicitEmptyTradeSync\(null\)/,
  'pending 뒤 새 거래는 현재 거래·보유를 고정 target/generation에 동기화하고 둘 다 성공한 뒤에만 repair token 제거');
assert.doesNotMatch(portfolioData, /else if \(rawTrades\.length > 0 && _getPendingExplicitEmptyTradeSync\(\)\)[\s\S]{0,220}_setPendingExplicitEmptyTradeSync\(null\)/,
  '새 거래가 생겨도 원격 성공 전에 repair token을 조기 폐기하지 않음');
assert.match(portfolioData, /const allowEmptyTradeSync = !!_getPendingExplicitEmptyTradeSync\(\)[\s\S]*await _retryPendingExplicitEmptyTradeSync\(\)/,
  'repair token이 남으면 debounce도 retry 함수의 rawTrades>0 복구 분기로 처리');
assert.match(portfolioData, /holdingsOk && tradesOk[\s\S]*_setPendingExplicitEmptyTradeSync\(null\)/,
  '빈 원장 권한은 보유현황·거래이력 동기화가 모두 성공한 뒤 영속 상태에서도 소진');
assert.match(portfolioData, /tradesResult\?\.affectedFrom[\s\S]*_setPendingExplicitEmptyTradeSync\(\{[\s\S]*tradesResult\.affectedFrom/,
  'partial 응답의 영향 시작일을 영속 갱신해 새로고침 후에도 재시도 가능');
assert.match(settings, /const portfolioRestorePromise = blockRemotePortfolioRestore[\s\S]*\? null/,
  'pending이 있던 부트스트랩에서는 같은 요청의 오래된 원격 거래/보유 복원을 차단');
assert.ok(
  settings.indexOf('Object.assign(fundDirect, s.fundDirect)') < settings.indexOf('await _retryPendingExplicitEmptyTradeSync({ quiet: true, allowDuringRestore: true })'),
  '빈 원장 재시도 전에 fundDirect를 먼저 복원해 비거래 보유현황 삭제를 방지'
);
assert.ok(
  settings.indexOf('await _retryPendingExplicitEmptyTradeSync({ quiet: true, allowDuringRestore: true })') < settings.indexOf('// ── 거래이력 복원'),
  '영속 pending 재시도는 원격 거래/보유 복원 적용 전에 수행'
);
assert.match(settings, /pendingRetryOk = await _retryPendingExplicitEmptyTradeSync[\s\S]*if \(!pendingRetryOk\) return false[\s\S]*pendingEmptySyncResolvedAtLoad = true/,
  '빈 원장 pending은 실제 동기화 성공 후에만 복원 완료 흐름으로 진행');
assert.match(settings, /if \(pendingEmptySyncAtLoad[\s\S]{0,120}typeof _retryPendingExplicitEmptyTradeSync === 'function'\)/,
  'pending 재시도는 로컬 거래가 생긴 경우에도 실행');
assert.doesNotMatch(settings, /if \(pendingEmptySyncAtLoad && rawTrades\.length === 0/,
  'pending 재시도를 rawTrades 빈 상태에만 제한하지 않음');
assert.match(settings, /const applyForcedPortfolioRestore = forcePortfolioRestore && !pendingEmptySyncResolvedAtLoad/,
  'pending 삭제를 방금 서버에 확정한 경우 같은 load에서 오래된 원격 원장을 다시 pull하지 않음');
assert.match(settings, /if \(!forcePortfolioRestore\) \{[\s\S]*let tradeCodeCorrected = false[\s\S]*syncTradesToGsheet\(\)/,
  'authoritative pull 전에 오래된 로컬 거래 코드교정 결과를 GAS로 재전송하지 않음');
assert.match(sync, /explicitEmpty: allowEmpty \? '1' : ''[\s\S]*rebuildFrom/,
  '빈 거래원장 재시도임을 GAS에 명시하고 최초 영향일 전달');
assert.match(portfolioData, /if \(options\?\.skipGsheet\) return;[\s\S]*if \(allowEmptyTradeSyncRequested\) \{[\s\S]*_setPendingExplicitEmptyTradeSync\(\{[\s\S]*clearTimeout\(_saveHoldingsGasTimer\)/,
  '빈 원장 재시도 컨텍스트는 로컬 저장 성공 및 GSheet 동기화 경로 확정 후 영속 획득');
assert.match(sync, /async function syncHoldingsToGsheet\(options\)[\s\S]*holdings\.length === 0 && !allowEmpty[\s\S]*return/,
  '초기 빈 상태에서는 원격 보유현황을 보존하고 확인된 마지막 거래 삭제에서만 [] 허용');
assert.match(tradesView, /deletedFrom[\s\S]*allowEmptyTradeSync: before > 0 && rawTrades\.length === 0[\s\S]*emptyTradeSyncFrom:/,
  '마지막 거래 삭제 시 삭제된 거래의 최초 날짜를 재시도 영향 시작일로 보존');
assert.match(html, /settings_sync\.js\?v=20261007-17/,'거래동기화 자산 캐시 버전 갱신');
assert.match(html, /domain\/portfolio\/data\.js\?v=20261007-12/,'거래 저장 로직 캐시 버전 갱신');
assert.match(html, /views\/views_trades\.js\?v=20261007-2/,'거래 삭제 로직 캐시 버전 갱신');
assert.match(html, /features\/settings\/settings\.js\?v=20261007-15/,'부트스트랩 재시도 로직 캐시 버전 갱신');
assert.match(html, /features\/settings\/settings_tabsync\.js\?v=20261007-1/,'거래 탭 원격 재동기화 로직 캐시 버전 갱신');
assert.match(html, /features\/settings\/settings_net\.js\?v=20261007-3/,'연결 generation 로직 캐시 버전 갱신');
assert.match(html, /features\/settings\/settings_fetch\.js\?v=20261007-15/,'현재가 연결 격리 로직 캐시 버전 갱신');
assert.match(html, /features\/management\/mgmt_editor\.js\?v=20261007-11/,'편집기 연결별 캐시 로직 버전 갱신');
assert.match(gas, /handleSyncTrades\(params\.data, params\.rebuildFrom \|\| '', params\.explicitEmpty === '1'\)/,
  'GAS syncTrades가 명시적 빈 원장 재시도 컨텍스트를 전달');
assert.match(gas, /TRADE_SNAPSHOT_REBUILD_PENDING_KEY[\s\S]*function _readPendingTradeSnapshotRebuild[\s\S]*function _setPendingTradeSnapshotRebuild/,
  '거래원본 저장 후 Snapshot partial 재계산 시작일을 서버에 영속');
assert.match(gas, /pendingSnapshotRebuild = _readPendingTradeSnapshotRebuild\(\)[\s\S]*pendingSnapshotRebuild\.from < affectedFrom[\s\S]*affectedFrom = pendingSnapshotRebuild\.from/,
  '동일 거래 재전송에서도 이전 partial 영향 시작일부터 재계산');
assert.match(gas, /snapshotRebuild\.errors[\s\S]*_setPendingTradeSnapshotRebuild\(affectedFrom\)[\s\S]*saveState: 'partial'/,
  'Snapshot 재계산 오류는 성공 응답 전에 pending을 보존');
assert.match(gas, /if \(pendingSnapshotRebuild\) _clearPendingTradeSnapshotRebuild\(\)[\s\S]*saveState: 'success'/,
  'pending 재계산은 실제 성공 후에만 제거');
assert.match(gas, /_latestConfirmedSnapshotDate\(ss, explicitEmptyReset\)[\s\S]*includeToday: explicitEmptyReset/,
  '마지막 거래 삭제에서는 당일 Snapshot까지 재계산 범위에 포함');
assert.match(gas, /date < today\(\) \|\| \(includeToday && date === today\(\)\)/,
  '일반 재생성은 전일까지만 유지하고 explicit empty에서만 오늘 날짜 허용');
assert.match(gas, /rebuildOperationId = 'rebuildDailySnapshots\|'[\s\S]*_snapshotBackupOperationId = rebuildOperationId/,'다일자 재생성은 작업 단위 백업 재사용');

// KOSDAQ 선택·라벨·시각화·확정 기준 표시
assert.match(web, /\['KOSPI', 'KOSDAQ', 'SP500'/);
assert.match(web, /HIST_BENCHMARK_STORAGE_KEY/);
assert.match(web, /localStorage\.setItem\(HIST_BENCHMARK_STORAGE_KEY/);
assert.match(ui, /KOSDAQ:'KOSDAQ'/);
assert.match(history, /KOSDAQ: \{ color:/);
assert.match(pipeline, /평가 기준 \$\{latestDate\}/);
assert.match(html, /core\/core_ui\.js\?v=20260917-2/);

// TWR은 별도 도입하지 않고 기존 현금흐름 조정 지수만 유지
assert.match(fs.readFileSync('src/web/views/views_history_utils.js', 'utf8'), /_buildCashflowAdjustedReturnIndex/);
assert.doesNotMatch(gas, /function\s+calculateTwr\s*\(/i);

console.log('✅ 일별 Snapshot 원자료·날짜·환율·펀드·Corporate Action·KOSDAQ 회귀 검사 통과');
