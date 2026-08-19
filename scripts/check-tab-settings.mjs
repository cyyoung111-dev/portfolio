import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_system_tabsettings.js', 'utf8');
const panel = { scrollTop: 137 };
let savedCount = 0;
let tabBarCount = 0;
const context = {
  TAB_ORDER: [{ id: 'acct' }, { id: 'sector' }, { id: 'merge' }],
  $el(id) { return id === 'settingsPanel_tab' ? panel : null; },
  saveTabOrder() { savedCount += 1; },
  buildTabBar() { tabBarCount += 1; },
};
vm.runInNewContext(source, context, { filename: 'src/web/views/views_system_tabsettings.js' });

const order = [{ id: 'acct' }, { id: 'sector' }, { id: 'merge' }];
if (!context._moveTabOrderItem(order, 0, 1)
    || order.map(item => item.id).join(',') !== 'sector,acct,merge'
    || !context._moveTabOrderItem(order, 2, -1)
    || order.map(item => item.id).join(',') !== 'sector,merge,acct') {
  console.error('❌ 탭 화살표 이동 순서 검사가 실패했습니다.');
  process.exit(1);
}

const unchanged = order.map(item => item.id).join(',');
if (context._moveTabOrderItem(order, 0, -1)
    || context._moveTabOrderItem(order, order.length - 1, 1)
    || context._moveTabOrderItem(order, Number.NaN, 1)
    || order.map(item => item.id).join(',') !== unchanged) {
  console.error('❌ 탭 경계/잘못된 입력 보호 검사가 실패했습니다.');
  process.exit(1);
}

// 실제 moveTab 경로를 실행해, 선택적 모바일 함수가 없는 웹에서도
// 저장·상단 탭 갱신·설정 목록 재렌더가 끝까지 수행되는지 확인합니다.
vm.runInNewContext(`
  globalThis.__renderCount = 0;
  renderTabSettingsBody = function() { globalThis.__renderCount += 1; };
  globalThis.__moveResult = moveTab(0, 1);
`, context);
if (!context.__moveResult
    || context.TAB_ORDER.map(item => item.id).join(',') !== 'sector,acct,merge'
    || savedCount !== 1
    || tabBarCount !== 1
    || context.__renderCount !== 1
    || panel.scrollTop !== 137) {
  console.error('❌ 실제 탭 이동 후 저장·화면 갱신 검사가 실패했습니다.');
  process.exit(1);
}

console.log('✅ 탭 화살표 이동 및 경계 보호 검사 통과');
