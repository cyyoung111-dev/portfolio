import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/management/mgmt_editor.js', 'utf8');
assert.match(source, /function _fundNavImportOutcome\(result\)/, 'NAV 실제 저장 결과 formatter 연결');
assert.match(source, /result\?\.saveState === 'partial'/, '일부 저장 상태 표시');
assert.match(source, /error\.navImportResult = result/, 'GAS 오류 응답의 저장 결과를 catch까지 보존');
assert.match(source, /실제 저장 NAV/, 'NAV·가격이력·Snapshot 실제 저장 건수 표시');
const historySource = fs.readFileSync('src/web/views/views_history_pipeline.js', 'utf8');
const eventSource = fs.readFileSync('src/web/app/event_delegation.js', 'utf8');
const context = vm.createContext({ console, XLSX: { SSF: { parse_date_code: value => value === 46000 ? { y:2025,m:12,d:9 } : null } } });
vm.runInContext(source, context);
const clone = value => JSON.parse(JSON.stringify(value));

const parsed = clone(context._parseFundNavMatrix([
  ['상품코드','AQ018'],
  ['기준일자','기준가격(원)','수정기준가'],
  ['2025.01.02','1,000.25','9,999'],
  ['2025/01/03','1,250원','9,999'],
  [46000,1300,'9,999'],
], 'F00002'));
assert.deepEqual(parsed.rows.map(row => [row.date,row.nav]),[
  ['2025-01-02',1000.25],['2025-01-03',1250],['2025-12-09',1300]
]);
assert.equal(parsed.warnings.length,1,'20% 이상 NAV 변동은 경고만 표시');
assert.match(parsed.sourceText,/AQ018/);

const invalid = clone(context._parseFundNavMatrix([['Date','NAV'],['bad','0'],['2025-01-02','1,2x']], 'F00003'));
assert.equal(invalid.rows.length,2);
assert.equal(invalid.clientErrors.length,3);
assert.throws(()=>context._parseFundNavMatrix([['일자','수정기준가'],['2025-01-01',1000]],'F00002'),/컬럼을 찾지 못/);

