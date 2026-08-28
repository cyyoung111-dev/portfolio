import assert from 'node:assert/strict';
import calculations from '../src/web/domain/plan/plan_calculations.js';

const {
  calculateAccountLiquidity, calculateDividendCashflow, aggregateLoanScheduleByYear,
  validateLoanScheduleDates,
  calculateBuyingRecommendations, calculateForeignStockTax, calculateIsaSettlementEstimate,
  calculateIsaPeriodEstimates, calculateRetirementCashflow, calculateRealizedGainFromTrades, assessRetirementStatus,
} = calculations;

const buying = calculateBuyingRecommendations({ currentTotalValue: 100_000_000, newCash: 20_000_000, items: [{ name: '검증종목', currentValue: 10_000_000, targetPct: 20, price: 50_000 }] });
assert.equal(buying.recommendations[0].targetValue, 24_000_000);
assert.equal(buying.recommendations[0].buyAmount, 14_000_000);
assert.equal(buying.recommendations[0].estimatedQuantity, 280);
assert.equal(calculateBuyingRecommendations({ items: [{ targetPct: 80 }] }).cashTargetPct, 20);
assert.deepEqual(calculateBuyingRecommendations({ newCash: 1_000, items: [{ targetPct: 101 }] }).errors, ['목표비중 합계가 100%를 초과합니다.']);

const dividends = calculateDividendCashflow({ dividends: ['일반', 'ISA', '연금', 'IRP'].map(taxType => ({ taxType, amount: 1_000_000 })) });
assert.equal(dividends.totalGross, 4_000_000);
assert.equal(dividends.normalAfterTax, 846_000);
assert.equal(dividends.availableAnnual, 846_000);
assert.equal(dividends.isaInternal, 1_000_000);
assert.equal(dividends.pensionInternal, 2_000_000);

const liquidity = calculateAccountLiquidity({ accounts: [{ taxType: '일반', value: 500_000_000 }, { taxType: 'ISA', value: 200_000_000 }, { taxType: '연금', value: 200_000_000 }, { taxType: 'IRP', value: 100_000_000 }] });
assert.equal(liquidity.totalFinancialAssets, 1_000_000_000);
assert.equal(liquidity.availableBefore55, 700_000_000);
assert.equal(liquidity.pensionAssets, 300_000_000);
assert.equal(calculateAccountLiquidity({ accounts: [{ taxType: '', acct: '확인필요', value: 100 }] }).unclassifiedAssets, 100);

const schedule = Array.from({ length: 12 }, (_, month) => ({ date: `2030-${String(month + 1).padStart(2, '0')}`, principal: 100_000, interest: 10_000, balance: 1_100_000 - month * 100_000 }));
const annualLoan = aggregateLoanScheduleByYear({ schedule }).byYear[2030];
assert.equal(annualLoan.principal, 1_200_000);
assert.equal(annualLoan.interest, 120_000);
assert.equal(annualLoan.totalPayment, 1_320_000);
const dateCheck = validateLoanScheduleDates({ startDate:'2023-06-02', schedule:[{date:'2023-04'}], remainingMonths:440, asOfMonth:'2026-08' });
assert.equal(dateCheck.warnings.length, 2);

const baseRetirement = { currentYear: 2030, currentAge: 60, retirementAge: 60, availableAssets: 100_000_000, monthlyLivingExpense: 1_000_000, postRetirementReturnRate: 0, retirementYears: 30, loanSchedule: schedule, loanBalanceAtRetirement: 1_200_000 };
const thirty = calculateRetirementCashflow(baseRetirement);
const fifty = calculateRetirementCashflow({ ...baseRetirement, retirementYears: 50 });
assert.equal(thirty.rows.length, 30);
assert.equal(fifty.rows.length, 50);
assert.equal(thirty.rows[0].loanPayment, 1_320_000);
assert.equal(thirty.rows[0].loanPrincipal, 1_200_000);
assert.equal(thirty.rows[0].loanInterest, 120_000);
const payoff = calculateRetirementCashflow({ ...baseRetirement, loanMode: 'payoff' });
assert.equal(payoff.payoffAmount, 1_200_000);
assert.equal(payoff.rows[0].loanPrincipal, 1_200_000);
assert.equal(payoff.rows[0].loanInterest, 0);
assert.equal(payoff.rows[1].loanPayment, 0);
assert.equal(payoff.rows[0].endingAssets, 86_800_000, '상환액은 기말자산에서 정확히 한 번만 차감');
for (const row of payoff.rows) {
  assert.equal(row.endingAssets, row.beginningAssets + row.investmentReturn + row.additionalInvestment + row.availableIncome - row.livingExpense - (row.educationExpense || 0) - (row.taxExpense || 0) - row.loanCashOutflow - row.otherExpense, `${row.year}년 현금흐름 항등식`);
}
const pensionTransfer = calculateRetirementCashflow({ currentYear: 2030, currentAge: 54, retirementAge: 54, retirementYears: 4, availableAssets: 10_000_000, pensionAssets: 20_000_000, pensionStartAge:55, annualPensionWithdrawal:2_000_000, pensionWithdrawalYears:2, pensionReturnRate:10, pensionTaxRate:5 });
assert.equal(pensionTransfer.rows[1].pensionTransfer, 0);
assert.equal(pensionTransfer.pensionTransferred, 0);
assert.equal(pensionTransfer.rows[1].pensionWithdrawal, 2_000_000);
assert.equal(pensionTransfer.rows[1].pensionEndingAssets, 22_200_000);
assert.equal(pensionTransfer.rows[1].taxExpense, 100_000);
assert.equal(pensionTransfer.rows[3].pensionWithdrawal, 0, '수령기간 종료 후 인출 없음');
for (const row of pensionTransfer.rows) assert.equal(row.endingAssets, row.beginningAssets + row.investmentReturn + row.additionalInvestment + row.availableIncome - row.livingExpense - (row.educationExpense || 0) - (row.taxExpense || 0) - row.loanCashOutflow - row.otherExpense);
const accumulationLoan = calculateRetirementCashflow({ currentYear: 2030, currentAge: 40, retirementAge: 42, retirementYears: 1, availableAssets: 10_000_000, monthlyInvestment: 1_000_000, loanSchedule: schedule });
assert.equal(accumulationLoan.rows[0].loanPrincipal, 1_200_000);
assert.equal(accumulationLoan.rows[0].loanInterest, 120_000);
assert.equal(accumulationLoan.rows[0].loanDeductedFromAssets, false);
assert.equal(accumulationLoan.rows[0].endingAssets, 22_000_000);
const datedSchedule = [{date:'2026-07',principal:100,interest:10,balance:900},{date:'2026-09',principal:200,interest:20,balance:700}];
const afterAsOf = calculateRetirementCashflow({ currentYear:2026,currentAge:60,retirementAge:60,retirementYears:1,availableAssets:1_000,loanSchedule:datedSchedule,asOfDate:'2026-08-28' });
assert.equal(afterAsOf.rows[0].loanPayment, 220, '기준월 이전 지급액 제외');

