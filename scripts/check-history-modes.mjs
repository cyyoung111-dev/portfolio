import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_history_utils.js', 'utf8');
const viewSource = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipelineSource = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const stateSource = fs.readFileSync('src/web/views/views_history_state.js', 'utf8');
const eventSource = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');
const gasSource = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const layoutSource = fs.readFileSync('src/web/styles/layout.css', 'utf8');
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

const gapSamples = [
  { date: '2026-01-02' },
  { date: '2026-01-30' },
  { date: '2026-03-02' },
];
const weeklyCoverage = context.analyzeCoverage(gapSamples, 'week');
const monthlyCoverage = context.analyzeCoverage(gapSamples, 'month');
assert.ok(weeklyCoverage.missing.length > 0 && weeklyCoverage.missing.every(item => item.targetDate), '주간 누락 날짜를 실제 샘플에서 찾아야 합니다.');
assert.ok(monthlyCoverage.missing.some(item => item.key === '2026-02-01'), '월간 샘플에서 2월 누락을 찾아야 합니다.');

assert.match(viewSource, /metric\('매입원가'/, '가장 높은 날·가장 낮은 날 카드에는 매입원가가 있어야 합니다.');
assert.match(viewSource, /metric\('수익률'/, '가장 높은 날·가장 낮은 날 카드에는 수익률이 있어야 합니다.');
assert.match(viewSource, /\(item\.evalAmt - costAmt\) \/ costAmt \* 100/, '요약 카드 수익률은 평가금액과 매입원가로 계산해야 합니다.');
assert.match(viewSource, /SP500:\s*\{ color: '#f97316', dash: '7 4' \}/, 'S&P500은 전용 주황색과 점선을 사용해야 합니다.');
assert.match(viewSource, /stroke-dasharray/, 'S&P500 점선은 그래프와 범례에 반영되어야 합니다.');
assert.ok(!/SP500:\s*\{[^}]*#22c55e/.test(viewSource), 'S&P500은 나의 손익 녹색을 재사용하면 안 됩니다.');
assert.match(viewSource, /NASDAQ:\s*\{ color: '#22d3ee'/, 'NASDAQ은 나의 손익 녹색과 구별되는 cyan을 사용해야 합니다.');
assert.ok(!/NASDAQ:\s*\{[^}]*#(?:22c55e|2dd4bf)/i.test(viewSource), 'NASDAQ은 손익선과 비슷한 green/teal 색상을 재사용하면 안 됩니다.');

assert.match(pipelineSource, /선택 기간의 스냅샷 누락이 없습니다/, '누락 없음 안내를 표시해야 합니다.');
assert.match(pipelineSource, /누락 검사는 주간·월간 조회에서 수행합니다/, '일별 조회의 누락 검사 범위를 안내해야 합니다.');
assert.match(pipelineSource, /data-history-action="repair-gaps"/, '누락 보완 버튼이 있어야 합니다.');
assert.match(pipelineSource, /requestGsheetFormJson\('repairSnapshots'/, '프런트엔드가 GAS 복구 action을 호출해야 합니다.');
assert.match(pipelineSource, /날짜별 진행 상태/, '날짜별 복구 진행 상태를 표시해야 합니다.');
assert.match(pipelineSource, /성공 \$\{repairResult\.repaired\}개 · 실패/, '복구 성공 개수와 실패 내역을 표시해야 합니다.');
assert.match(pipelineSource, /await loadHistoryChart\(\)/, '복구 후 손익 데이터를 다시 조회해야 합니다.');
assert.match(gasSource, /params\.action === 'repairSnapshots'[\s\S]*handleRepairSnapshots\(params\.data\)/, 'GAS POST route가 handleRepairSnapshots에 연결되어야 합니다.');
assert.match(eventSource, /closest\('\[data-history-action\]'\)[\s\S]*action === 'query'[\s\S]*loadHistoryChart\(\)/, '동적 재렌더링 뒤에도 위임된 조회 이벤트가 작동해야 합니다.');
assert.match(pipelineSource, /step: 1, total: 2, message: '스냅샷 조회 중\.\.\.'/);
assert.match(pipelineSource, /step: 2,[\s\S]*total: 2,[\s\S]*비교지수/);
assert.match(pipelineSource, /queryBtn\.disabled = true[\s\S]*finally[\s\S]*queryBtn\.disabled = false[\s\S]*label\.textContent = '조회'/, '조회 성공·오류 후 버튼을 복원해야 합니다.');
assert.match(stateSource, /\$\{step\}\/\$\{total\}/, '조회 단계 번호를 화면에 표시해야 합니다.');
assert.match(layoutSource, /\.action-bar\{[^}]*overflow-y:hidden/, '업데이트 결과 영역에는 세로 스크롤바가 생기면 안 됩니다.');
assert.match(layoutSource, /\.action-update-card\{[^}]*min-height:60px;[^}]*height:auto/, '업데이트 결과가 여러 줄이면 카드 높이가 내용에 맞게 늘어나야 합니다.');

console.log('✅ 손익 그래프 주기·누락 복구·요약 카드·비교지수·조회 회귀 검사 통과');
