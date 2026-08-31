import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/web/styles/base.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../src/web/shared/theme.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/web/features/settings/settings.js', import.meta.url), 'utf8');
const systemView = fs.readFileSync(new URL('../src/web/views/views_system.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../src/web/sw.js', import.meta.url), 'utf8');
const coreUi = fs.readFileSync(new URL('../src/web/core/core_ui.js', import.meta.url), 'utf8');

for (const token of ['--type-caption:.75rem','--type-label:.8125rem','--type-body:.875rem','--type-value:1rem','--line-body:1.55','--line-reading:1.65','--radius-control:8px','--radius-card:12px','--radius-panel:16px','--control-height-md:38px']) {
  assert.ok(css.includes(token), `타이포그래피 토큰 누락: ${token}`);
}
assert.match(css, /--font-size-body:16px/);
assert.match(css, /--font-size-body-mobile:15px/);
assert.match(css, /\[data-view-section="plan"\][\s\S]+font-size:var\(--type-caption\)!important/);
assert.match(css, /\[style\*="font-size:\.60rem"\][\s\S]+font-size:var\(--type-caption\)!important/);
assert.match(css, /\[style\*="font-size:\.69rem"\][\s\S]+font-size:var\(--type-caption\)!important/);
assert.match(css, /#view-area\[data-active-view\] table th\{font-size:var\(--type-caption\)/);
assert.match(css, /#view-area\[data-active-view\] table td\{font-size:var\(--type-body\)/);
assert.match(css, /#view-area\[data-active-view\] input,[\s\S]+min-height:36px/);
assert.match(css, /\.div-monthly-matrix th,[\s\S]+font-size:var\(--type-caption\)/);
assert.match(css, /\.retirement-cashflow-table th\{font-size:var\(--type-caption\)/);
assert.match(css, /\.retirement-cashflow-table td\{font-size:\.8rem/);
assert.match(css, /--font-ui:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif/);
assert.match(css, /table,button,input,select,textarea\{font-family:inherit\}/);
for (const selector of ['.sc .lbl','.sc .sub','.f-btn','.f-btn-sm','.date-badge','.action-status-label','#price-updated-label','.btn-link-blue','.chart-card h4','.legend-label','.toolbar-btn','.vs-btn-label','.trade-stat-label','.div-stat-label','.div-stat-sub','.filter-badge','.editor-group-title']) {
  const minimumUiBlock = css.slice(css.indexOf('/* === 일반 UI 최소 글자 크기 보장'));
  assert.ok(minimumUiBlock.includes(selector), `최소 글자 크기 선택자 누락: ${selector}`);
}
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.sum-row-2 \.lbl,[\s\S]*font-size:var\(--type-caption\)/);
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.settings-tab \{[\s\S]*min-height:40px/);
assert.match(theme, /lsGet\(FONT_STORAGE_KEY, 'pretendard'\)/);
assert.match(settings, /APP_FONT: 'pretendard'/);
assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
assert.doesNotMatch(html, /Noto\+Sans|Gothic\+A1|IBM\+Plex|Nanum\+Gothic/);
const coreUiIndex = html.indexOf('<script defer src="core/core_ui.js"></script>');
const themeIndex = html.indexOf('<script defer src="shared/theme.js?');
assert.ok(coreUiIndex >= 0 && themeIndex >= 0 && coreUiIndex < themeIndex, 'core_ui.js는 theme.js보다 먼저 로드해야 함');
assert.match(coreUi, /function _escapeHtml\s*\(/, '_escapeHtml 정의 누락');
assert.match(theme, /loadTheme\(\);\s*loadFont\(\);/, '테마·글꼴 초기화 호출 누락');
const fontPresetBlock = theme.match(/const FONT_PRESETS = \{([\s\S]*?)\n\};/)?.[1] || '';
assert.equal((fontPresetBlock.match(/^[ ]{2}[a-z0-9_]+:/gm) || []).length, 1, '단일 글꼴 preset만 허용');
const assetVersion = html.match(/styles\/base\.css\?v=([0-9-]+)/)?.[1];
assert.ok(assetVersion, 'CSS 캐시 버전 누락');
assert.match(serviceWorker, new RegExp(`portfolio-cache-${assetVersion}`));
assert.ok(serviceWorker.includes(`./styles/base.css?v=${assetVersion}`), '서비스워커 CSS precache 버전 불일치');
assert.ok(serviceWorker.includes(`./shared/theme.js?v=${assetVersion}`), '서비스워커 theme.js precache 버전 불일치');
assert.ok(html.includes(`sw.js?v=${assetVersion}`), '서비스워커 등록 버전 불일치');
assert.doesNotMatch(css, /--font-size-body:1[0-4]px/);
assert.match(systemView, /area\.dataset\.activeView = currentView/);
for (const tabId of ['acct','sector','merge','trades','tradegroup','history','div','asset','plan']) {
  assert.match(systemView, new RegExp(`id:'${tabId}'`), `기본 탭 누락: ${tabId}`);
  assert.match(systemView, new RegExp(`currentView === '${tabId}'`), `렌더 경로 누락: ${tabId}`);
}
for (const fixedView of ['stocks','gsheet']) assert.match(systemView, new RegExp(`currentView === '${fixedView}'`), `관리 화면 렌더 경로 누락: ${fixedView}`);

console.log('전역 글꼴 fallback·본문 크기·투자계획·은퇴표 시인성 검사 통과');
