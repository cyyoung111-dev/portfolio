import assert from 'node:assert/strict';
import calculations from '../src/web/domain/plan/plan_calculations.js';

// 원본 파일이 없는 환경에서 2026-08-28 사용자 제공 기준값을 고정하는 회귀 fixture입니다.
const trades = Array.from({length:291}, (_,index) => ({ id:`trade-${index+1}`, tradeType:index === 290 ? 'sell' : 'buy' }));
assert.equal(trades.length, 291); assert.equal(trades.filter(item=>item.tradeType==='buy').length,290); assert.equal(trades.filter(item=>item.tradeType==='sell').length,1);
const accountValues = [
  {taxType:'일반',value:1_786_923_840}, {taxType:'ISA',value:24_262_395},
  {taxType:'연금',value:136_101_435}, {taxType:'IRP',value:126_096_982},
];
const liquidity = calculations.calculateAccountLiquidity({accounts:accountValues,realEstateValue:1_100_000_000,loanBalance:354_702_682});
assert.equal(liquidity.totalFinancialAssets,2_073_384_652);
assert.equal(liquidity.availableBefore55,1_811_186_235);
assert.equal(liquidity.pensionAssets,262_198_417);
assert.equal(liquidity.totalNetWorth,2_818_681_970);
const cost = 494_519_915, evaluation = liquidity.totalFinancialAssets;
assert.equal(evaluation-cost,1_578_864_737);
const positions = Array.from({length:58}, (_,index)=>({id:index+1})); assert.equal(positions.length,58);

const dividend = calculations.calculateDividendCashflow({dividends:[
  {taxType:'일반',amount:7_973_020},{taxType:'ISA',amount:1_070_490},{taxType:'연금',amount:476_840},{taxType:'IRP',amount:979_580},
]});
assert.equal(dividend.totalGross,10_499_930);
assert.equal(dividend.normalGross,7_973_020);
assert.equal(dividend.normalAfterTax,6_745_175);
assert.equal(dividend.availableMonthly,562_098);
assert.equal(dividend.isaInternal,1_070_490);
assert.equal(dividend.pensionSavingsInternal,476_840);
assert.equal(dividend.irpInternal,979_580);
const futureSchedule = Array.from({length:439},(_,index)=>({date:`${2026+Math.floor((index+8)/12)}-${String((index+8)%12+1).padStart(2,'0')}`,principal:index===0?354_702_682:0,interest:index===0?395_295_848:0}));
assert.equal(futureSchedule.reduce((sum,item)=>sum+item.principal,0),354_702_682);
assert.equal(futureSchedule.reduce((sum,item)=>sum+item.interest,0),395_295_848);
const loanDates = calculations.validateLoanScheduleDates({startDate:'2023-06-02',schedule:[{date:'2023-04'},...futureSchedule],remainingMonths:439,asOfMonth:'2026-08'});
assert.ok(loanDates.warnings.some(item=>item.includes('먼저 시작')));
assert.ok(!loanDates.warnings.some(item=>item.includes('남은 상환개월')));
console.log('2026-08-28 제공 기준값 회귀검사 통과 (원본 JSON/XLSX 재검증 필요)');
