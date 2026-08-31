import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(`../src/web/${relative}`, import.meta.url), 'utf8');
const saved = new Map([
  ['app_theme', JSON.stringify('light')],
  ['app_theme_mode', JSON.stringify('light')],
  ['app_font', JSON.stringify('noto_sans_kr')],
  ['app_density', JSON.stringify('compact')],
  ['app_font_size', JSON.stringify(9)],
]);
const cssVars = new Map();
const elements = new Map();
const listeners = new Map();
const makeElement = id => ({
  id,
  innerHTML: '',
  style: {},
  classList: { toggle() {} },
  closest() { return null; },
});
for (const id of ['themeSettingsBody', 'fontSettingsBody']) elements.set(id, makeElement(id));

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  },
  document: {
    documentElement: {
      style: { setProperty: (key, value) => cssVars.set(key, value) },
      dataset: {},
    },
    getElementById: id => elements.get(id) || null,
    addEventListener: (type, callback) => listeners.set(type, callback),
    createElement: () => makeElement('generated'),
  },
  window: {},
});

for (const file of ['core/core_storage.js', 'core/core_ui.js', 'shared/theme.js']) {
  vm.runInContext(read(file), context, { filename: file });
}

assert.equal(context.document.documentElement.dataset.themeMode, 'light', '저장된 테마 모드 복원 실패');
assert.equal(context.document.documentElement.dataset.appFont, 'pretendard', '기존 글꼴 설정의 Pretendard 정규화 실패');
assert.equal(context.document.documentElement.dataset.uiDensity, 'compact', '저장된 화면 밀도 복원 실패');
assert.equal(context.document.documentElement.dataset.uiFontSize, '9', '저장된 글자 크기 복원 실패');
assert.equal(cssVars.get('--bg'), '#f5f7fb', '저장된 light 테마 변수 적용 실패');
assert.match(cssVars.get('--font-ui'), /Pretendard Variable/, 'Pretendard Variable 적용 실패');

vm.runInContext("renderThemeSelector('themeSettingsBody'); renderFontSelector('fontSettingsBody');", context);
assert.match(elements.get('themeSettingsBody').innerHTML, /data-theme-action="apply"/, '테마 탭 렌더링 실패');
assert.match(elements.get('fontSettingsBody').innerHTML, /Pretendard Variable/, '글꼴 탭 렌더링 실패');
assert.match(elements.get('fontSettingsBody').innerHTML, /시스템 기본 글꼴/, '시스템 기본 글꼴 선택 렌더링 실패');
assert.match(elements.get('fontSettingsBody').innerHTML, /data-theme-action="density"/, '화면 밀도 선택 렌더링 실패');
assert.match(elements.get('fontSettingsBody').innerHTML, /data-theme-action="font-size"/, '글자 크기 선택 렌더링 실패');
vm.runInContext("applyFont('system');", context);
assert.equal(context.document.documentElement.dataset.appFont, 'system', '시스템 기본 글꼴 적용 실패');
assert.match(cssVars.get('--font-ui'), /system-ui/, '시스템 기본 글꼴 family 적용 실패');
assert.equal(JSON.parse(saved.get('app_font')), 'system', '시스템 기본 글꼴 저장 실패');
vm.runInContext("applyFontSize(8);", context);
assert.equal(context.document.documentElement.dataset.uiFontSize, '8', '8px 글자 크기 적용 실패');
assert.equal(JSON.parse(saved.get('app_font_size')), 8, '글자 크기 저장 실패');
vm.runInContext("applyFontSize(20);", context);
assert.equal(context.document.documentElement.dataset.uiFontSize, '12', '범위 밖 글자 크기 기본값 처리 실패');
vm.runInContext("applyDensity('default');", context);
assert.equal(JSON.parse(saved.get('app_density')), 'default', '변경한 화면 밀도 저장 실패');
vm.runInContext("applyTheme('ocean');", context);
assert.equal(JSON.parse(saved.get('app_theme')), 'ocean', '변경한 테마 저장 실패');
vm.runInContext('loadTheme();', context);
assert.equal(context.document.documentElement.dataset.themeMode, 'dark', '새로고침 상당 테마 재복원 실패');
assert.equal(cssVars.get('--bg'), '#080d18', '재복원한 ocean 테마 변수 적용 실패');
assert.doesNotThrow(() => listeners.get('DOMContentLoaded')?.(), 'DOMContentLoaded 테마 초기화 실패');

console.log('✅ 최초 테마·글꼴 복원 및 설정 탭 런타임 검사 통과');
