import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ui = read('src/web/core/core_ui.js');
const uiContext = { Date, Object };
vm.runInNewContext(`${ui}\nglobalThis.__date=formatDisplayDate;globalThis.__month=formatDisplayMonth;globalThis.__bench=formatBenchmarkLabel;`, uiContext);
assert.equal(uiContext.__date('2026-09-02'), '2026.09.02');
assert.equal(uiContext.__date('2026-02-30'), '');
assert.equal(uiContext.__date(''), '');
assert.equal(uiContext.__month('2026-01'), '2026년 1월');
assert.deepEqual(['KOSPI','SP500','DOW','NASDAQ','NASDAQ100'].map(uiContext.__bench), ['코스피','S&P 500','다우존스','나스닥','나스닥 100']);

const plan = read('src/web/views/views_plan.js');
assert.match(plan, /data-plan-tab="\$\{id\}"/);
assert.match(plan, /panel\.hidden = !active/);
assert.match(plan, /if \(area\._planClickHandler\) area\.removeEventListener/);
assert.match(plan, /history\.replaceState\(null, '', `#plan-\$\{tab\}`\)/);
const html = read('src/web/index.html');
assert.match(html, /toolbar-section-danger/);
assert.match(html, /aria-label="위험 작업"/);
assert.ok(html.indexOf('id="viewSwitcher"') > html.indexOf('toolbar-section-settings'));

const settingsFetch = read('src/web/features/settings/settings_fetch.js');
const layoutCss = read('src/web/styles/layout.css');
assert.match(settingsFetch, /setAttribute\('aria-busy', 'true'\)/);
assert.match(settingsFetch, /textContent = '업데이트 중'/);
assert.match(settingsFetch, /removeAttribute\('aria-busy'\)/);
assert.doesNotMatch(settingsFetch, /textContent = '⏳'/);
assert.match(layoutCss, /\.action-refresh-btn\[aria-busy="true"\] svg\{animation:action-refresh-spin/);

const net = read('src/web/features/settings/settings_net.js');
const editor = read('src/web/features/management/mgmt_editor.js');
const backup = read('src/web/domain/migration/backup_schema.js');
assert.match(net, /lsGet\('gsheet_access_token'/);
assert.match(editor, /if \(input\) input\.value = ''/);
assert.match(editor, /saveGsheetAccessToken\(''\)/);
assert.match(backup, /access\[_-\]\?token/);
assert.doesNotMatch(read('src/web/views/views_history.js'), /value="\$\{[^}]*[Tt]oken/);
console.log('계좌 보안·한국어 날짜/지수·투자계획 하위 탭·위험 작업 구조 검사 통과');
