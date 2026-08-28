import assert from 'node:assert/strict';
import calculations from '../src/web/domain/plan/plan_calculations.js';

const {
  calculateAccountLiquidity, calculateDividendCashflow, aggregateLoanScheduleByYear,
  calculateBuyingRecommendations, calculateForeignStockTax, calculateIsaSettlementEstimate,
  calculateRetirementCashflow,
} = calculations;

const buying = calculateBuyingRecommendations({ currentTotalValue: 100_000_000, newCash: 20_000_000, items: [{ name: '검증종목', currentValue: 10_000_000, targetPct: 20, price: 50_000 }] });
assert.equal(buying.recommendations[0].targetValue, 24_000_000);
assert.equal(buying.recommendations[0].buyAmount, 14_000_000);
assert.equal(buying.recommendations[0].estimatedQuantity, 280);
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

const baseRetirement = { currentYear: 2030, currentAge: 60, retirementAge: 60, availableAssets: 100_000_000, monthlyLivingExpense: 1_000_000, postRetirementReturnRate: 0, retirementYears: 30, loanSchedule: schedule, loanBalanceAtRetirement: 1_200_000 };
const thirty = calculateRetirementCashflow(baseRetirement);
const fifty = calculateRetirementCashflow({ ...baseRetirement, retirementYears: 50 });
assert.equal(thirty.rows.length, 30);
assert.equal(fifty.rows.length, 50);
assert.equal(thirty.rows[0].loanPayment, 1_320_000);
const payoff = calculateRetirementCashflow({ ...baseRetirement, loanMode: 'payoff' });
assert.equal(payoff.payoffAmount, 1_200_000);
assert.equal(payoff.rows[0].loanPayment, 0);

const isa = calculateIsaSettlementEstimate({ unrealizedGain: 10_000_000 });
assert.equal(isa.estimatedSettlementTax, 0);
assert.equal(isa.unrealizedGain, 10_000_000);
assert.equal(calculateIsaSettlementEstimate({ realizedGain: 5_000_000, isaType: 'general' }).exemption, 2_000_000);
assert.equal(calculateIsaSettlementEstimate({ realizedGain: 5_000_000, isaType: 'special' }).exemption, 4_000_000);
assert.equal(calculateForeignStockTax({ realizedGain: 10_000_000 }).estimatedTax, 1_650_000);

for (const input of [undefined, null, '', Number.NaN, -1]) {
  assert.doesNotThrow(() => calculateDividendCashflow({ dividends: [{ amount: input }] }));
}
assert.equal(aggregateLoanScheduleByYear({ schedule: [{ date: '잘못된 날짜', principal: 1 }] }).years.length, 0);
assert.equal(calculateRetirementCashflow({ withdrawalRate: 0 }).simpleRequiredAssets, null);

console.log('투자계획 순수 계산 고정 사례 및 경계값 검사 통과');
