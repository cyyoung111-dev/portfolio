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
