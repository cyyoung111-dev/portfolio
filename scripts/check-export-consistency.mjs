import assert from 'node:assert/strict';
import fs from 'node:fs';
import calculations from '../src/web/domain/plan/plan_calculations.js';

const flow = calculations.calculateDividendCashflow({ dividends:['일반','ISA','연금','IRP'].map(taxType => ({taxType,amount:1_000_000})) });
assert.deepEqual({ total:flow.totalGross, available:flow.availableAnnual, isa:flow.isaInternal, pension:flow.pensionInternal }, { total:4_000_000, available:846_000, isa:1_000_000, pension:2_000_000 });
const source = fs.readFileSync(new URL('../src/web/views/views_plan.js', import.meta.url), 'utf8');
assert.equal((source.match(/id="foreign-tax-adjustment"/g) || []).length, 1);
assert.equal((source.match(/🌐 해외주식 직접투자 양도세 추정/g) || []).length, 1);
assert.doesNotMatch(source, /annualDividend\s*\*\s*0\.846/);
assert.match(source, /calculateDividendCashflow\(\{ dividends: dividendEntries/);
const ids = [...source.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const duplicateStaticIds = [...new Set(ids.filter((id,index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateStaticIds, []);
console.log('웹·Excel 배당 공유 계산 및 투자계획 DOM 고유 ID 검사 통과 (7개)');
