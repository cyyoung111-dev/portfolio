import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src/web');

function collectJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectJs(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collectJs(webRoot).sort();
if (files.length === 0) {
  console.error('❌ No JS files found under src/web');
  process.exit(1);
}

let failed = false;
for (const file of files) {
  try {
    execFileSync('node', ['--check', file], { stdio: 'ignore' });
  } catch {
    failed = true;
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
    console.error(`❌ Syntax check failed: ${rel}`);
  }
}

if (failed) {
  process.exit(1);
}

const dividendSource = fs.readFileSync(path.join(webRoot, 'features/dividend/mgmt_div.js'), 'utf8');
if (!dividendSource.includes('await loadDividendSettings()')
    || !dividendSource.includes("String(data?.source || '').toUpperCase() === 'SEIBRO'")
    || !dividendSource.includes('_getLegacyDividendFetchItems()')
    || !dividendSource.includes("'refreshEtfDividends'")
    || !dividendSource.includes('await _refreshSeibroEtfDividends(false)')
    || !dividendSource.includes('await _refreshSeibroEtfDividends(true)')) {
  console.error('❌ 배당 탭은 GAS의 SEIBro ETF 이력을 먼저 복원하고 기존 API 덮어쓰기를 차단해야 합니다.');
  process.exit(1);
}

const dividendViewSource = fs.readFileSync(path.join(webRoot, 'views/views_div_asset.js'), 'utf8');
if (!dividendViewSource.includes('_formatDividendChartManwon(v)')
    || !dividendViewSource.includes('_sortDividendMatrixRows(divRows)')
    || !dividendViewSource.includes("renderGroup('주식', groups.stocks")
    || !dividendViewSource.includes("renderGroup('ETF', groups.etfs")
    || !dividendViewSource.includes('Number(b.annualDiv || 0) - Number(a.annualDiv || 0)')) {
  console.error('❌ 배당 그래프 만원 표기 또는 주식/ETF 그룹별 연간금액 내림차순 표시가 누락됐습니다.');
  process.exit(1);
}

const historyBenchmarkSource = fs.readFileSync(path.join(webRoot, 'views/views_history_benchmark.js'), 'utf8');
if (!historyBenchmarkSource.includes("'getBenchmarks'")
    || !historyBenchmarkSource.includes("benchmarks: types.join(',')")
    || !historyBenchmarkSource.includes('{ timeoutMs: 45000, retry: 0 }')) {
  console.error('❌ 손익 그래프 비교지수는 단일 GAS 요청으로 일괄 조회해야 합니다.');
  process.exit(1);
}

const tabSyncSource = fs.readFileSync(path.join(webRoot, 'features/settings/settings_tabsync.js'), 'utf8');
const baseCssSource = fs.readFileSync(path.join(webRoot, 'styles/base.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const themeSource = fs.readFileSync(path.join(webRoot, 'shared/theme.js'), 'utf8');
const tabSettingsSource = fs.readFileSync(path.join(webRoot, 'views/views_system_tabsettings.js'), 'utf8');
if (!dividendSource.includes("_setDividendLinkState('syncing'")
    || !dividendSource.includes('_refreshSeibroEtfDividends(true)')
    || !dividendViewSource.includes('id="dividendLinkStatus"')
    || !dividendViewSource.includes('📥 배당 데이터 갱신')
    || !dividendViewSource.includes('☁️ GAS 데이터 다시 받기')
    || !dividendViewSource.includes('화면 배당 데이터 최근 갱신')
    || !tabSyncSource.includes("tabId === 'div' ? 'GAS 데이터 다시 받기' : '재동기화'")
    || !tabSyncSource.includes('const loaded = await loadDividendSettings()')) {
  console.error('❌ 배당 갱신 시각 또는 외부 갱신/GAS 복원 상태의 역할 구분이 누락됐습니다.');
  process.exit(1);
}

if (!tabSettingsSource.includes('function _moveTabOrderItem(')
    || !tabSettingsSource.includes("body.onclick = function(event)")
    || !tabSettingsSource.includes("event.stopPropagation()")
    || !tabSettingsSource.includes("if (action === 'move') moveTab")) {
  console.error('❌ 탭 순서 화살표는 설정 패널 내부 클릭 처리와 순서 이동 헬퍼를 사용해야 합니다.');
  process.exit(1);
}

if (!indexSource.includes('id="settingsTabBtn_tab"')
    || !indexSource.includes('id="settingsTabBtn_theme"')
    || !indexSource.includes('id="settingsTabBtn_font"')
    || !indexSource.includes('id="settingsPanel_font"')
    || !indexSource.includes('id="fontSettingsBody"')
    || !themeSource.includes("const panels = ['tab', 'theme', 'font']")
    || !themeSource.includes("if (tab === 'font')")
    || /\$\{_buildFontSelectorHTML\(\)\}/.test(themeSource.slice(themeSource.indexOf('function _buildThemeSelectorHTML'), themeSource.indexOf('function _renderThemeButtons')))) {
  console.error('❌ 설정은 탭 순서·테마·글꼴의 독립된 세 패널로 표시되어야 합니다.');
  process.exit(1);
}

if (!dividendViewSource.includes('class="div-link-panel"')
    || !dividendViewSource.includes('class="div-link-actions"')
    || !dividendViewSource.includes('class="div-month-chart-scroll"')
    || !baseCssSource.includes('@media(max-width:600px)')
    || !baseCssSource.includes('.div-month-chart{min-width:620px}')
    || !baseCssSource.includes('.div-link-actions{width:100%;display:grid!important;grid-template-columns:1fr 1fr')) {
  console.error('❌ 배당 탭 모바일 버튼 배치 또는 월별 그래프 가로 스크롤 최적화가 누락됐습니다.');
  process.exit(1);
}

console.log(`✅ Syntax check passed (${files.length} files)`);