const pasted = clone(context._parseFundNavPaste(`불필요한 안내 텍스트
기준일\t펀드규모(억원)\t수정기준가\t기준가\t과표기준가
26.09.10\t162\t3,135.81\t2,710.01\t998.51
26.09.09\t162\t3,086.51\t2,667.40\t998.57

26.09.08\t162\t3,104.44\t2,682.90\t998.62`, 'F00003'));
assert.deepEqual(pasted.rows.map(row=>[row.date,row.nav]),[
  ['2026-09-10',2710.01],['2026-09-09',2667.4],['2026-09-08',2682.9]
],'수정기준가·과표기준가가 아닌 정확한 기준가 열 사용');
const kofia = clone(context._parseFundNavPaste(`기준일자\t기준가격\t전일대비 등락\t과표기준가격\t설정원본\t기타 지표
2026-09-21\t2657.70\t70.18\t998.51\t100억원\t-
2026-09-18\t2587.52\t0.59\t998.57\t100억원\t-`, 'F00002'));
assert.deepEqual(kofia.rows.map(row=>[row.date,row.nav]),[['2026-09-21',2657.7],['2026-09-18',2587.52]],'금투협 표는 기준일자와 기준가격만 사용');
assert.equal(context._fundNavDate('26-01-01'),'2026-01-01');
assert.deepEqual(['2026-9-1','2026.9.1','2026/9/1','20260901','2026-09-01 12:30:00'].map(context._fundNavDate),Array(5).fill('2026-09-01'));
assert.deepEqual(['26.01.02','2026.01.03','26-01-04','2026-01-05'].map(context._fundNavDate),['2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
assert.match(source,/button\.textContent = '복사됨'/,'복사 버튼 즉시 피드백');
assert.match(source,/_fundUnitsStatus = '저장 중\.\.\.'/,'좌수 저장 진행 피드백');
assert.match(source,/좌수가 저장되었습니다/,'좌수 저장 성공 피드백');
assert.match(source,/data-fund-nav-manual="date"/,'과거 기준일 수동 NAV 입력 제공');
assert.match(source,/data-fund-nav-warning-ack/,'WARNING 확인 후 반영');
assert.match(source,/const fundItems = \[\]/,'F코드를 일반 평가금액 수동 편집에서 제외');
const recoveryStatus = context._fundRecoverySummary('2026-01-01','2026-01-31',14,31,{
  F00001:{storedNav:2,apiRequested:1,apiSuccess:10,valuations:12,snapshots:11,zeroUnitsExcluded:0,apiErrors:[{from:'2026-01-10',to:'2026-01-14',message:'timeout'}]},
  F00002:{storedNav:8,valuations:8,prices:3,pricesExisting:5,snapshots:8,navMissing:1,noUnits:2,apiErrors:[]},
  F00003:{storedNav:5,valuations:5,snapshots:5,zeroUnitsExcluded:3,apiErrors:[]},
},25,24,'2026-01-01 ~ 2026-01-14 완료');
assert.match(recoveryStatus,/14\/31 펀드·일 \(45%\)/);
assert.match(recoveryStatus,/처리 시도 14\/31/,'진행률을 성공률이 아닌 처리 시도로 표시');
assert.match(recoveryStatus,/F00001 저장 NAV 2 · API 조회 1구간 · API 성공 10건/);
assert.match(recoveryStatus,/F00003.*0좌 제외 3/);
assert.match(recoveryStatus,/F00002.*가격이력 신규 3\/기존 5.*NAV 없음 1.*좌수 없음 2/);
assert.match(source,/\['F00002','F00003','F00001'\]/,'저장 NAV 펀드를 한화 API 펀드보다 먼저 독립 처리');
assert.match(source,/\['F00001','F00002','F00003'\]\.map\(code => `<button[\s\S]*?data-fund-code="\$\{code\}"[\s\S]*?\$\{code\} 업데이트/,'펀드별 개별 업데이트 제공');
assert.match(source,/NAV 입력 필요/,'누락 NAV 날짜 안내');
assert.match(source,/code: fundCode/,'복구 요청을 F코드별로 분리');
assert.match(source,/const chunkDays = 7;/,'클라이언트 timeout 전에 날짜별 결과를 보존하도록 7일 chunk 사용');
assert.match(source,/\[처리 요약\][\s\S]*\[정상 처리\][\s\S]*\[미확정\][\s\S]*\[실패\][\s\S]*\[스냅샷\][\s\S]*\[재처리\]/,'날짜별 결과를 상태별로 구분');
assert.doesNotMatch(source,/GAS v9\.89 재배포/,'오래된 고정 버전 안내 제거');
assert.match(source,/data-fund-action="nav-date"/,'누락 날짜에서 수기 NAV 입력으로 바로 연결');
assert.match(source,/NAV 누락 현황/,'좌수 설정을 열 때 저장 자료 기반 NAV 현황 표시');
assert.match(source,/requestId !== _fundNavPasteRequestId/,'이전 붙여넣기 응답 폐기');
assert.match(source,/const requestId = \+\+_fundNavPasteRequestId/,'붙여넣기 요청별 순서 토큰 발급');
assert.match(source,/handleFundNavImportFile[\s\S]*?requestId !== _fundNavPasteRequestId/,'펀드 변경 중 이전 파일 미리보기 응답 폐기');
assert.match(source,/preserveError: true/,'펀드 API 오류 원인 보존 요청');
assert.match(source,/refreshFundValuations[\s\S]*?diagnostic: 'true'/,'누락 평가금액 복구에서만 선택적 진단 활성화');
assert.match(source,/console\.info\('\[FUND_NAV_DIAGNOSTIC\]'/,'응답 진단을 브라우저 콘솔에 구조화 표시');
assert.match(historySource,/NAV 미확정 \$\{unique\.length\}건/,'손익그래프 상단에 NAV 미확정 건수 표시');
assert.match(historySource,/직전 확정 NAV를 사용한 임시 평가/,'손익그래프 임시 평가 안내');
assert.match(eventSource,/action === 'open-fund-nav'/,'손익그래프 경고에서 좌수 설정 수기입력 연결');
assert.match(eventSource,/action === 'marker-date'/,'차트 마커에서 날짜 상세 연결');
assert.match(fs.readFileSync('src/web/views/views_history.js','utf8'),/data-history-action="marker-date"/,'오렌지·최신 마커에 날짜 상세 동작 제공');

for (const [code,classCode,standardCode,className] of [
  ['F00001','C-RPe','확인되지 않음','C-RPe'],
  ['F00002','AQ018','KR5223AQ0185','S-T'], ['F00003','AP399','KR5235AP3996','S'],
]) {
  const template = clone(context._buildFundNavTemplateRows(code));
  assert.deepEqual(template.input,[['일자','기준가격']],`${code} NAV입력 시트는 두 열만 제공`);
  const guideText = template.guide.flat().join(' ');
  assert.match(guideText,new RegExp(code)); assert.match(guideText,new RegExp(classCode));
  assert.match(guideText,new RegExp(standardCode)); assert.match(guideText,new RegExp(className));
  assert.deepEqual(clone(context._parseFundNavMatrix([...template.input,['2025-01-02',1000]],code).rows),[{rowNumber:2,date:'2025-01-02',nav:1000}]);
}

const written=[];
context.XLSX.utils={book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(book,sheet,name)=>book.sheets.push({sheet,name})};
context.XLSX.writeFile=(book,name)=>written.push({book,name}); context.showToast=()=>{};
context.downloadFundNavTemplate('F00001'); context.downloadFundNavTemplate('F00002'); context.downloadFundNavTemplate('F00003');
assert.deepEqual(written.map(item=>[item.name,...item.book.sheets.map(sheet=>sheet.name)]),[
  ['F00001_NAV_입력양식.xlsx','NAV입력','사용방법'],
  ['F00002_NAV_입력양식.xlsx','NAV입력','사용방법'],['F00003_NAV_입력양식.xlsx','NAV입력','사용방법']
]);
console.log('✅ 펀드 NAV xlsx/xls/csv 행 파싱·날짜·숫자·급변 경고 검사 통과');
