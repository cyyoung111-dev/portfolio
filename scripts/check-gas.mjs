import fs from 'node:fs';
import vm from 'node:vm';

const path = 'src/gas/apps_script.gs';
const source = fs.readFileSync(path, 'utf8');

// Apps Script 전역 객체는 실행하지 않고 JavaScript 구문만 컴파일합니다.
new vm.Script(source, { filename: path });

// 주석과 문자열을 제외한 뒤 `_`로 시작하는 내부 헬퍼 호출이 실제 선언되어 있는지 확인합니다.
const scrubbed = source
  .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const declared = new Set([
  ...scrubbed.matchAll(/\bfunction\s+(_[A-Za-z$][\w$]*)\s*\(/g),
  ...scrubbed.matchAll(/\bvar\s+(_[A-Za-z$][\w$]*)\s*=\s*function\s*\(/g),
].map(match => match[1]));
const called = new Set([...scrubbed.matchAll(/\b(_[A-Za-z$][\w$]*)\s*\(/g)].map(match => match[1]));
const missing = [...called].filter(name => !declared.has(name)).sort();

if (missing.length) {
  console.error(`❌ GAS 내부 헬퍼 선언 누락: ${missing.join(', ')}`);
  process.exit(1);
}

// Settings 시트의 헤더만 남기려고 데이터 행 전체를 deleteRows()로 삭제하면
// Google Sheets가 "고정되지 않은 행을 모두 삭제할 수 없습니다" 오류를 반환합니다.
const writeSettingsMatch = source.match(/function\s+_writeSettingsMap\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!writeSettingsMatch
    || /\.deleteRows\s*\(/.test(writeSettingsMatch[1])
    || !/\.clearContent\s*\(/.test(writeSettingsMatch[1])) {
  console.error('❌ _writeSettingsMap은 데이터 행을 삭제하지 말고 clearContent()로 초기화해야 합니다.');
  process.exit(1);
}

console.log(`✅ GAS syntax/internal helper check passed (${declared.size} helpers)`);

if (!source.includes("params.action === 'getBootstrap'")
    || !source.includes('function handleGetBootstrap()')
    || !/handleGetBootstrap[\s\S]*?_readSettingsMap\(ss\)/.test(source)
    || !/handleGetBootstrap[\s\S]*?handleGetTrades\(ss\)/.test(source)
    || !/handleGetBootstrap[\s\S]*?handleGetHoldings\(ss\)/.test(source)
    || !/handleGetBootstrap[\s\S]*?getCodeItems\(ss\)/.test(source)) {
  console.error('❌ 앱 초기 복원은 단일 스프레드시트 핸들로 설정·거래·보유·종목코드를 일괄 반환해야 합니다.');
  process.exit(1);
}

const diagnoseMatch = source.match(/function\s+handleDiagnoseEtfDividends\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!diagnoseMatch
    || /\.(?:setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet)\s*\(/.test(diagnoseMatch[1])
    || !/wroteSheets:\s*false/.test(diagnoseMatch[1])
    || !/wroteDivData:\s*false/.test(diagnoseMatch[1])) {
  console.error('❌ handleDiagnoseEtfDividends는 시트와 DIVDATA를 수정하지 않는 읽기 전용이어야 합니다.');
  process.exit(1);
}

if (!source.includes("params.action === 'diagnoseEtfDividends'")
    || !source.includes('searchEtfContentList')
    || !source.includes('exerInfoDtramtPayStatPlist')) {
  console.error('❌ SEIBro 읽기 전용 진단 route 또는 HAR 기반 action이 누락됐습니다.');
  process.exit(1);
}

const dryRunMatch = source.match(/function\s+handleDryRunEtfDividends\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!dryRunMatch
    || /\.(?:setValue|setValues|appendRow|clearContent|deleteSheet|insertSheet)\s*\(/.test(dryRunMatch[1])
    || !source.includes("'runEtfDividendDryRun'")) {
  console.error('❌ ETF 2단계 드라이런은 시트를 수정하지 않고 메뉴에서 실행할 수 있어야 합니다.');
  process.exit(1);
}

const dryRunUiMatch = source.match(/function\s+runEtfDividendDryRun\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!dryRunUiMatch
    || !/comparisons\.length/.test(dryRunUiMatch[1])
    || !/Math\.ceil\(comparisons\.length\s*\/\s*pageSize\)/.test(dryRunUiMatch[1])
    || /changed\.slice\(0,\s*12\)/.test(dryRunUiMatch[1])) {
  console.error('❌ ETF 2단계 드라이런은 동적으로 선정된 전체 종목 결과를 빠짐없이 표시해야 합니다.');
  process.exit(1);
}

const applyMatch = source.match(/function\s+handleApplyEtfDividends\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!applyMatch
    || !/LockService\.getScriptLock\(\)/.test(applyMatch[1])
    || !/_writeEtfDividendHistory\(/.test(applyMatch[1])
    || !/_writeSettingsMap\(nextSettings\)/.test(applyMatch[1])
    || !/failed\.length/.test(applyMatch[1])
    || !source.includes("'runEtfDividendApply'")) {
  console.error('❌ ETF 3단계 반영은 전체 검증, 잠금, 이력·DIVDATA 저장 및 메뉴 실행을 포함해야 합니다.');
  process.exit(1);
}

if (!source.includes('SHEET_ETF_DIVIDENDS')
    || !source.includes("String(event.source || '').toUpperCase() === 'MANUAL'")) {
  console.error('❌ ETF 분배금 이력 시트 또는 MANUAL 이벤트 보존 로직이 누락됐습니다.');
  process.exit(1);
}

const gasContext = vm.createContext({ console });
new vm.Script(source, { filename: path }).runInContext(gasContext);
const sampleComparisons = [{
  code: '0046Y0', isin: 'KR0000000001', name: '문자열코드검증',
  proposed: {
    perShare: 5, ttmPerShare: 5, freq: '연간', months: [1],
    events: [{ date: '2026-01-01', payDate: '2026-01-02', amount: 5, source: 'SEIBRO' }]
  }
}];
const historyMerge = gasContext._mergeEtfDividendHistory([], sampleComparisons, '2026-08-18T00:00:00+09:00');
const divDataMerge = gasContext._mergeSeibroDivData({
  '0046Y0': { events: [{ date: '2026-01-01', payDate: '2026-01-02', amount: 7, source: 'MANUAL' }] }
}, sampleComparisons, '2026-08-18T00:00:00+09:00');
if (historyMerge.summary.added !== 1
    || historyMerge.rows[0].code !== '0046Y0'
    || divDataMerge['0046Y0'].events.length !== 1
    || divDataMerge['0046Y0'].events[0].amount !== 7
    || divDataMerge['0046Y0'].events[0].source !== 'MANUAL') {
  console.error('❌ ETF 이력 증분 병합, 문자열 코드 또는 MANUAL 이벤트 보존 검사가 실패했습니다.');
  process.exit(1);
}

const protectedSave = gasContext._preserveSeibroDivData({
  '0046Y0': { source: 'SEIBRO', perShare: 16 },
  '005930': { source: 'PUBLIC_DATA', perShare: 100 }
}, {
  '0046Y0': { source: 'GOOGLEFINANCE', perShare: 1 },
  '005930': { source: 'PUBLIC_DATA', perShare: 200 }
});
const manualSave = gasContext._preserveSeibroDivData({
  '0046Y0': { source: 'SEIBRO', perShare: 16 }
}, {
  '0046Y0': { source: 'MANUAL', perShare: 20 }
});
if (protectedSave['0046Y0'].source !== 'SEIBRO'
    || protectedSave['0046Y0'].perShare !== 16
    || protectedSave['005930'].perShare !== 200
    || manualSave['0046Y0'].source !== 'MANUAL') {
  console.error('❌ 구버전 웹 저장의 SEIBro 보호 또는 MANUAL 편집 허용 검사가 실패했습니다.');
  process.exit(1);
}

const currentTargets = [{ code: '0046Y0' }, { code: '0080G0' }];
const currentSettings = { DIVDATA: {
  '0046Y0': { source: 'SEIBRO', updatedAt: '2026-08-18T09:00:00+09:00', events: [{}] },
  '0080G0': { source: 'SEIBRO', updatedAt: '2026-08-18T09:01:00+09:00', events: [{}] }
} };
if (!gasContext._isEtfDividendRefreshCurrent(currentSettings, currentTargets, '2026-08-18')
    || gasContext._isEtfDividendRefreshCurrent(currentSettings, currentTargets.concat([{ code: '458730' }]), '2026-08-18')
    || gasContext._isEtfDividendRefreshCurrent(currentSettings, currentTargets, '2026-08-19')
    || !source.includes("params.action === 'refreshEtfDividends'")
    || !source.includes('handleRefreshEtfDividends(params.force')) {
  console.error('❌ SEIBro ETF 일 1회 자동 갱신 판정 또는 POST route 검사가 실패했습니다.');
  process.exit(1);
}

if (!source.includes("params.action === 'getBenchmarks'")
    || !source.includes('function handleGetBenchmarks(')
    || !source.includes("ss.insertSheet(_tempSheetName('_bm_'))")
    || !source.includes("cache.put(cacheKey, JSON.stringify(result), 21600)")) {
  console.error('❌ 비교지수 단일 요청·단일 임시 시트 일괄 조회 또는 6시간 캐시가 누락됐습니다.');
  process.exit(1);
}

if (!source.includes("props.setProperty('snapshot_last_success_date', snapshotDate)")
    || source.includes('writeSnapshotRows(ss, todayStr, snapRows, true)')
    || !source.includes('INDEX(x,ROWS(x),2)')
    || !source.includes('snapLast < expectedSnapshotDate')
    || !source.includes("'runSnapshotConsistencyRepair'")) {
  console.error('❌ 스냅샷은 확정 종가 거래일로 저장하고 최근 2거래일 및 과거 마지막 종가를 검증해야 합니다.');
  process.exit(1);
}

const dailySnapshotMatch = source.match(/function\s+saveDailyPriceHistory\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!dailySnapshotMatch
    || /fetchPricesKrx\(items,\s*todayStr\)/.test(dailySnapshotMatch[1])
    || /\[prevPrevDay,\s*prevDay\]/.test(dailySnapshotMatch[1])
    || !/fetchPricesKrx\(items,\s*requestedPrevDay\)/.test(dailySnapshotMatch[1])
    || !/fetchPricesGoogleFinance\(gfPrevItems,\s*requestedPrevDay,\s*ss,\s*\{\s*skipKrx:\s*true\s*\}\)/.test(dailySnapshotMatch[1])
    || !/_getLatestPriceHistoryDate\(ss,\s*requestedPrevDay\)/.test(dailySnapshotMatch[1])
    || !/writeSnapshotRows\(ss,\s*snapshotDate,\s*expected,\s*true\)/.test(dailySnapshotMatch[1])
    || !/deleteProperty\('snapshot_last_failure_at'\)/.test(dailySnapshotMatch[1])) {
  console.error('❌ 일일 스냅샷은 확정 거래일 가격을 한 번만 조회하고 과거 전체 검증과 분리해야 합니다.');
  process.exit(1);
}

if (!source.includes('function _hasUsdPriceItems(items)')
    || !/gfNeed\.length\s*>\s*0\s*&&\s*_hasUsdPriceItems\(targetItems\)/.test(source)
    || !/gfPrevItems\.length\s*>\s*0\s*&&\s*_hasUsdPriceItems\(items\)/.test(source)
    || !/fetchPricesGoogleFinance\(gfNeed,\s*todayStr,\s*ss,\s*\{\s*skipKrx:\s*true\s*\}\)/.test(source)
    || !/fetchPricesGoogleFinance\(gfPrevItems,\s*requestedPrevDay,\s*ss,\s*\{\s*skipKrx:\s*true\s*\}\)/.test(source)) {
  console.error('❌ USD 종목이 없는 평가가격 갱신은 GOOGLEFINANCE 임시 시트 조회를 생략해야 합니다.');
  process.exit(1);
}

if (!source.includes('function getLatestPriceHistoryEntries(ss, codes, maxDate)')
    || !source.includes('latestEntry.date > priceDates[code]')
    || !source.includes('priceDates: priceDates')
    || !source.includes('_rebuildSnapshotForDateFromHistory(ss, latestDisplayDate)')
    || !source.includes('var actualPriceDate = p.usedDate || requestedPrevDay')) {
  console.error('❌ 이전 거래일 KRX 응답은 최신 가격이력을 덮지 않고 실제 최신 날짜 스냅샷을 복구해야 합니다.');
  process.exit(1);
}

if (!source.includes('function _ensureDailyTriggersOncePerDay(dateStr)')
    || !source.includes('var triggerState = _ensureDailyTriggersOncePerDay(todayStr)')
    || !source.includes("props.setProperty('daily_triggers_checked_date', dateStr)")
    || !source.includes('function _ensureSnapshotExistsForDate(ss, dateStr)')
    || !source.includes('_ensureSnapshotExistsForDate(ss, cachedLatestDate)')) {
  console.error('❌ 웹 조회는 트리거를 일 1회 자동 점검하고 캐시 응답에서도 누락 스냅샷을 복구해야 합니다.');
  process.exit(1);
}

const priceHistoryRows = [
  ['2026-08-21', '000660', 'SK하이닉스', 1730000, '', 'KRX'],
  ['2026-08-24', '000660', 'SK하이닉스', 1671000, '', 'KRX'],
];
const priceHistorySheet = {
  getLastRow: () => priceHistoryRows.length + 1,
  getLastColumn: () => 6,
  getRange: (...args) => ({
    getValues: () => args[3] === 1 ? priceHistoryRows.map(row => [row[0]]) : priceHistoryRows,
  }),
};
const priceHistorySs = {
  getSheetByName: name => name === gasContext.CONFIG.SHEET_PH ? priceHistorySheet : null,
};
const latestHynix = gasContext.getLatestPriceHistoryEntries(priceHistorySs, ['000660'], '2026-08-25');
if (!latestHynix['000660']
    || latestHynix['000660'].date !== '2026-08-24'
    || latestHynix['000660'].price !== 1671000
    || gasContext._getLatestPriceHistoryDate(priceHistorySs, '2026-08-25') !== '2026-08-24') {
  console.error('❌ 8월 21일 KRX 값보다 8월 24일 가격이력을 최신 평가단가·스냅샷 날짜로 선택해야 합니다.');
  process.exit(1);
}

if (gasContext._hasUsdPriceItems([{ code: '005930', currency: 'KRW' }])
    || !gasContext._hasUsdPriceItems([{ code: 'AAPL', currency: 'USD' }])
    || gasContext._hasUsdPriceItems([{ code: '005930' }])) {
  console.error('❌ USD 종목 유무 판정은 USD만 true이고 KRW·통화 미지정은 false여야 합니다.');
  process.exit(1);
}

if (!source.includes('googleFinanceSkipReason')
    || !source.includes('recentHistoryFallbackCount')
    || !source.includes('serverElapsedMs')
    || !source.includes("Logger.log('[price-lookup] ' + JSON.stringify(lookupMeta))")
    || !source.includes('priceLookup: lookupMeta')) {
  console.error('❌ 평가가격 응답과 GAS 로그에서 KRX/GF 생략·최근이력 보완·소요시간을 확인할 수 있어야 합니다.');
  process.exit(1);
}

if (!source.includes(".addItem('▶️ 확정 평가단가·스냅샷 지금 갱신', 'runDailyPriceSnapshotNow')")
    || !source.includes('function runDailyPriceSnapshotNow()')) {
  console.error('❌ 16:20 자동 경로를 즉시 확인할 수 있는 수동 점검 메뉴가 필요합니다.');
  process.exit(1);
}

const snapshotRepairMatch = source.match(/function\s+runSnapshotConsistencyRepair\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!snapshotRepairMatch
    || /saveDailyPriceHistory\s*\(/.test(snapshotRepairMatch[1])
    || /fetchPrices(?:Krx|GoogleFinance)\s*\(/.test(snapshotRepairMatch[1])
    || !/_getAllPriceHistoryDates\s*\(/.test(snapshotRepairMatch[1])
    || !/continueSnapshotConsistencyRepair\s*\(/.test(snapshotRepairMatch[1])
    || !source.includes('SNAPSHOT_REPAIR_BATCH_SIZE = 3')
    || !source.includes("newTrigger('continueSnapshotConsistencyRepair')")
    || !source.includes("'showSnapshotConsistencyRepairStatus'")) {
  console.error('❌ 전체 스냅샷 복구는 외부 조회 없이 전체 가격이력 날짜를 소량 배치·후속 트리거로 처리해야 합니다.');
  process.exit(1);
}
