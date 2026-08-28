import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/web/styles/base.css', import.meta.url), 'utf8');
const theme = fs.readFileSync(new URL('../src/web/shared/theme.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/web/features/settings/settings.js', import.meta.url), 'utf8');
const systemView = fs.readFileSync(new URL('../src/web/views/views_system.js', import.meta.url), 'utf8');

for (const token of ['--type-caption:.75rem','--type-label:.78rem','--type-body:.875rem','--type-value:.95rem','--line-reading:1.65']) {
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
assert.match(theme, /lsGet\(FONT_STORAGE_KEY, 'noto_sans_kr'\)/);
assert.match(theme, /'Pretendard Variable',Pretendard,'Noto Sans KR'/);
assert.match(settings, /lsGet\('app_font', 'noto_sans_kr'\)/);
assert.doesNotMatch(css, /--font-size-body:1[0-4]px/);
assert.match(systemView, /area\.dataset\.activeView = currentView/);
for (const tabId of ['acct','sector','merge','trades','tradegroup','history','div','asset','plan']) {
  assert.match(systemView, new RegExp(`id:'${tabId}'`), `기본 탭 누락: ${tabId}`);
  assert.match(systemView, new RegExp(`currentView === '${tabId}'`), `렌더 경로 누락: ${tabId}`);
}
for (const fixedView of ['stocks','gsheet']) assert.match(systemView, new RegExp(`currentView === '${fixedView}'`), `관리 화면 렌더 경로 누락: ${fixedView}`);

console.log('전역 글꼴 fallback·본문 크기·투자계획·은퇴표 시인성 검사 통과');