assert.equal(assessRetirementStatus({ retirement:{ sustainable:false,depletionYear:2040,minimumBalance:-1,pensionSettingsMissing:false } }).code, 'INSUFFICIENT');
assert.equal(assessRetirementStatus({ retirement:{ sustainable:true,depletionYear:null,minimumBalance:1,pensionSettingsMissing:false }, unclassifiedAssets:1 }).code, 'REVIEW_REQUIRED');
assert.equal(assessRetirementStatus({ retirement:{ sustainable:true,depletionYear:null,minimumBalance:1,pensionSettingsMissing:false } }).code, 'SUSTAINABLE');
assert.equal(assessRetirementStatus({ retirement:{ sustainable:true,depletionYear:null,minimumBalance:1,pensionSettingsMissing:false }, missingRequiredSettings:true }).code, 'REVIEW_REQUIRED');
const otherIncomeSustains = calculateRetirementCashflow({currentYear:2030,currentAge:60,retirementAge:60,retirementYears:30,availableAssets:10_000_000,monthlyLivingExpense:1_000_000,annualOtherIncome:12_000_000,withdrawalRate:4});
assert.equal(otherIncomeSustains.sustainable,true,'단순 FIRE 미달이어도 기타소득으로 유지');

const isa = calculateIsaSettlementEstimate({ unrealizedGain: 10_000_000 });
assert.equal(isa.estimatedSettlementTax, 0);
assert.equal(isa.unrealizedGain, 10_000_000);
assert.equal(calculateIsaSettlementEstimate({ realizedGain: 5_000_000, isaType: 'general' }).exemption, 2_000_000);
assert.equal(calculateIsaSettlementEstimate({ realizedGain: 5_000_000, isaType: 'special' }).exemption, 4_000_000);
const isaPeriods = calculateIsaPeriodEstimates({ selectedYear:{realizedGain:1_000_000}, cumulative:{realizedGain:5_000_000,unrealizedGain:10_000_000}, calculationDate:'2026-08-28', dataGaps:['이자 원장 미입력'] });
assert.equal(isaPeriods.selectedYear.estimatedSettlementTax, 0);
assert.equal(isaPeriods.cumulative.estimatedSettlementTax, 297_000);
assert.equal(isaPeriods.cumulative.unrealizedGain, 10_000_000);
assert.equal(isaPeriods.complete, false);
assert.equal(calculateForeignStockTax({ realizedGain: 10_000_000 }).estimatedTax, 1_650_000);
const realizedTrades = [
  { id:'1', date:'2026-01-01', tradeType:'buy', acct:'일반', name:'미국주식', qty:10, price:100, market:'US', taxType:'일반' },
  { id:'2', date:'2026-06-01', tradeType:'sell', acct:'일반', name:'미국주식', qty:5, price:200, market:'US', taxType:'일반' },
  { id:'3', date:'2026-06-01', tradeType:'sell', acct:'ISA', name:'ISA종목', qty:1, price:200, market:'KR', taxType:'ISA' },
];
assert.equal(calculateRealizedGainFromTrades({ trades: realizedTrades, year:2026, market:'US', taxTypes:['normal'] }).realizedGain, 500);

for (const input of [undefined, null, '', Number.NaN, -1]) {
  assert.doesNotThrow(() => calculateDividendCashflow({ dividends: [{ amount: input }] }));
}
assert.equal(aggregateLoanScheduleByYear({ schedule: [{ date: '잘못된 날짜', principal: 1 }] }).years.length, 0);
assert.equal(calculateRetirementCashflow({ withdrawalRate: 0 }).simpleRequiredAssets, null);

console.log('투자계획 순수 계산 고정 사례 및 경계값 검사 통과');
