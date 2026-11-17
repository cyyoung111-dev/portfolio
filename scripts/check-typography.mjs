import assert from 'node:assert/strict';
import fs from 'node:fs';

const tokensCss = fs.readFileSync(new URL('../src/web/styles/tokens.css', import.meta.url), 'utf8');
const baseCss = fs.readFileSync(new URL('../src/web/styles/base.css', import.meta.url), 'utf8');
const componentsCss = fs.readFileSync(new URL('../src/web/styles/components.css', import.meta.url), 'utf8');
const layoutCss = fs.readFileSync(new URL('../src/web/styles/layout.css', import.meta.url), 'utf8');
const responsiveCss = fs.readFileSync(new URL('../src/web/styles/responsive.css', import.meta.url), 'utf8');
const planCss = fs.readFileSync(new URL('../src/web/styles/pages/plan.css', import.meta.url), 'utf8');
const dividendCss = fs.readFileSync(new URL('../src/web/styles/pages/dividend.css', import.meta.url), 'utf8');
const assetCss = fs.readFileSync(new URL('../src/web/styles/pages/asset.css', import.meta.url), 'utf8');
const historyCss = fs.readFileSync(new URL('../src/web/styles/pages/history.css', import.meta.url), 'utf8');
const tradeCss = fs.readFileSync(new URL('../src/web/styles/pages/trade.css', import.meta.url), 'utf8');
const css = [tokensCss, baseCss, componentsCss, layoutCss, responsiveCss, planCss, dividendCss, assetCss, historyCss, tradeCss].join('\n');
const html = fs.readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../src/web/shared/theme.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/web/features/settings/settings.js', import.meta.url), 'utf8');
const settingsFetch = fs.readFileSync(new URL('../src/web/features/settings/settings_fetch.js', import.meta.url), 'utf8');
const systemView = fs.readFileSync(new URL('../src/web/views/views_system.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../src/web/sw.js', import.meta.url), 'utf8');
const coreUi = fs.readFileSync(new URL('../src/web/core/core_ui.js', import.meta.url), 'utf8');

assert.doesNotMatch(baseCss, /(?:\.wrap|\.sc|\.tbl-wrap|\.editor-|\.btn-|@media|!important)/,
  'base.css에는 reset·기본 폼·글꼴·문서 배경만 남겨야 합니다.');
