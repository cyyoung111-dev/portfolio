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
console.log('✅ 펀드 NAV xlsx/xls/csv 행 파싱·날짜·숫자·급변 경고 검사 통과');
