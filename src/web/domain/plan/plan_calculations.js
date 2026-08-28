// 투자계획 순수 계산 모듈 — DOM·브라우저 저장소에 의존하지 않습니다.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlanCalculations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const TAX_RULES_BY_YEAR = Object.freeze({
    2026: Object.freeze({
      normalDividendWithholdingRate: 0.154,
      domesticStockSaleReferenceRate: 0.0018,
      foreignStockDeduction: 2500000,
      foreignStockTaxRate: 0.22,
      isa: Object.freeze({ generalExemption: 2000000, specialExemption: 4000000, separateTaxRate: 0.099 }),
    }),
  });

  function number(value, fallback = 0, allowNegative = false) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return allowNegative ? parsed : Math.max(0, parsed);
  }

  function rulesFor(year) {
    const years = Object.keys(TAX_RULES_BY_YEAR).map(Number).sort((a, b) => b - a);
    const selected = years.find(item => item <= number(year, 2026)) || years[years.length - 1];
    return { year: selected, ...TAX_RULES_BY_YEAR[selected] };
  }

  function classifyTaxType(value) {
    const type = String(value || '').trim().toUpperCase();
    if (type === '일반' || type === 'NORMAL') return 'normal';
    if (type === 'ISA') return 'isa';
    if (type === '연금' || type === '연금저축' || type === 'PENSION') return 'pension';
    if (type === 'IRP') return 'irp';
    return 'unclassified';
  }

  function calculateAccountLiquidity({ accounts = [], realEstateValue = 0, loanBalance = 0 } = {}) {
    const result = { totalFinancialAssets: 0, availableBefore55: 0, isaAssets: 0, pensionAssets: 0, unclassifiedAssets: 0, realEstateValue: number(realEstateValue), loanBalance: number(loanBalance), totalNetWorth: 0, warnings: [] };
    (Array.isArray(accounts) ? accounts : []).forEach(account => {
      const amount = number(account?.evalAmt ?? account?.value);
      const type = classifyTaxType(account?.taxType);
      result.totalFinancialAssets += amount;
      if (type === 'normal') result.availableBefore55 += amount;
      else if (type === 'isa') { result.availableBefore55 += amount; result.isaAssets += amount; }
      else if (type === 'pension' || type === 'irp') result.pensionAssets += amount;
      else { result.unclassifiedAssets += amount; result.warnings.push(`미분류 계좌: ${String(account?.acct || account?.name || '이름 없음')}`); }
    });
    result.totalNetWorth = result.totalFinancialAssets + result.realEstateValue - result.loanBalance;
    result.warnings = [...new Set(result.warnings)];
    return result;
  }

  function calculateDividendCashflow({ dividends = [], year = 2026 } = {}) {
    const rules = rulesFor(year);
    const out = { totalGross: 0, normalGross: 0, normalAfterTax: 0, availableAnnual: 0, availableMonthly: 0, isaInternal: 0, pensionInternal: 0, pensionSavingsInternal: 0, irpInternal: 0, unclassified: 0, warnings: [], appliedRuleYear: rules.year };
    (Array.isArray(dividends) ? dividends : []).forEach(item => {
      const amount = number(item?.amount ?? item?.annualDiv);
      const type = classifyTaxType(item?.taxType);
      out.totalGross += amount;
      if (type === 'normal') out.normalGross += amount;
      else if (type === 'isa') out.isaInternal += amount;
      else if (type === 'pension') { out.pensionSavingsInternal += amount; out.pensionInternal += amount; }
      else if (type === 'irp') { out.irpInternal += amount; out.pensionInternal += amount; }
      else { out.unclassified += amount; out.warnings.push(`미분류 배당: ${String(item?.acct || item?.name || '이름 없음')}`); }
    });
    out.normalAfterTax = Math.round(out.normalGross * (1 - rules.normalDividendWithholdingRate));
    out.availableAnnual = out.normalAfterTax;
    out.availableMonthly = Math.round(out.availableAnnual / 12);
    out.warnings = [...new Set(out.warnings)];
    return out;
  }

  function aggregateLoanScheduleByYear({ schedule = [] } = {}) {
    const years = {};
    let payoffDate = null;
    (Array.isArray(schedule) ? schedule : []).forEach(row => {
      const match = String(row?.date || '').match(/^(\d{4})-(0[1-9]|1[0-2])/);
      if (!match) return;
      const year = Number(match[1]);
      if (!years[year]) years[year] = { year, principal: 0, interest: 0, totalPayment: 0, averageMonthlyPayment: 0, endingBalance: 0, months: 0 };
      const principal = number(row?.principal);
      const interest = number(row?.interest);
      years[year].principal += principal;
      years[year].interest += interest;
      years[year].totalPayment += principal + interest;
      years[year].endingBalance = number(row?.balance);
      years[year].months += 1;
      payoffDate = String(row.date);
    });
    const annual = Object.values(years).sort((a, b) => a.year - b.year).map(item => ({ ...item, averageMonthlyPayment: item.months ? Math.round(item.totalPayment / item.months) : 0 }));
    return { years: annual, byYear: Object.fromEntries(annual.map(item => [item.year, item])), payoffDate };
  }

  function validateLoanScheduleDates({ startDate = '', schedule = [], remainingMonths = null, asOfMonth = '' } = {}) {
    const validRows = (Array.isArray(schedule) ? schedule : []).filter(item => /^\d{4}-(0[1-9]|1[0-2])/.test(String(item?.date || ''))).sort((a,b) => String(a.date).localeCompare(String(b.date)));
    const startMonth = String(startDate || '').slice(0, 7);
    const firstScheduleMonth = validRows[0] ? String(validRows[0].date).slice(0, 7) : '';
    const futureRows = asOfMonth ? validRows.filter(item => String(item.date).slice(0,7) > asOfMonth).length : validRows.length;
    const warnings = [];
    if (startMonth && firstScheduleMonth && firstScheduleMonth < startMonth) warnings.push('대출 실행일보다 상환스케줄이 먼저 시작합니다. 원본 금융기관 상환표 확인이 필요합니다.');
    if (remainingMonths !== null && Number.isFinite(Number(remainingMonths)) && Number(remainingMonths) !== futureRows) warnings.push('remainingMonths와 현재월 이후 스케줄 행 수가 다릅니다. 현재월 포함 여부를 확인하세요.');
    return { startMonth, firstScheduleMonth, futureRows, remainingMonths: remainingMonths === null ? null : Number(remainingMonths), warnings };
  }

  function calculateBuyingRecommendations({ currentTotalValue = 0, newCash = 0, items = [] } = {}) {
    const total = number(currentTotalValue);
    const cash = number(newCash);
    const targetTotal = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + number(item?.targetPct), 0);
    const errors = targetTotal > 100.000001 ? ['목표비중 합계가 100%를 초과합니다.'] : [];
    const shortages = (Array.isArray(items) ? items : []).filter(item => number(item?.targetPct) > 0).map(item => {
      const targetPct = number(item.targetPct);
      const currentValue = number(item.currentValue ?? item.evalAmt);
      const targetValue = (total + cash) * targetPct / 100;
      return { ...item, targetPct, currentValue, targetValue, shortage: Math.max(0, targetValue - currentValue) };
    }).filter(item => item.shortage > 0);
    const totalShortage = shortages.reduce((sum, item) => sum + item.shortage, 0);
    const recommendations = errors.length ? [] : shortages.map(item => {
      const buyAmount = totalShortage > cash && totalShortage > 0 ? cash * item.shortage / totalShortage : item.shortage;
      const price = number(item.price);
      return { ...item, buyAmount: Math.round(buyAmount), estimatedQuantity: price > 0 ? Math.floor(buyAmount / price) : null };
    });
    return { recommendations, targetTotal, cashTargetPct: Math.max(0, 100 - targetTotal), allocationMethod: totalShortage > cash ? 'shortage-proportional' : 'full-shortage', errors };
  }

  function calculateNormalAccountTax({ dividendIncome = 0, year = 2026 } = {}) {
    const rules = rulesFor(year);
    const gross = number(dividendIncome);
    return { grossDividend: gross, withholdingReference: Math.round(gross * rules.normalDividendWithholdingRate), afterWithholdingReference: Math.round(gross * (1 - rules.normalDividendWithholdingRate)), appliedRuleYear: rules.year };
  }

  function calculateDomesticStockTax({ saleValue = 0, realizedGain = 0, year = 2026 } = {}) {
    const rules = rulesFor(year);
    return { saleValue: number(saleValue), realizedGain: number(realizedGain, 0, true), saleTaxReference: Math.round(number(saleValue) * rules.domesticStockSaleReferenceRate), saleTaxRate: rules.domesticStockSaleReferenceRate, appliedRuleYear: rules.year };
  }

  function calculateForeignStockTax({ realizedGain = 0, manualAdjustment = 0, year = 2026 } = {}) {
    const rules = rulesFor(year);
    const transactionEstimate = number(realizedGain, 0, true);
    const adjustment = number(manualAdjustment, 0, true);
    const finalEstimatedGain = transactionEstimate + adjustment;
    const taxableBase = Math.max(0, finalEstimatedGain - rules.foreignStockDeduction);
    return { transactionEstimate, manualAdjustment: adjustment, finalEstimatedGain, deduction: rules.foreignStockDeduction, taxableBase, taxRate: rules.foreignStockTaxRate, estimatedTax: Math.round(taxableBase * rules.foreignStockTaxRate), appliedRuleYear: rules.year };
  }

  function calculateRealizedGainFromTrades({ trades = [], year, market, taxTypes = [] } = {}) {
    const positions = {};
    let realizedGain = 0;
    const seen = new Set();
    (Array.isArray(trades) ? [...trades] : []).sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || ''))).forEach(trade => {
      const id = String(trade?.id || '');
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      if (market && String(trade?.market || '').toUpperCase() !== String(market).toUpperCase()) return;
      if (taxTypes.length && !taxTypes.includes(classifyTaxType(trade?.taxType))) return;
      const key = `${trade?.acct || ''}||${trade?.name || trade?.code || ''}`;
      if (!positions[key]) positions[key] = { qty: 0, cost: 0 };
      const qty = number(trade?.qty);
      const price = number(trade?.price ?? (trade?.tradeType === 'sell' ? trade?.sellPrice : trade?.buyPrice));
      if (trade?.tradeType === 'buy') { positions[key].qty += qty; positions[key].cost += qty * price; return; }
      if (trade?.tradeType !== 'sell') return;
      const average = positions[key].qty > 0 ? positions[key].cost / positions[key].qty : 0;
      const sold = Math.min(qty, positions[key].qty);
      if (String(trade?.date || '').slice(0, 4) === String(year)) realizedGain += (price - average) * sold;
      positions[key].qty -= sold;
      positions[key].cost -= average * sold;
    });
    return { realizedGain, method: 'weighted-average-transaction-estimate' };
  }

  function calculateIsaSettlementEstimate({ realizedGain = 0, unrealizedGain = 0, dividendAndInterest = 0, eligibleLoss = 0, isaType = 'general', year = 2026 } = {}) {
    const rules = rulesFor(year);
    const exemption = isaType === 'special' ? rules.isa.specialExemption : rules.isa.generalExemption;
    const estimatedNetTaxableProfit = Math.max(0, number(realizedGain, 0, true) + number(dividendAndInterest) - number(eligibleLoss));
    const excess = Math.max(0, estimatedNetTaxableProfit - exemption);
    return { realizedGain: number(realizedGain, 0, true), unrealizedGain: number(unrealizedGain, 0, true), dividendAndInterest: number(dividendAndInterest), eligibleLoss: number(eligibleLoss), estimatedNetTaxableProfit, exemption, excess, estimatedSettlementTax: Math.round(excess * rules.isa.separateTaxRate), taxRate: rules.isa.separateTaxRate, appliedRuleYear: rules.year };
  }

  function calculateIsaPeriodEstimates({ selectedYear = {}, cumulative = {}, isaType = 'general', year = 2026, calculationDate = '', dataGaps = [] } = {}) {
    return {
      selectedYear: calculateIsaSettlementEstimate({ ...selectedYear, isaType, year }),
      cumulative: calculateIsaSettlementEstimate({ ...cumulative, isaType, year }),
      calculationDate: String(calculationDate || ''), appliedRuleYear: rulesFor(year).year,
      dataGaps: Array.isArray(dataGaps) ? [...dataGaps] : [], complete: !dataGaps?.length,
    };
  }

  function calculateYearsToTarget({ initialAssets = 0, monthlyInvestment = 0, annualReturnRate = 0, targetAssets = 0, maxYears = 100 } = {}) {
    let assets = number(initialAssets);
    const target = number(targetAssets);
    if (!target || assets >= target) return { years: target ? 0 : null, reached: !!target };
    const monthly = number(monthlyInvestment);
    const rate = number(annualReturnRate) / 100 / 12;
    for (let month = 1; month <= number(maxYears, 100) * 12; month += 1) {
      assets = assets * (1 + rate) + monthly;
      if (assets >= target) return { years: Math.ceil(month / 12), months: month, reached: true, assets };
    }
    return { years: null, reached: false, assets };
  }

  function calculateRetirementCashflow(input = {}) {
    const currentYear = Math.trunc(number(input.currentYear, new Date().getFullYear()));
    const currentAge = number(input.currentAge);
    const retirementAge = Math.max(currentAge, number(input.retirementAge, currentAge));
    const retirementYear = Math.trunc(number(input.retirementYear, currentYear + (retirementAge - currentAge)));
    const retirementYears = Math.trunc(number(input.retirementYears, 30));
    const preYears = Math.max(0, retirementYear - currentYear);
    const monthlyInvestment = number(input.monthlyInvestment);
    const preRate = number(input.preRetirementReturnRate) / 100;
    const postRate = number(input.postRetirementReturnRate) / 100;
    const inflation = number(input.inflationRate) / 100;
    const baseLiving = number(input.monthlyLivingExpense) * 12;
    const extraExpense = number(input.annualExtraExpense);
    const otherIncome = number(input.annualOtherIncome);
    const availableDividend = number(input.availableAnnualDividend);
    const loanMode = input.loanMode === 'payoff' ? 'payoff' : 'maintain';
    const loan = aggregateLoanScheduleByYear({ schedule: input.loanSchedule }).byYear;
    let assets = number(input.availableAssets);
    let pensionAssets = number(input.pensionAssets);
    const pensionStartAge = Math.max(55, number(input.pensionStartAge, 55));
    const annualPensionWithdrawal = number(input.annualPensionWithdrawal);
    const pensionReturnRate = number(input.pensionReturnRate) / 100;
    const pensionTaxRate = number(input.pensionTaxRate) / 100;
    let pensionTransferred = 0; // 구버전 결과 필드 호환용: 자동 전환하지 않으므로 항상 0
    const rows = [];
    for (let offset = 0; offset < preYears; offset += 1) {
      const year = currentYear + offset;
      const beginningAssets = assets;
      const age = currentAge + offset;
      const pensionTransfer = 0;
      const adjustedBeginningAssets = assets;
      const investment = monthlyInvestment * 12;
      const investmentReturn = (adjustedBeginningAssets + investment) * preRate;
      const loanPrincipal = number(loan[year]?.principal);
      const loanInterest = number(loan[year]?.interest);
      const loanPayment = loanPrincipal + loanInterest;
      assets = adjustedBeginningAssets + investment + investmentReturn - loanPayment;
      rows.push({ year, age, phase: 'accumulation', beginningAssets, pensionTransfer, additionalInvestment: investment, investmentReturn, livingExpense: 0, educationExpense: 0, taxExpense: 0, loanPrincipal, loanInterest, loanPayment, loanDeductedFromAssets: true, otherExpense: 0, availableIncome: 0, endingAssets: assets, pensionAvailable: age >= 55 });
    }
    let payoffAmount = 0;
    if (loanMode === 'payoff') {
      const cutoff = `${retirementYear}-01`;
      const scheduleRows = (Array.isArray(input.loanSchedule) ? input.loanSchedule : [])
        .filter(item => /^\d{4}-(0[1-9]|1[0-2])/.test(String(item?.date || '')) && String(item.date) < cutoff)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const balanceBeforeRetirement = scheduleRows.length ? scheduleRows[scheduleRows.length - 1].balance : input.loanBalanceAtRetirement;
      payoffAmount = number(balanceBeforeRetirement);
    }
    let depletionYear = null;
    let minimumBalance = assets;
    for (let offset = 0; offset < retirementYears; offset += 1) {
      const year = retirementYear + offset;
      const beginningAssets = assets;
      const age = currentAge + (year - currentYear);
      const pensionTransfer = 0;
      const pensionBeginningAssets = pensionAssets;
      const pensionInvestmentReturn = Math.max(0, pensionBeginningAssets) * pensionReturnRate;
      const pensionWithdrawal = age >= pensionStartAge
        ? Math.min(pensionBeginningAssets + pensionInvestmentReturn, annualPensionWithdrawal)
        : 0;
      const pensionTax = pensionWithdrawal * pensionTaxRate;
      pensionAssets = pensionBeginningAssets + pensionInvestmentReturn - pensionWithdrawal;
      const retirementPayoff = loanMode === 'payoff' && offset === 0 ? payoffAmount : 0;
      const adjustedBeginningAssets = assets;
      const investmentReturn = Math.max(0, adjustedBeginningAssets) * postRate;
      const livingExpense = baseLiving * Math.pow(1 + inflation, preYears + offset);
      const loanPrincipal = loanMode === 'maintain' ? number(loan[year]?.principal) : retirementPayoff;
      const loanInterest = loanMode === 'maintain' ? number(loan[year]?.interest) : 0;
      const loanPayment = loanPrincipal + loanInterest;
      const availableIncome = availableDividend + otherIncome + pensionWithdrawal;
      const endingAssets = adjustedBeginningAssets + investmentReturn - livingExpense - pensionTax - loanPayment - extraExpense + availableIncome;
      assets = endingAssets;
      minimumBalance = Math.min(minimumBalance, endingAssets);
      if (depletionYear === null && endingAssets < 0) depletionYear = year;
      rows.push({ year, age, phase: 'retirement', beginningAssets, pensionTransfer, additionalInvestment: 0, investmentReturn, livingExpense, educationExpense: 0, taxExpense: pensionTax, loanPrincipal, loanInterest, loanPayment, loanDeductedFromAssets: true, otherExpense: extraExpense, availableIncome, endingAssets, pensionAvailable: age >= 55, pensionBeginningAssets, pensionInvestmentReturn, pensionWithdrawal, pensionEndingAssets: pensionAssets });
    }
    const withdrawalRate = number(input.withdrawalRate) / 100;
    const simpleRequiredAssets = withdrawalRate > 0 ? baseLiving / withdrawalRate : null;
    return { retirementYear, projectedAssetsAtRetirement: rows.find(row => row.year === retirementYear)?.beginningAssets ?? assets, availableAssetsBefore55: number(input.availableAssets), pensionAssetsAfter55: number(input.pensionAssets), pensionTransferred, remainingPensionAssets: pensionAssets, payoffAmount, rows, depletionYear, minimumBalance, sustainable: depletionYear === null, simpleRequiredAssets, cashflowDifference: simpleRequiredAssets === null ? null : (rows.find(row => row.year === retirementYear)?.beginningAssets ?? assets) - simpleRequiredAssets };
  }

  return { TAX_RULES_BY_YEAR, number, classifyTaxType, calculateAccountLiquidity, calculateDividendCashflow, aggregateLoanScheduleByYear, validateLoanScheduleDates, calculateBuyingRecommendations, calculateNormalAccountTax, calculateDomesticStockTax, calculateForeignStockTax, calculateRealizedGainFromTrades, calculateIsaSettlementEstimate, calculateIsaPeriodEstimates, calculateYearsToTarget, calculateRetirementCashflow };
});
