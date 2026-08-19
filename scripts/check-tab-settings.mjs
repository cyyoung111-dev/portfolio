import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_system_tabsettings.js', 'utf8');
const context = {};
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

console.log('✅ 탭 화살표 이동 및 경계 보호 검사 통과');