assert.match(componentsCss, /\.wrap\{max-width:1200px/,
  'base.css에서 이동한 공통 화면 컨테이너 규칙이 누락되었습니다.');
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
assert.match(historyCss, /\.hist-bench-btn\{/);
assert.match(historyCss, /#histModeDay,#histModeWeek,#histModeMonth/);
assert.doesNotMatch(baseCss, /\.hist-bench-btn\{/, 'base.css에 손익 비교지수 버튼 기본 규칙이 남아 있습니다.');
assert.doesNotMatch(baseCss, /#histModeWeek,/, 'base.css에 손익 기간 버튼 규칙이 남아 있습니다.');
assert.match(tradeCss, /\.trade-stat-card\{background/);
assert.match(tradeCss, /\.btn-trade-type\{/);
assert.doesNotMatch(baseCss, /\.trade-stat-card\{background/, 'base.css에 거래 요약 카드 기본 규칙이 남아 있습니다.');
assert.doesNotMatch(baseCss, /\.btn-trade-type\{padding/, 'base.css에 거래 유형 버튼 기본 규칙이 남아 있습니다.');
assert.match(componentsCss, /\.account-broker-select\{/);
assert.match(componentsCss, /#toast-container\{/);
assert.doesNotMatch(layoutCss, /\.account-broker-select\{/, 'layout.css에 계좌 증권사 입력 컴포넌트가 남아 있습니다.');
assert.doesNotMatch(baseCss, /#toast-container\{/, 'base.css에 토스트 컴포넌트가 남아 있습니다.');
assert.doesNotMatch(baseCss, /\.div-stat-card\{background:/, 'base.css에 배당 요약 카드 기본 선택자가 남아 있습니다.');
assert.match(layoutCss, /\.action-bar\{display:flex/);
assert.match(layoutCss, /\.view-switcher\{display:flex/);
assert.match(layoutCss, /\.toolbar-btn\{/);
assert.doesNotMatch(baseCss, /\.action-bar\{display:flex/,
  'base.css에 상단 작업 영역의 기본 레이아웃 선언이 남아 있습니다.');
assert.equal((tokensCss.match(/:root\{/g) || []).length, 4, 'tokens.css의 최상위 토큰 블록이 보존되어야 합니다.');
for (const token of ['--bg:', '--elev-1:', '--font-ui:', '--type-caption:.75rem']) {
  assert.ok(tokensCss.includes(token), `tokens.css 토큰 누락: ${token}`);
}
assert.doesNotMatch(baseCss, /:root\{[^}]*--(?:bg|elev-1|font-ui|type-caption:\.75rem)/, 'base.css에 분리 대상 토큰 블록이 남아 있습니다.');
assert.doesNotMatch(layoutCss, /@media\(/, 'layout.css에 통합 대상 반응형 규칙이 남아 있습니다.');
for (const width of ['768', '600', '480']) {
  assert.equal((responsiveCss.match(new RegExp(`@media\\(max-width:${width}px\\)`, 'g')) || []).length, 1, `${width}px 반응형 구간은 하나여야 합니다.`);
}
assert.match(layoutCss, /\.action-refresh-btn\{[^}]*flex-direction:column[^}]*width:52px[^}]*height:52px/);
assert.match(layoutCss, /\.toolbar-btn\{[^}]*width:52px[^}]*height:52px/);
assert.match(layoutCss, /#price-updated-label\.has-price-details\{[^}]*width:max-content[^}]*max-width:680px/);
assert.match(responsiveCss, /\.action-bar\{align-items:stretch;gap:6px;overflow:visible\}/);
assert.doesNotMatch(responsiveCss, /display:grid!important/,
  'old forced layout must not override unified tablet navigation');
assert.match(responsiveCss, /\.toolbar-btn-group\{position:relative;width:100%;min-width:0;margin:0;justify-content:flex-start;overflow-x:auto/);
assert.match(responsiveCss, /\.toolbar-section-settings\{order:initial;width:auto;flex:none\}/);
for (const token of ['--type-caption:.75rem','--type-label:.8125rem','--type-body:.875rem','--type-value:1rem','--line-body:1.55','--line-reading:1.65','--radius-control:8px','--radius-card:12px','--radius-panel:16px','--control-height-md:38px']) {
  assert.ok(css.includes(token), `타이포그래피 토큰 누락: ${token}`);
}
assert.match(componentsCss, /button:not\(\.editor-close\):not\(\.btn-close-icon\):not\(\.price-status-chip\)/,
  '클릭 가능한 가격 상태 칩이 모바일 일반 버튼 40px 규칙에서 제외되어야 합니다.');
assert.match(componentsCss, /\.price-status-chip\{[^}]*min-height:20px[^}]*padding:2px 7px/,
  'PC 기준 가격 상태 칩의 최소 높이·패딩을 유지해야 합니다.');
assert.match(responsiveCss, /\.price-status-chip\{flex:0 0 auto\}/,
  '모바일도 가격 상태 칩의 PC 패딩을 공유해야 합니다.');
assert.match(css, /--font-size-body:16px/);
assert.match(css, /--font-size-body-mobile:15px/);
assert.match(baseCss, /body,button,input,select,textarea\{font-family:var\(--font-ui\)\}/,
  '전체 화면과 폼 컨트롤은 사용자 선택 글꼴을 공통 상속해야 합니다.');
assert.doesNotMatch(baseCss,/font-family:'Pretendard Variable'/,
  '사용자 글꼴 선택을 무시하는 하드코딩은 제거합니다.');
assert.match(theme,/let _currentFontSize = 11;/,
  '새 기기 기본 글자 크기는 11단계로 시작해야 합니다.');
assert.match(theme,/lsGet\(FONT_SIZE_STORAGE_KEY, 11\) : 11/,
  '기존 사용자 저장값은 우선하고 저장값이 없는 경우에만 11단계를 적용해야 합니다.');
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
for (const selector of ['.sc .lbl','.sc .sub','.f-btn','.f-btn-sm','.date-badge','.action-status-label','#price-updated-label','.btn-link-blue','.chart-card h4','.legend-label','.toolbar-btn','.vs-btn-label','.trade-stat-label','.div-stat-label','.div-stat-sub','.filter-badge','.editor-group-title','.btn-sm-purple','.div-month-filter button','.div-month-selection span','.div-month-selection small','.plan-subtab','#histModeDay','#histModeWeek','#histModeMonth']) {
  const minimumUiBlock = css.slice(css.indexOf('/* === 일반 UI 최소 글자 크기 보장'));
  assert.ok(minimumUiBlock.includes(selector), `최소 글자 크기 선택자 누락: ${selector}`);
}
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.sum-row-2 \.lbl,[\s\S]*font-size:var\(--type-caption\)/);
assert.match(css, /@media\(max-width:768px\)[\s\S]*\.settings-tab \{[\s\S]*min-height:40px/);
assert.match(theme, /lsGet\(FONT_STORAGE_KEY, 'pretendard'\)/);
assert.match(settings, /APP_FONT: \(typeof lsGet === 'function'\) \? lsGet\('app_font', 'pretendard'\) : 'pretendard'/);
assert.match(settingsFetch, /function _pricePortfolioSummary\(\)/, '가격 상태 거래·보유·미조회 공통 요약 누락');
assert.match(settingsFetch, /_pricePortfolioSummary\(\) \+ restoreWarning/, '수동 업데이트 공통 요약 연결 누락');
assert.match(settingsFetch, /_priceStatusLayout\(primary, portfolioMsg \+ diagMsg, note, lookupMsg\)/, '자동 업데이트 공통 요약과 독립 조회카드 연결 누락');
assert.match(settingsFetch, /_priceStatusLayout\(primary, meta, note, lookupMsg\)/, '수동 업데이트 독립 조회카드 연결 누락');
assert.match(componentsCss, /\.price-lookup-summary\{[\s\S]*?width:100%;[\s\S]*?max-width:100%/,'상세 정보 카드가 작은 화면 밖으로 넘치지 않아야 합니다.');
assert.match(componentsCss, /\.price-lookup-source-chips\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
 '조회 상세 2열 정보는 모바일에서 잘리지 않아야 합니다.');
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


// Single theme-aware design layer: all visual roles share control dimensions,
// focused keyboard access and phone layouts without changing financial logic.
const unifiedCss=fs.readFileSync(new URL('../src/web/styles/ui-unified.css',import.meta.url),'utf8');
for(const [name,pattern] of [
  ['shared edge token',/--ui-edge:\s*color-mix\(in srgb,var\(--border\)/],
  ['theme-selected token',/--ui-selected-bg:\s*color-mix\(in srgb,var\(--amber\)/],
  ['header primary button',/\.action-bar \.action-refresh-btn/],
  ['header utilities',/\.toolbar-section \.toolbar-btn/],
  ['selected top navigation',/#viewSwitcher \.vs-btn\.active/],
  ['portfolio table filters',/#view-area\[data-active-view\] :is\([\s\S]*?\.f-btn,.f-btn-sm/],
  ['history benchmark controls',/\.hist-bench-btn/],
  ['settings tabs',/\.settings-tabs \.settings-tab\.is-active/],
  ['trading buy and sell retained',/#te-tradetype-buy\.active[\s\S]*?#te-tradetype-sell\.active/],
  ['view cards',/\.hist-kpi-card,.hist-extreme-card,.hist-benchmark-card/],
  ['disabled action state',/button:disabled:not\(\[aria-busy="true"\]\)/],
  ['visible keyboard focus',/:focus-visible\s*\{/],
  ['tablet layout',/@media\(max-width:768px\)/],
  ['phone layout',/@media\(max-width:480px\)/],
  ['very narrow zoom layout',/@media\(max-width:300px\)/],
  ['variable card corner',/border-radius:var\(--radius-card\)/],
  ['variable button corner',/border-radius:var\(--radius-control\)/],
  ['density-size typography',/font-size:var\(--type-caption\)/],
]) {
  assert.match(unifiedCss,pattern,'통합 디자인 회귀: '+name);
}
assert.doesNotMatch(unifiedCss,/!important/,'통합 디자인은 강제 중요도로 기존 컴포넌트를 무효화하면 안 됩니다.');
assert.doesNotMatch(unifiedCss,/\b(?:fetch|localStorage|setItem|GAS|getPrices)\s*\(/,
  '디자인 레이어는 데이터 조회/저장을 수행할 수 없습니다.');

assert.match(unifiedCss, /@media\(max-width:768px\)\s*\{\s*\.action-bar\s*\{[\s\S]*?display:grid;/,
  'tablet action bar must stack instead of horizontal-clipping the whole header');
assert.match(unifiedCss, /\.action-bar \.toolbar-btn-group\s*\{[\s\S]*?overflow-x:auto;/,
  'only toolbar utilities scroll within the tablet row');
assert.match(unifiedCss, /html\[data-theme-mode="light"\] :is\(\.hist-month-input,\.hist-detail-date-input\)\s*\{\s*color-scheme:light;/,
  'light theme history month/date picker must not force dark chrome');
assert.match(unifiedCss, /html\[data-theme-mode="dark"\] :is\(\.hist-month-input,\.hist-detail-date-input\)\s*\{\s*color-scheme:dark;/,
  'dark theme history picker must remain dark');
assert.match(unifiedCss, /html\[data-theme-mode="light"\] input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{[\s\S]*?filter:none;/,
  'light theme calendar icon must not be inverted');
assert.match(unifiedCss, /\.action-bar #price-updated-label\s*\{\s*font-size:var\(--type-caption\);/,
  'mobile status label must honor user-defined font size');

assert.match(componentsCss, /\.price-lookup-summary-title\{[^}]*font-size:var\(--type-caption\)/,
 '조회 상세 제목은 업데이트 상태 글자 크기를 따라야 합니다.');
assert.match(componentsCss, /\.price-lookup-summary \.price-status-chip\{[^}]*min-height:26px;[^}]*font-size:var\(--type-caption\)/,
 '조회 정보의 컴팩트한 칩 높이와 글자 크기를 보장합니다.');
assert.match(componentsCss, /\.price-status-meta \.price-status-chip\{[^}]*min-height:24px/,
 '거래·보유 상태 칩이 과도하게 커지지 않아야 합니다.');
assert.match(unifiedCss, /\.action-bar \.action-update-card > #price-updated-label\.has-price-details\s*\{[^}]*width:100%;[^}]*max-width:none;/,
 '조회 완료 상태 영역은 모바일 폭 전체를 채워야 합니다.');
assert.match(unifiedCss, /\.action-bar \.price-status-content\s*\{[^}]*display:grid;/,
 '상태 제목과 조회 상세는 한 줄 격자로 표시합니다.');
assert.match(unifiedCss, /\.action-bar \.price-status-content > \.price-lookup-summary\[open\]\s*\{[^}]*grid-column:1\/-1;/,
 '펼친 조회 상세는 화면 가로 전체를 사용합니다.');
// Final typography owner: value/title/body/caption should share the same user size tokens.
assert.match(unifiedCss,/\.wrap > \.hdr h1\s*\{[^}]*font-size:calc\(var\(--type-title\) \+ 4px\)/,
 '브랜드 제목의 크기가 독립 rem 값을 사용하면 안 됩니다.');
assert.match(unifiedCss,/\.wrap \.sum-row \.sc \.val\s*\{[^}]*font-size:calc\(var\(--type-value\) \+ 3px\)/,
 '요약 KPI 숫자를 기존 과대형 1.4rem으로 되돌리면 안 됩니다.');
assert.match(unifiedCss,/\.wrap \.sum-row \.sc \.lbl\s*\{[^}]*font-size:var\(--type-caption\)/,
 '요약 라벨은 공통 caption 크기를 사용합니다.');
assert.match(unifiedCss,/#view-area\[data-active-view\] :is\(\.hist-kpi-number,\.hist-extreme-primary,\.hist-mdd-value\)/,
 '손익 핵심 값은 공통 숫자 크기 정책을 따라야 합니다.');
assert.match(unifiedCss,/#view-area\[data-active-view\] :is\(\.div-stat-value,\.trade-stat-value,\.metric-value\)/,
 '배당·거래·공통 지표의 숫자 크기가 일치해야 합니다.');
assert.match(unifiedCss,/@media\(max-width:768px\)\s*\{\s*\.wrap > \.hdr h1\s*\{font-size:calc\(var\(--type-title\) \+ 2px\)\}/,
 '모바일 브랜드 제목은 데스크톱보다 작아야 합니다.');
assert.doesNotMatch(unifiedCss,/font-size:\s*3[0-9]px;/,
 '일괄 타이포그래피가 30px 이상의 거대 숫자를 새로 만들면 안 됩니다.');
assert.match(unifiedCss, /#view-area\[data-active-view\],[\s\S]*?\.tbl-wrap\s*\{[^}]*max-width:100%;[^}]*min-width:0;/,
  '계좌·종목 표 영역은 모바일 가로뷰를 밀어내면 안 됩니다.');
assert.match(unifiedCss, /\.action-bar \.price-status-primary,[\s\S]*?\.price-status-note\s*\{[^}]*overflow-wrap:anywhere;/,
  '긴 현재가 상태 문구는 잘리지 않고 줄바꿈되어야 합니다.');
assert.match(unifiedCss, /\.acct-filter-track \.acct-filter-btn:focus-visible\s*\{[^}]*outline:/,
  '계좌 탭은 키보드 접근 시 포커스 표시가 유지되어야 합니다.');
const compactPhoneCss=unifiedCss.slice(unifiedCss.indexOf('@media(max-width:480px)'));
assert.match(compactPhoneCss, /\.action-bar \.action-update-card>\.action-refresh-btn\s*\{[\s\S]*?height:36px;[\s\S]*?min-height:36px;/,
 '모바일 업데이트·현재가 버튼 높이를 36px로 통일해야 합니다.');
assert.match(compactPhoneCss, /\.action-bar \.action-update-card>\.action-refresh-btn svg\s*\{[^}]*width:14px;/,
 '큰 버튼용 아이콘 대신 작은 모바일 아이콘을 사용해야 합니다.');
assert.match(compactPhoneCss, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
 '모바일 업데이트·현재가는 동일한 두 열을 유지합니다.');
assert.doesNotMatch(compactPhoneCss,/height:46px;/,'기존 큰 버튼 높이로 회귀하면 안 됩니다.');
assert.match(unifiedCss, /\.acct-filter-track\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(var\(--acct-filter-count\),minmax\(30px,1fr\)\)/,
  '모바일 계좌 필터는 줄바꿈 없이 1행으로 표시해야 합니다.');
assert.match(unifiedCss, /\.acct-filter-track \.acct-filter-btn\.is-multiline\s*\{[^}]*flex-direction:column;/,
  '미래에셋 계좌를 2/3행으로 표시해야 합니다.');
assert.match(unifiedCss, /\.acct-order-list\s*\{[^}]*display:grid;/,
  '계좌 순서 편집 UI를 유지합니다.');
assert.match(unifiedCss, /\.acct-filter-controls\s*\{[^}]*margin-bottom:16px;/,
  '필터와 종목표 사이 간격을 16px로 유지합니다.');
assert.match(unifiedCss, /\.acct-type-filter-group\s*\{[^}]*margin-top:14px;/,
  '계좌 및 종류 필터 그룹 간격은 14px입니다.');
assert.match(unifiedCss, /\.acct-filter-track \.acct-filter-btn,[\s\S]*?font-weight:500;/,
  '일반 계좌 글자 굵기는 500입니다.');
assert.match(unifiedCss, /\.acct-filter-track \.acct-filter-btn:is\(\.active,\[aria-pressed="true"\]\),[\s\S]*?font-weight:600;/,
  '선택한 계좌 글자 굵기는 600입니다.');
const acctView = fs.readFileSync('src/web/views/views_portfolio.js','utf8');
assert.match(acctView, /data-value="\$\{_escapeHtml\(a\)\}"/,
  '계좌 원본 식별자를 변경하면 안 됩니다.');
assert.match(acctView, /acct-filter-type/,
  'ISA·IRP·연금 계좌 유형의 별도 행을 유지합니다.');
assert.match(acctView, /broker === '미래에셋'/,
  '미래에셋 증권사 이름을 미래/에셋 두 줄로 분리합니다.');
assert.match(acctView, /ACCT_FILTER_DISPLAY_ORDER_KEY = 'pf_ui_acct_filter_order_v1'/,
  '금융 계좌 원장 순서와 별도의 표시 순서 저장 키를 유지합니다.');
assert.doesNotMatch(acctView, /saveAcctOrder\(/,
  'UI 정렬 변경이 금융 계좌 원장 순서를 덮어쓰지 않아야 합니다.');
const events = fs.readFileSync('src/web/app/event_delegation.js','utf8');
for (const cmd of ['acct-order-toggle','acct-order-up','acct-order-down','acct-order-reset'])
  assert.ok(events.includes("action === '" + cmd + "'"), '계좌 순서 버튼 이벤트 누락: '+cmd);


// 2026-11-17 visible icon system contract: styling only, not financial state.
const historyRender = fs.readFileSync('src/web/views/views_history_render.js','utf8');
const historyState = fs.readFileSync('src/web/views/views_history_state.js','utf8');
for (const id of ['s-total','s-cost','s-pnl','s-net','loan-summary-bal','s-realestate']) {
  const position=html.indexOf('id="'+id+'"');
  assert(position>0,'KPI numeric element remains: '+id);
}
const summaryArea=html.slice(html.indexOf('<!-- SUMMARY -->'),html.indexOf('<!-- ACTION BAR -->'));
assert.equal((summaryArea.match(/class="ui-label-icon"/g)||[]).length,6,
  'six summary cards must use the same line SVG icon system');
assert.doesNotMatch(summaryArea,/💰|📥|📈|💎|🏦|🏠/,
  'mixed emoji/icon glyphs must not return in the KPI labels');
assert.match(html, /class="ui-brand-icon"/,'brand should use the common vector language');
assert.match(unifiedCss, /\.wrap \.ui-label-icon\s*\{[^}]*width:15px;height:15px;/,
  'summary SVGs should use one size and stroke');
assert.match(unifiedCss, /\.wrap \.sum-row \.sc::before\s*\{[^}]*height:1px;background:var\(--ui-edge\)/,
  'summary top borders should be visually neutral; money colors remain on values');
assert.match(historyRender,/class="hist-view-header"/);
assert.match(historyRender,/class="hist-view-title"/);
assert.match(historyRender,/class="hist-benchmark-options"/);
assert.match(historyRender,/id="btn-history-query"/);
assert.match(historyRender,/id="btn-history-full-repair"/);
assert.doesNotMatch(historyRender,/📈 손익 그래프|📅 특정일 손익/,
  'history headings must not mix emoji with SVG icons');
assert.match(historyState,/setAttribute\?\.\('aria-pressed', String\(selected\)\)/,
  'day/week/month mode must expose a selected state for keyboard users');
assert.doesNotMatch(historyState, /active\.style\.background = 'var\(--c-purple-45/,
  'profit chart mode must not use a distinct purple active system');
assert.match(unifiedCss, /\.hist-benchmark-options\s*\{[^}]*display:flex;/,
  'benchmark chips should be sized by shared CSS, not inline HTML');
assert.match(unifiedCss, /@media\(max-width:720px\)[\s\S]*?\.hist-controls\s*\{[\s\S]*?display:grid;/,
  'narrow history toolbar should use the shared responsive grid');
assert.ok(!historyRender.includes('id="histBenchmarkMulti" title='),
  'benchmark options must use the shared style class');

// Intrinsic SVG dimensions are mandatory even if the PWA serves old CSS.
const iconTags = [...(html + historyRender).matchAll(/<svg class="(?:ui-brand-icon|ui-label-icon|hist-query-icon)"[^>]*>/g)].map(m=>m[0]);
assert.equal(iconTags.length,9,'all relevant icon instances must be covered');
for (const tag of iconTags) {
  const w = Number(tag.match(/\bwidth="(\d+)"/)?.[1]);
  const h = Number(tag.match(/\bheight="(\d+)"/)?.[1]);
  assert.ok(w>=14 && w<=18 && w===h,'icon must not default to the containing card width: '+tag);
}
assert.match(unifiedCss,/width:15px;height:15px;max-width:15px;max-height:15px/);
assert.match(unifiedCss,/width:18px;height:18px;max-width:18px;max-height:18px/);
assert.match(unifiedCss,/width:17px;height:17px;max-width:17px;max-height:17px/);
