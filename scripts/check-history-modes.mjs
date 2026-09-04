import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_history_utils.js', 'utf8');
const context = {
  fmtDateDot: value => String(value || ''),
  _kstTodayStr: () => '2026-09-04',
};
vm.runInNewContext(`${source}\n` +
  'globalThis.selectSnapshots = _selectHistorySnapshots; globalThis.analyzeCoverage = _analyzeHistoryCoverage;', context);

const snapshots = [
  { date: '2026-01-02', id: '금요일' },
  { date: '2026-01-05', id: '월요일' },
  { date: '2026-01-09', id: '다음 금요일' },
  { date: '2026-01-30', id: '1월 말' },
  { date: '2026-02-02', id: '2월 초' },
  { date: '2026-02-27', id: '2월 말' },
];

assert.deepEqual(
  Array.from(context.selectSnapshots(snapshots, 'day'), item => item.id),
  snapshots.map(item => item.id),
  '일별 조회는 저장된 모든 스냅샷을 유지해야 합니다.',
);
assert.deepEqual(
  Array.from(context.selectSnapshots(snapshots, 'week'), item => item.id),
  ['금요일', '다음 금요일', '1월 말', '2월 초', '2월 말'],
  '주간 조회는 월요일 시작 주마다 마지막 스냅샷을 선택해야 합니다.',
);
assert.deepEqual(
  Array.from(context.selectSnapshots(snapshots, 'month'), item => item.id),
  ['1월 말', '2월 말'],
  '월간 조회는 월마다 마지막 스냅샷을 선택해야 합니다.',
);
assert.deepEqual(
  Array.from(context.selectSnapshots(snapshots, 'invalid'), item => item.id),
  Array.from(context.selectSnapshots(snapshots, 'week'), item => item.id),
  '알 수 없는 모드는 화면 기본값과 같은 주간 조회로 처리해야 합니다.',
);
assert.notEqual(context.selectSnapshots(snapshots, 'day'), snapshots, '일별 결과도 원본 배열을 직접 반환하면 안 됩니다.');

console.log('✅ 손익 그래프 일별·주간·월간 스냅샷 선택 검사 통과');
