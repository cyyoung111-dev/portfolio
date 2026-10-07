import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_history_utils.js', 'utf8');
const viewSource = fs.readFileSync('src/web/views/views_history.js', 'utf8');
const pipelineSource = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const stateSource = fs.readFileSync('src/web/views/views_history_state.js', 'utf8');
const renderSource = fs.readFileSync('src/web/views/views_history_render.js', 'utf8');
const systemSource = fs.readFileSync('src/web/views/views_system.js', 'utf8');
const eventSource = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');
const gasSource = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const layoutSource = fs.readFileSync('src/web/styles/layout.css', 'utf8');
const context = {
  fmtDateDot: value => String(value || ''),
  _kstTodayStr: () => '2026-09-04',
};
const signatureSource = pipelineSource.match(/function _historySnapshotSignature[\s\S]*?\n}/)?.[0] || '';
const signatureContext = {};
const cachedSource = pipelineSource.match(/function _cachedHistoryDiagnostics[\s\S]*?\n}/)?.[0] || '';
const revisionDecisionSource = pipelineSource.match(/function _historyIntegrityRevisionDecision[\s\S]*?\n}/)?.[0] || '';
vm.runInNewContext(`${signatureSource}\n${cachedSource}\n${revisionDecisionSource}\nglobalThis.signature = _historySnapshotSignature;globalThis.cached = _cachedHistoryDiagnostics;globalThis.revisionDecision = _historyIntegrityRevisionDecision;`, signatureContext);
assert.equal(signatureContext.revisionDecision('A','A',0),'apply','동일 revision 진단은 적용');
assert.equal(signatureContext.revisionDecision('A','B',0),'retry','첫 revision mismatch는 최신 history 재조회');
assert.equal(signatureContext.revisionDecision('A','B',1),'discard','재시도 mismatch는 폐기해 무한 retry 방지');
const signatureSnapshot = { date: '2026-09-30', costAmt: 100, evalAmt: 120, pnl: 20 };
assert.equal(signatureContext.signature(signatureSnapshot, 'date-rev-1'), signatureContext.signature(signatureSnapshot, 'date-rev-1'), '날짜 revision이 같으면 cache signature를 재사용해야 합니다.');
assert.notEqual(signatureContext.signature(signatureSnapshot, 'date-rev-1'), signatureContext.signature(signatureSnapshot, 'date-rev-2'), '영향받은 날짜 revision이 바뀌면 Snapshot 합계가 같아도 cache를 무효화해야 합니다.');
assert.match(pipelineSource, /integrityDateRevisions\[snapshot\.date\]/, '전역 revision 대신 날짜별 revision으로 cache key를 구성해야 합니다.');
const cacheSnapshots=[{date:'2026-09-27',costAmt:100,evalAmt:120,pnl:20},{date:'2026-09-28',costAmt:100,evalAmt:90,pnl:-10}];
const cacheRevisions={'2026-09-27':'7','2026-09-28':'8'};
const cacheFixture={};
const migratedRevision=String(1760000000000);
const migratedCache={};
migratedCache[signatureContext.signature(cacheSnapshots[0],migratedRevision)]={date:'2026-09-27',status:'VALID'};
assert.equal(signatureContext.cached([cacheSnapshots[0]],{'2026-09-27':migratedRevision},migratedCache)[0].status,'VALID','정수 migration revision은 웹 cache lookup에 사용 가능');
cacheFixture[signatureContext.signature(cacheSnapshots[0],'7')]={date:'2026-09-27',status:'MISMATCH'};
cacheFixture[signatureContext.signature(cacheSnapshots[1],'8')]={date:'2026-09-28',status:'PRICE_SUSPICIOUS'};
assert.deepEqual(Array.from(signatureContext.cached(cacheSnapshots,cacheRevisions,cacheFixture),item=>item.status),['MISMATCH','PRICE_SUSPICIOUS'],'cached blocking 상태를 최초 렌더 전에 복원');
assert.equal(signatureContext.cached(cacheSnapshots,{...cacheRevisions,'2026-09-27':'changed'},cacheFixture).some(item=>item.date==='2026-09-27'),false,'revision mismatch cache는 무시');
assert.equal(signatureContext.cached(cacheSnapshots,{},cacheFixture).length,0,'누락된 revision state는 legacy cache보다 재진단을 우선');
cacheFixture[signatureContext.signature(cacheSnapshots[1],'8')]={date:'2026-09-28',status:'VALID'};
assert.equal(signatureContext.cached(cacheSnapshots,cacheRevisions,cacheFixture).find(item=>item.date==='2026-09-28').status,'VALID','cached VALID은 정상 사용');
assert(pipelineSource.indexOf('_cachedHistoryDiagnostics(snapshots') < pipelineSource.indexOf('_drawHistoryChart(chartWrap, initialSnapshots'),'cache merge가 최초 그래프 렌더보다 먼저 실행되어야 함');
assert(pipelineSource.indexOf("revisionDecision === 'discard'") < pipelineSource.indexOf('integrityDiagnostics = integrityDiagnostics.concat'),'revision mismatch 진단은 화면 상태 병합 전에 폐기');
assert.match(pipelineSource,/revisionDecision === 'retry'\) return await loadHistoryChart\(retryAttempt \+ 1\)/,'revision mismatch 재조회는 1회 bounded retry');
assert.match(pipelineSource,/error\?\.errorCode === 'REVISION_CHANGED'\) throw error/,'재시도 mismatch를 일반 진단 실패로 흡수하면 안 됨');
assert.match(pipelineSource,/if \(retryAttempt \|\| e\?\.errorCode === 'REVISION_CHANGED'\) _restoreOrClearDiscardedHistoryView/,'재조회 실패는 공통 정상 화면 복원·폐기 처리를 사용');
assert.match(pipelineSource,/if \(retryAttempt && _restoreOrClearDiscardedHistoryView[\s\S]*empty_data[\s\S]*if \(retryAttempt && _restoreOrClearDiscardedHistoryView[\s\S]*empty_range/,'재시도 empty_data와 empty_range는 stale 화면 정리 후 종료');
const discardSource = pipelineSource.match(/function _restoreOrClearDiscardedHistoryView[\s\S]*?\n}/)?.[0] || '';
const discardContext = vm.createContext({});
vm.runInContext(`let restored=false;const __histState={loadRequestId:2,snapshots:[1],integrityDiagnostics:[1],rangeDiagnosisFailed:{},missingSnapshotDates:[1]};const _restoreSuccessfulHistoryView=()=>restored;${discardSource};globalThis.runDiscard=(id,restore)=>{restored=restore;const chart={innerHTML:'chart'},table={innerHTML:'table'},coverage={innerHTML:'coverage'};const result=_restoreOrClearDiscardedHistoryView(id,chart,table,coverage);return {result,chart:chart.innerHTML,table:table.innerHTML,coverage:coverage.innerHTML,state:JSON.parse(JSON.stringify(__histState))};};`,discardContext);
const discarded=discardContext.runDiscard(2,false);
assert.deepEqual(JSON.parse(JSON.stringify(discarded)),{result:false,chart:'',table:'',coverage:'',state:{loadRequestId:2,snapshots:[],integrityDiagnostics:[],rangeDiagnosisFailed:null,missingSnapshotDates:[]}},'재시도 빈 결과에 정상 화면이 없으면 stale DOM·상태 제거');
const restoredView=discardContext.runDiscard(2,true);
assert.deepEqual([restoredView.result,restoredView.chart,restoredView.table,restoredView.coverage],[true,'chart','table','coverage'],'이전 정상 화면 복원 성공 시 현재 DOM을 제거하지 않음');
const staleRequest=discardContext.runDiscard(1,false);
assert.deepEqual([staleRequest.result,staleRequest.chart,staleRequest.table,staleRequest.coverage],[null,'chart','table','coverage'],'오래된 requestId는 최신 화면·상태를 변경하지 않음');
const cacheContext = vm.createContext({ sessionStorage: (() => {
  const values = new Map([['portfolio.historyIntegrity.v1', JSON.stringify({legacy:{date:'2026-01-01',status:'VALID',expectedRows:Array(100).fill('large')}})]]);
  return { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key), values };
})() });
const cacheHelpers = ['_isRepairableHistoryDiagnostic','_historyDiagnosticSummary','_readHistoryIntegrityCache','_writeHistoryIntegrityCache']
  .map(name => pipelineSource.match(new RegExp(`function ${name}[\\s\\S]*?\\n}`))?.[0] || '').join('\n');
