import fs from 'node:fs';
import vm from 'node:vm';

const editorSource = fs.readFileSync('src/web/features/management/mgmt_editor.js', 'utf8');
const dividendSource = fs.readFileSync('src/web/features/dividend/mgmt_div.js', 'utf8');
const historySource = fs.readFileSync('src/web/views/views_history_benchmark.js', 'utf8');
for (const contract of [
  /requestGsheetActionJson\(\s*'getPriceHistory'/,
  /requestGsheetActionJson\(\s*'saveManualPrice'/,
  /requestGsheetFormJson\(\s*'batchSaveManualPrices'/,
]) {
  if (!contract.test(editorSource)) throw new Error(`현재가 편집 GAS 인증 공통 경로 누락: ${contract}`);
}
if (/fetch\(GSHEET_API_URL/.test(editorSource) || /GSHEET_API_URL\s*\+\s*['"]\?action=(?:getPriceHistory|saveManualPrice)/.test(editorSource)) {
  throw new Error('현재가 편집에서 접근 토큰을 우회하는 GAS 직접 요청이 남아 있습니다.');
}
if (/console\.warn\(['"]\[batchSaveManualPrices\]/.test(editorSource)) {
  throw new Error('현재가 배치 fallback 전환을 최종 저장 오류처럼 경고하면 안 됩니다.');
}
if (!/console\.warn\(`\[_syncManualPricesToGsheet\] GAS 저장 최종 실패/.test(editorSource)) {
  throw new Error('현재가 건별 fallback 최종 실패 경고가 누락됐습니다.');
}
if (!/requestGsheetActionJson\(\s*action,\s*params,/.test(dividendSource)) {
  throw new Error('배당 외부소스 조회의 GAS 인증 공통 경로가 누락됐습니다.');
}
if (/buildGsheetActionUrl\(action, params\)[\s\S]{0,300}fetchWithTimeout/.test(dividendSource)) {
  throw new Error('배당 외부소스 조회에 접근 토큰을 우회하는 직접 요청이 남아 있습니다.');
}
if (!/return requestGsheetActionJson\(action, params, options\)/.test(historySource)) {
  throw new Error('손익 그래프 GAS 인증 공통 경로가 누락됐습니다.');
}
if (/_historyBuildUrl|fetchWithTimeout\(/.test(historySource)) {
  throw new Error('손익 그래프에서 접근 토큰을 우회하는 직접 요청이 남아 있습니다.');
}

const colorMap = {
  'var(--green)': '#10b981',
  'var(--blue)': '#0057ff',
  'var(--purple)': '#8b5cf6',
  'var(--amber)': '#f59e0b',
  'var(--red)': '#e52e2e',
  'var(--pink)': '#ec4899',
  'var(--cyan)': '#06b6d4',
  'var(--gold2)': '#f97316',
  'var(--purple-lt)': '#a78bfa',
};
const resolveColor = color => colorMap[color] || color;

const stateSource = fs.readFileSync('src/web/domain/state/data_state.js', 'utf8');
const accountContext = {
  ACCT_COLORS_KEY: 'test_acct_colors',
  ACCT_ORDER: ['전체'],
  resolveColor,
  lsSave() {},
  saveAcctOrder() {},
};
vm.runInNewContext(`${stateSource}\n` +
  `globalThis.__assign = getOrAssignColor; globalThis.__colors = ACCT_COLORS;`, accountContext);
['계좌A', '계좌B', '계좌C'].forEach(accountContext.__assign);
const assigned = Object.values(accountContext.__colors);
if (new Set(assigned.map(color => color.toLowerCase())).size !== assigned.length) {
  throw new Error(`신규 계좌 색상이 중복 배정됐습니다: ${assigned.join(', ')}`);
}

const sectorSource = fs.readFileSync('src/web/features/master/sector/mgmt_sector.js', 'utf8');
let savedSectors = null;
const sectorContext = {
  ACCT_PALETTE: Object.keys(colorMap),
  EDITABLE_PRICES: [
    { name: 'A', sector: '반도체/IT' },
    { name: 'B', sector: '금융' },
    { name: 'C', sector: '반도체/IT' },
    { name: 'D', sector: '' },
  ],
  SECTOR_COLORS: {},
  SECTOR_COLORS_KEY: 'test_sector_colors',
  resolveColor,
  lsSave(_key, value) { savedSectors = { ...value }; },
};
vm.runInNewContext(`${sectorSource}\n` +
  `globalThis.__ensure = _ensureSectorColors;`, sectorContext);
if (!sectorContext.__ensure()) throw new Error('누락된 섹터 색상을 보정하지 못했습니다.');
const expectedSectors = ['반도체/IT', '금융', '기타'];
if (!expectedSectors.every(name => sectorContext.SECTOR_COLORS[name])) {
  throw new Error(`섹터 관리 목록이 불완전합니다: ${Object.keys(sectorContext.SECTOR_COLORS).join(', ')}`);
}
if (!savedSectors || Object.keys(savedSectors).length !== expectedSectors.length) {
  throw new Error('자동 보정한 섹터 색상이 저장되지 않았습니다.');
}

console.log('✅ 계좌 고유 색상 배정 및 누락 섹터 관리 목록 복원 검사 통과');
