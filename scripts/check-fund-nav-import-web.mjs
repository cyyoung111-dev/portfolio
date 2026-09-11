import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/management/mgmt_editor.js', 'utf8');
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
assert.equal(context._fundNavDate('26-01-01'),'2026-01-01');
assert.deepEqual(['2026-9-1','2026.9.1','2026/9/1','20260901','2026-09-01 12:30:00'].map(context._fundNavDate),Array(5).fill('2026-09-01'));
assert.deepEqual(['26.01.02','2026.01.03','26-01-04','2026-01-05'].map(context._fundNavDate),['2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
assert.match(source,/button\.textContent = '복사됨'/,'복사 버튼 즉시 피드백');
assert.match(source,/_fundUnitsStatus = '저장 중\.\.\.'/,'좌수 저장 진행 피드백');
assert.match(source,/좌수가 저장되었습니다/,'좌수 저장 성공 피드백');
assert.match(source,/data-fund-nav-manual="date"/,'과거 기준일 수동 NAV 입력 제공');
assert.match(source,/data-fund-nav-warning-ack/,'WARNING 확인 후 반영');
assert.match(source,/const fundItems = \[\]/,'F코드를 일반 평가금액 수동 편집에서 제외');

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