vm.runInContext(`const HISTORY_INTEGRITY_CACHE_KEY='portfolio.historyIntegrity.v4';const HISTORY_INTEGRITY_LEGACY_CACHE_KEYS=['portfolio.historyIntegrity.v1','portfolio.historyIntegrity.v2','portfolio.historyIntegrity.v3'];const HISTORY_INTEGRITY_CACHE_MAX_CHARS=120000;${cacheHelpers};globalThis.readCache=_readHistoryIntegrityCache;globalThis.writeCache=_writeHistoryIntegrityCache;globalThis.summary=_historyDiagnosticSummary;globalThis.repairable=_isRepairableHistoryDiagnostic;`,cacheContext);
const fullDiagnostic={date:'2026-09-30',status:'MISMATCH',expectedRows:[1],storedRows:[2],itemComparisons:[3],priceIntegrity:[4],sourceDataErrors:[],conflictKeys:[],duplicateSummary:{groups:4,exactDuplicate:1,singleExpectedMatch:1,manualProtected:1,unresolvedConflict:1,sourceIncomplete:0}};
assert.deepEqual(JSON.parse(JSON.stringify(cacheContext.summary(fullDiagnostic))),{date:'2026-09-30',status:'MISMATCH',repairable:true,duplicateSummary:{groups:4,exactDuplicate:1,singleExpectedMatch:1,manualProtected:1,unresolvedConflict:1,sourceIncomplete:0}},'full diagnostic은 중복 분류를 포함한 최소 cache summary로 축약');
assert.equal(cacheContext.repairable(cacheContext.summary(fullDiagnostic)),true,'cached summary와 full diagnostic의 repairability가 동일');
assert.equal(cacheContext.writeCache({key:fullDiagnostic}),true,'summary cache 정상 저장');
const storedCache=cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v4');
assert(!/expectedRows|storedRows|itemComparisons|priceIntegrity/.test(storedCache),'대용량 진단 상세는 sessionStorage에 저장 금지');
assert.equal(cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v1'),null,'legacy v1 cache는 read/write 전에 제거');
assert.equal(cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v2'),null,'legacy v2 cache는 알고리즘 변경 후 제거');
assert.equal(cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v3'),null,'duplicateSummary 없는 legacy v3 cache는 제거');
cacheContext.sessionStorage.setItem('portfolio.historyIntegrity.v4',JSON.stringify({legacyFull:fullDiagnostic}));
assert.deepEqual(JSON.parse(JSON.stringify(cacheContext.readCache().legacyFull)),{date:'2026-09-30',status:'MISMATCH',repairable:true,duplicateSummary:{groups:4,exactDuplicate:1,singleExpectedMatch:1,manualProtected:1,unresolvedConflict:1,sourceIncomplete:0}},'기존 상세 cache read는 중복 분류 포함 summary로 sanitize');
assert(!/expectedRows|storedRows|itemComparisons|priceIntegrity/.test(cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v4')),'sanitize한 기존 cache를 작은 schema로 즉시 재저장');
const oversized={};for(let i=0;i<900;i++)oversized[`${i}`.padStart(4,'0')+'x'.repeat(180)]={date:`2026-01-${String(i%28+1).padStart(2,'0')}`,status:'VALID'};
assert.equal(cacheContext.writeCache(oversized),true,'크기 상한 초과 cache도 오래된 entry 제거 후 저장');
assert(cacheContext.sessionStorage.getItem('portfolio.historyIntegrity.v4').length<=120000,'직렬화 cache는 보수적 내부 상한 유지');
cacheContext.sessionStorage.setItem=()=>{throw new Error('quota')};
assert.equal(cacheContext.writeCache({key:fullDiagnostic}),false,'sessionStorage write 실패는 화면 조회를 실패시키지 않음');
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
const dailyCoverage = context.analyzeCoverage([
  { date: '2026-08-28' },
  { date: '2026-09-01' },
], 'day');
assert.ok(weeklyCoverage.missing.length > 0 && weeklyCoverage.missing.every(item => item.targetDate), '주간 누락 날짜를 실제 샘플에서 찾아야 합니다.');
assert.ok(monthlyCoverage.missing.some(item => item.key === '2026-02-01'), '월간 샘플에서 2월 누락을 찾아야 합니다.');
assert.deepEqual(
  Array.from(dailyCoverage.missing, item => item.targetDate),
  ['2026-08-31', '2026-09-02', '2026-09-03'],
  '일별 누락은 오늘과 주말을 제외한 확정 평일 날짜를 찾아야 합니다.',
);

assert.match(viewSource, /metric\('매입원가'/, '가장 높은 날·가장 낮은 날 카드에는 매입원가가 있어야 합니다.');
assert.match(viewSource, /metric\('수익률'/, '가장 높은 날·가장 낮은 날 카드에는 수익률이 있어야 합니다.');
assert.match(viewSource, /\(item\.evalAmt - costAmt\) \/ costAmt \* 100/, '요약 카드 수익률은 평가금액과 매입원가로 계산해야 합니다.');
assert.match(viewSource, /수익률 MDD/, '나의 MDD는 평가금액 최고·최저와 구분되는 수익률 지표임을 표시해야 합니다.');
assert.match(viewSource, /현금흐름 보정 수익률 고점·저점과 다를 수 있습니다/, '평가금액 최고일과 MDD 고점일이 다를 수 있음을 안내해야 합니다.');
assert.match(gasSource, /var latestEntries = getLatestPriceHistoryEntries\(ss, missingCodes, dateStr, throwOnError\)[\s\S]*var nearestFuturePrices = getEarliestPriceHistory\(ss, stillMissingCodes, dateStr, throwOnError\)/, '가격 누락 시 출처·기준일을 포함한 직전값을 우선하고 최초 구간만 가장 가까운 이후값으로 보완해야 합니다.');
assert.match(gasSource, /function getEarliestPriceHistory\(ss, codes, minDate, throwOnError\)/, '최초 가격 이전 스냅샷을 위한 이후 최근접 가격 조회 함수가 있어야 합니다.');
assert.match(viewSource, /SP500:\s*\{ color: '#f97316', dash: '7 4' \}/, 'S&P500은 전용 주황색과 점선을 사용해야 합니다.');
assert.match(viewSource, /stroke-dasharray/, 'S&P500 점선은 그래프와 범례에 반영되어야 합니다.');
assert.ok(!/SP500:\s*\{[^}]*#22c55e/.test(viewSource), 'S&P500은 나의 손익 녹색을 재사용하면 안 됩니다.');
assert.match(viewSource, /NASDAQ:\s*\{ color: '#22d3ee'/, 'NASDAQ은 나의 손익 녹색과 구별되는 cyan을 사용해야 합니다.');
assert.ok(!/NASDAQ:\s*\{[^}]*#(?:22c55e|2dd4bf)/i.test(viewSource), 'NASDAQ은 손익선과 비슷한 green/teal 색상을 재사용하면 안 됩니다.');
assert.match(viewSource, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*PARTIAL[^\n]*MISMATCH[^\n]*CONFLICT[^\n]*NO_SNAPSHOT/, '확인된 Snapshot 오류 상태만 손익 계산을 차단해야 합니다.');
assert.match(viewSource, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*PRICE_SUSPICIOUS/, '가격 원자료 이상 후보는 정상 성과 계산을 차단해야 합니다.');
assert.doesNotMatch(viewSource, /HISTORY_BLOCKING_INTEGRITY_STATUSES[^\n]*SOURCE_INCOMPLETE/, 'SOURCE_INCOMPLETE는 저장 Snapshot 손익을 차단하면 안 됩니다.');
assert.match(pipelineSource, /const summary = Object\.entries\(counts\)/, '정합성 경고는 상태별 건수로 요약해야 합니다.');
assert.doesNotMatch(pipelineSource, /invalid\.map\(item => labels\[item\.status\]/, '동일 경고 문자열을 날짜 수만큼 생성하면 안 됩니다.');
assert.match(pipelineSource, /_historySnapshotSignature[\s\S]*datesToDiagnose/, 'Snapshot 서명이 같은 날짜는 증분 진단 캐시를 재사용해야 합니다.');
assert.match(pipelineSource, /integritySourceRevision === String\(integrity\.integritySourceRevision/, '진단 중 원자료 revision이 바뀐 응답은 cache에 저장하면 안 됩니다.');

assert.match(pipelineSource, /선택 기간의 스냅샷 누락이 없습니다/, '누락 없음 안내를 표시해야 합니다.');
assert.match(pipelineSource, /mode === 'day' \? '일별'/, '일별 누락 안내를 표시해야 합니다.');
assert.match(pipelineSource, /평일 후보\(휴장일이 포함될 수 있음\)/, '일별 후보에 휴장일 포함 가능성을 안내해야 합니다.');
assert.match(pipelineSource, /data-history-action="repair-gaps"/, '누락 보완 버튼이 있어야 합니다.');
assert.match(pipelineSource, /requestGsheetFormJson\('repairSnapshots'/, '프런트엔드가 GAS 복구 action을 호출해야 합니다.');
assert.match(pipelineSource, /requestGsheetFormJson\('startSnapshotRepair'/, '손익 그래프에서 전체 스냅샷 재작성을 시작할 수 있어야 합니다.');
assert.match(pipelineSource, /이미 진행 중인 GAS 전체 재작성 작업의 상태를 이어서 확인합니다/, '진행 중 재요청은 실패가 아니라 기존 작업 상태 확인으로 안내해야 합니다.');
assert.match(pipelineSource, /기존 수동 입력·누락된 종목·외화 기록을 보존/, '재작성 확인창은 데이터 보존 방식을 명시해야 합니다.');
assert.match(pipelineSource, /로컬 데이터만 바꾸는 기능이 아니며/, '전체 재작성이 로컬 전용 작업으로 오해되지 않게 안내해야 합니다.');
assert.match(pipelineSource, /requestGsheetFormJson\('continueSnapshotRepair'/, '화면이 열린 동안 다음 전체 재작성 배치를 직접 요청해야 합니다.');
assert.match(pipelineSource, /화면 연결 중 연속 처리/, '화면 연결 여부에 따른 재작성 속도 차이를 안내해야 합니다.');
assert.match(gasSource, /params\.action === 'startSnapshotRepair'[\s\S]*handleStartSnapshotRepair\(\)/, 'GAS POST route가 전체 재작성 시작 API에 연결되어야 합니다.');
assert.match(pipelineSource, /날짜별 진행 상태/, '날짜별 복구 진행 상태를 표시해야 합니다.');
assert.match(pipelineSource, /성공 \$\{repairResult\.repaired\}개 · 실패/, '복구 성공 개수와 실패 내역을 표시해야 합니다.');
assert.match(pipelineSource, /await loadHistoryChart\(\)/, '복구 후 손익 데이터를 다시 조회해야 합니다.');
assert.match(gasSource, /params\.action === 'repairSnapshots'[\s\S]*handleRepairSnapshots\(params\.data\)/, 'GAS POST route가 handleRepairSnapshots에 연결되어야 합니다.');
assert.match(eventSource, /closest\('\[data-history-action\]'\)[\s\S]*action === 'query'[\s\S]*loadHistoryChart\(\)/, '동적 재렌더링 뒤에도 위임된 조회 이벤트가 작동해야 합니다.');
assert.match(pipelineSource, /step: 1, total: 2, message: '스냅샷 조회 중\.\.\.'/);
assert.match(pipelineSource, /step: 2,[\s\S]*total: 2,[\s\S]*비교지수/);
assert.match(pipelineSource, /queryBtn\.disabled = true[\s\S]*finally[\s\S]*queryBtn\.disabled = false[\s\S]*label\.textContent = '조회'/, '조회 성공·오류 후 버튼을 복원해야 합니다.');
assert.match(stateSource, /\$\{step\}\/\$\{total\}/, '조회 단계 번호를 화면에 표시해야 합니다.');
assert.match(stateSource, /function _captureSuccessfulHistoryView\(\)/, '마지막 정상 손익 화면을 보존해야 합니다.');
assert.match(stateSource, /function _restoreSuccessfulHistoryView\(\)/, '손익 탭 재렌더 시 마지막 정상 화면을 복원해야 합니다.');
assert.match(renderSource, /if \(!_restoreSuccessfulHistoryView\(\)\) _setHistoryStatus/, '보존 화면이 없을 때만 초기 조회 안내를 표시해야 합니다.');
assert.match(systemSource, /currentView === 'history' && area\.dataset\.renderedView === 'history'/, '백그라운드 공통 갱신이 현재 손익 화면을 재렌더하면 안 됩니다.');
assert.doesNotMatch(pipelineSource, /_setHistoryStatus\(statusEl, 'loading',[\s\S]{0,300}chartWrap\.innerHTML = ''/, '재조회 시작 시 마지막 정상 그래프를 먼저 지우면 안 됩니다.');
assert.match(pipelineSource, /if \(requestId !== __histState\.loadRequestId\) return;[\s\S]*_captureSuccessfulHistoryView\(\)/, '최신 스냅샷·비교지수 응답만 정상 화면으로 확정해야 합니다.');
assert.match(layoutSource, /\.action-bar\{[^}]*overflow-y:hidden/, '업데이트 결과 영역에는 세로 스크롤바가 생기면 안 됩니다.');
assert.match(layoutSource, /\.action-update-card\{[^}]*min-height:60px;[^}]*height:auto/, '업데이트 결과가 여러 줄이면 카드 높이가 내용에 맞게 늘어나야 합니다.');

console.log('✅ 손익 그래프 주기·누락 복구·요약 카드·비교지수·조회 회귀 검사 통과');

// Dense integrity markers must not paint full-height dashed lines for dozens of invalid dates.
assert.match(viewSource, /const denseIntegrityMarkers = invalidPointCount > 24/);
assert.match(viewSource, /if \(denseIntegrityMarkers\)[\s\S]*PAD\.top \+ 8/);
assert.match(pipelineSource, /충돌 분류 · MANUAL 보호/);
