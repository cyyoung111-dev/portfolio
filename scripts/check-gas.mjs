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

if (!source.includes("props.setProperty('snapshot_last_success_date', prevDay)")
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
    || !/fetchPricesKrx\(items,\s*prevDay\)/.test(dailySnapshotMatch[1])
    || !/fetchPricesGoogleFinance\(gfPrevItems,\s*prevDay,\s*ss\)/.test(dailySnapshotMatch[1])
    || !/items\.length\s*>\s*0\s*&&\s*prevRows\.length\s*===\s*0/.test(dailySnapshotMatch[1])
    || !/deleteProperty\('snapshot_last_failure_at'\)/.test(dailySnapshotMatch[1])) {
  console.error('❌ 일일 스냅샷은 확정 거래일 가격을 한 번만 조회하고 과거 전체 검증과 분리해야 합니다.');
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
