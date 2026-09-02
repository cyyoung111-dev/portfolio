import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseCss = fs.readFileSync(new URL('../src/web/styles/base.css', import.meta.url), 'utf8');
const layoutCss = fs.readFileSync(new URL('../src/web/styles/layout.css', import.meta.url), 'utf8');
const planCss = fs.readFileSync(new URL('../src/web/styles/pages/plan.css', import.meta.url), 'utf8');
const dividendCss = fs.readFileSync(new URL('../src/web/styles/pages/dividend.css', import.meta.url), 'utf8');
const assetCss = fs.readFileSync(new URL('../src/web/styles/pages/asset.css', import.meta.url), 'utf8');
const css = [baseCss, layoutCss, planCss, dividendCss, assetCss].join('\n');
const html = fs.readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../src/web/shared/theme.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/web/features/settings/settings.js', import.meta.url), 'utf8');
const settingsFetch = fs.readFileSync(new URL('../src/web/features/settings/settings_fetch.js', import.meta.url), 'utf8');
const systemView = fs.readFileSync(new URL('../src/web/views/views_system.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../src/web/sw.js', import.meta.url), 'utf8');
const coreUi = fs.readFileSync(new URL('../src/web/core/core_ui.js', import.meta.url), 'utf8');

assert.doesNotMatch(baseCss, /(?:\.plan-|\.retire-|\.retirement-|\[data-view-section="plan"\])/, 'base.css에 투자계획 전용 선택자가 남아 있습니다.');
assert.match(planCss, /\.plan-export-grid/);
assert.match(planCss, /\.retirement-cashflow-table/);
assert.match(dividendCss, /\.div-monthly-matrix/);
assert.match(dividendCss, /\.div-stat-card/);
assert.doesNotMatch(baseCss, /\.div-monthly-matrix\{/, 'base.css에 배당 월별 표 기본 선택자가 남아 있습니다.');
assert.match(assetCss, /\.asset-summary-grid/);
assert.match(assetCss, /#realEstateEditor \.editor-row/);
assert.doesNotMatch(baseCss, /\.asset-summary-grid\{/, 'base.css에 부동산 요약 그리드가 남아 있습니다.');
assert.doesNotMatch(baseCss, /#realEstateEditor \.editor-row/, 'base.css에 부동산 편집기 반응형 규칙이 남아 있습니다.');
assert.doesNotMatch(baseCss, /\.div-stat-card\{background:/, 'base.css에 배당 요약 카드 기본 선택자가 남아 있습니다.');
assert.match(layoutCss, /\.action-bar\{display:flex/);
assert.match(layoutCss, /\.view-switcher\{display:flex/);
assert.match(layoutCss, /\.toolbar-btn\{/);
assert.doesNotMatch(baseCss, /\.action-bar\{display:flex/,
  'base.css에 상단 작업 영역의 기본 레이아웃 선언이 남아 있습니다.');
for (const token of ['--type-caption:.75rem','--type-label:.8125rem','--type-body:.875rem','--type-value:1rem','--line-body:1.55','--line-reading:1.65','--radius-control:8px','--radius-card:12px','--radius-panel:16px','--control-height-md:38px']) {
  assert.ok(css.includes(token), `타이포그래피 토큰 누락: ${token}`);
}
assert.match(css, /--font-size-body:16px/);
assert.match(css, /--font-size-body-mobile:15px/);
for (const size of [8, 9, 10, 11, 12]) {
  assert.match(css, new RegExp(`html\\[data-ui-font-size="${size}"\\]\\{--type-caption:${size}px`), `${size}px 사용자 글자 크기 토큰 누락`);
}
assert.match(css, /html\[data-ui-font-size="8"\][^\n]+--control-height-sm:22px[^\n]+--ui-card-padding:8px/, '8단계 데스크톱 UI 크기 토큰 누락');
assert.match(css, /@media\(max-width:768px\)[\s\S]+html\[data-ui-font-size="8"\]\{--control-height-sm:32px/, '8단계 모바일 터치 높이 절충 누락');
assert.match(css, /html\[data-ui-font-size\] \.sc,[\s\S]+padding:var\(--ui-card-padding\)/, 'UI 크기 카드 패딩 연결 누락');
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
for (const selector of ['.sc .lbl','.sc .sub','.f-btn','.f-btn-sm','.date-badge','.action-status-label','#price-updated-label','.btn-link-blue','.chart-card h4','.legend-label','.toolbar-btn','.vs-btn-label','.trade-stat-label','.div-stat-label','.div-stat-sub','.filter-badge','.editor-group-title','.btn-sm-purple','.div-month-filter button','.div-month-selection span','.div-month-selection small','.plan-subtab','#histModeWeek','#histModeMonth']) {
  const minimumUiBlock = css.slice(css.indexOf('/* === 일반 UI 최소 글자 크기 보장'));
  assert.ok(minimumUiBlock.includes(selector), `최소 글자 크기 선택자 누락: ${selector}`);
}
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.sum-row-2 \.lbl,[\s\S]*font-size:var\(--type-caption\)/);
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.settings-tab \{[\s\S]*min-height:40px/);
assert.match(theme, /lsGet\(FONT_STORAGE_KEY, 'pretendard'\)/);
assert.match(settings, /APP_FONT: \(typeof lsGet === 'function'\) \? lsGet\('app_font', 'pretendard'\) : 'pretendard'/);
assert.match(settingsFetch, /function _pricePortfolioSummary\(\)/, '가격 상태 거래·보유·미조회 공통 요약 누락');
assert.match(settingsFetch, /_pricePortfolioSummary\(\) \+ restoreWarning/, '수동 업데이트 공통 요약 연결 누락');
assert.match(settingsFetch, /portfolioMsg \+ diagMsg \+ lookupMsg/, '자동 업데이트 공통 요약 연결 누락');
assert.doesNotMatch(settingsFetch, /gsheetMissingHint/, '자동 업데이트 전용 미조회 표시가 남아 있습니다.');
assert.doesNotMatch(settingsFetch, /restoreSummary/, '제거된 수동 업데이트 상태 변수가 남아 있습니다.');
assert.match(settingsFetch, /function _isCurrentPriceTarget\(item\)/, '현재가 보유수량 대상 판정 누락');
assert.match(settingsFetch, /if \(!\(Number\(holding\?\.qty\) > 0\)\) return false/, '수량 0 종목 조회 제외 누락');
assert.match(settingsFetch, /getEPWithCode\(\)\.filter\(_isCurrentPriceTarget\)/, '현재가 조회 대상을 현재 보유 종목으로 제한하지 않았습니다.');
assert.match(settingsFetch, /if \(!_isCurrentPriceTarget\(m\)\) return false/, '미조회 집계에서 수량 0 종목 제외 누락');
assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
assert.doesNotMatch(html, /Noto\+Sans|Gothic\+A1|IBM\+Plex|Nanum\+Gothic/);
const coreUiIndex = html.indexOf('<script defer src="core/core_ui.js?');
const themeIndex = html.indexOf('<script defer src="shared/theme.js?');
assert.ok(coreUiIndex >= 0 && themeIndex >= 0 && coreUiIndex < themeIndex, 'core_ui.js는 theme.js보다 먼저 로드해야 함');
assert.match(coreUi, /function _escapeHtml\s*\(/, '_escapeHtml 정의 누락');
assert.match(theme, /loadTheme\(\);\s*loadFont\(\);/, '테마·글꼴 초기화 호출 누락');
const fontPresetBlock = theme.match(/const FONT_PRESETS = \{([\s\S]*?)\n\};/)?.[1] || '';
assert.equal((fontPresetBlock.match(/^[ ]{2}[a-z0-9_]+:/gm) || []).length, 2, 'Pretendard와 시스템 기본 글꼴만 허용');
assert.match(fontPresetBlock, /^  system:/m, '시스템 기본 글꼴 preset 누락');
assert.match(fontPresetBlock, /^  pretendard:/m, 'Pretendard preset 누락');
const assetVersion = html.match(/styles\/base\.css\?v=([0-9-]+)/)?.[1];
assert.ok(assetVersion, 'CSS 캐시 버전 누락');
assert.ok(serviceWorker.includes(`./styles/base.css?v=${assetVersion}`), '서비스워커 CSS precache 버전 불일치');
const themeVersion = html.match(/shared\/theme\.js\?v=([0-9-]+)/)?.[1];
assert.ok(themeVersion && serviceWorker.includes(`./shared/theme.js?v=${themeVersion}`), '서비스워커 theme.js precache 버전 불일치');
const serviceWorkerVersion = html.match(/sw\.js\?v=([0-9-]+)/)?.[1];
assert.ok(serviceWorkerVersion, '서비스워커 등록 버전 누락');
assert.match(serviceWorker, new RegExp(`portfolio-cache-${serviceWorkerVersion}`));
assert.doesNotMatch(css, /--font-size-body:1[0-4]px/);
assert.match(systemView, /area\.dataset\.activeView = currentView/);
for (const tabId of ['acct','sector','merge','trades','tradegroup','history','div','asset','plan']) {
  assert.match(systemView, new RegExp(`id:'${tabId}'`), `기본 탭 누락: ${tabId}`);
  assert.match(systemView, new RegExp(`currentView === '${tabId}'`), `렌더 경로 누락: ${tabId}`);
}
for (const fixedView of ['stocks','gsheet']) assert.match(systemView, new RegExp(`currentView === '${fixedView}'`), `관리 화면 렌더 경로 누락: ${fixedView}`);

console.log('전역 글꼴 fallback·본문 크기·투자계획·은퇴표 시인성 검사 통과');
