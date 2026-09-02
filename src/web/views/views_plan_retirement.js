// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
function _buildRetirementSection(totalEval) {
  const monthlyExpense = _planNumber(_planSettings.retireMonthlyExpense, 3000000);
  const retireYears    = _planNumber(_planSettings.retireYears, 30);
  const retireReturn   = _planNumber(_planSettings.retireReturn, 4);
  const withdrawalRate = _planNumber(_planSettings.retireWithdrawalRate, 4);
  const annualExpense  = monthlyExpense * 12;
  const fireNumber     = withdrawalRate > 0 ? Math.round(annualExpense / (withdrawalRate / 100)) : 0;
  const gap            = Math.max(0, fireNumber - totalEval);
  const coveragePct    = fireNumber > 0 ? Math.min(999, totalEval / fireNumber * 100) : 0;
  const dividendRows = typeof calcDividends === 'function' ? calcDividends() : [];
  const dividendFlow = PlanCalculations.calculateDividendCashflow({ dividends: _getPlanDividendEntries(dividendRows) });
  const dividendAfterTaxMonthly = dividendFlow.availableMonthly;
  const dividendCoveragePct = monthlyExpense > 0 ? Math.min(999, dividendAfterTaxMonthly / monthlyExpense * 100) : 0;
  const monthlyInvest = _planNumber(_planSettings.simMonthly, 0);
  const liquidity = PlanCalculations.calculateAccountLiquidity({ accounts: rows.map(row => ({ acct: row.acct, taxType: Object.prototype.hasOwnProperty.call(ACCT_TAX_TYPES || {}, row.acct) ? ACCT_TAX_TYPES[row.acct] : '', evalAmt: row.evalAmt })) });
  const retirement = PlanCalculations.calculateRetirementCashflow({
    currentAge: _planSettings.retireCurrentAge, retirementAge: _planSettings.retireTargetAge,
    retirementYears: retireYears, availableAssets: liquidity.availableBefore55,
    pensionAssets: liquidity.pensionAssets, monthlyLivingExpense: monthlyExpense,
    monthlyInvestment: monthlyInvest, preRetirementReturnRate: retireReturn,
    postRetirementReturnRate: _planSettings.retirePostReturn, inflationRate: _planSettings.retireInflation,
    annualExtraExpense: _planSettings.retireExtraExpense, annualOtherIncome: _planSettings.retireOtherIncome,
    availableAnnualDividend: dividendFlow.availableAnnual, loanMode: _planSettings.retireLoanMode,
    loanSchedule: LOAN_SCHEDULE, loanBalanceAtRetirement: LOAN?.balance, withdrawalRate,
    asOfDate: /^\d{4}-\d{2}/.test(String(lastUpdated || '')) ? String(lastUpdated).slice(0,10) : ((typeof _kstTodayStr === 'function') ? _kstTodayStr() : new Date().toISOString().slice(0,10)),
    pensionStartAge:_planSettings.pensionStartAge, annualPensionWithdrawal:_planSettings.annualPensionWithdrawal,
    pensionWithdrawalYears:_planSettings.pensionWithdrawalYears, pensionReturnRate:_planSettings.pensionReturnRate, pensionTaxRate:_planSettings.pensionTaxRate,
  });
  const retirementLoanSummary = PlanCalculations.aggregateLoanScheduleByYear({ schedule: LOAN_SCHEDULE });
  const loanYearsInTable = retirement.rows.filter(row => Number(row.loanPayment || 0) > 0).length;
  const yearsToTarget = _calcYearsToRetirementTarget(totalEval, monthlyInvest, gap, retireReturn, fireNumber);
  const retirementStatus = PlanCalculations.assessRetirementStatus({ retirement, unclassifiedAssets:liquidity.unclassifiedAssets, missingRequiredSettings:withdrawalRate <= 0 });
  const status = retirementStatus.label;
  const statusColor = retirementStatus.code === 'SUSTAINABLE' ? 'var(--green)' : retirementStatus.code === 'INSUFFICIENT' ? 'var(--red-lt)' : 'var(--amber)';
  const asOfMonth = retirement.asOfDate.slice(0,7);
  const loanDateValidation = PlanCalculations.validateLoanScheduleDates({ startDate:LOAN?.startDate, schedule:LOAN_SCHEDULE, remainingMonths:LOAN?.remainingMonths, asOfMonth });

  const checkpoints = [
    [coveragePct >= 100, '목표 생활비 기준 FIRE 필요자금 충족'],
    [dividendCoveragePct >= 50, '세후 월 배당이 목표 생활비의 50% 이상'],
    [monthlyInvest > 0, '월 추가 투자금 입력됨'],
    [retireYears >= 20, '은퇴 후 20년 이상 현금흐름 점검 기간 설정'],
  ];

  return `<div class="card-12-p20" id="plan-retirement">
    <div class="flex-between-mb14">
      <h4 class="h3-card" style="margin-bottom:0">🏖️ 은퇴 포트폴리오 점검</h4>
      <span style="font-size:.72rem;font-weight:700;color:${statusColor};background:var(--s2);border:1px solid var(--border);border-radius:999px;padding:4px 10px">${status}</span>
    </div>
    <div style="font-size:.66rem;color:var(--muted);margin-bottom:14px">
      안전인출률은 참고값이며 은퇴기간, 자산배분, 세금, 물가, 주담대 및 시장수익률에 따라 실제 결과가 달라질 수 있습니다.
    </div>

    <div class="retire-metric-grid">
      ${[
        ['현재 평가자산', fmt(totalEval), 'var(--text)'],
        ['필요 은퇴자금', fmt(fireNumber), 'var(--amber)'],
        ['부족 금액', gap > 0 ? fmt(gap) : '충족', gap > 0 ? 'var(--red-lt)' : 'var(--green)'],
        ['단순 FIRE 달성률', coveragePct.toFixed(1) + '%', 'var(--muted)'],
        ['현금흐름 결과', retirement.sustainable ? '기간 내 유지' : `${retirement.depletionYear}년 고갈`, retirement.sustainable ? 'var(--green)' : 'var(--red-lt)'],
        ['은퇴시점 예상자산', fmt(Math.round(retirement.projectedAssetsAtRetirement)), 'var(--cyan)'],
        ['55세 전 브리지 자산', fmt(retirement.availableAssetsBefore55), 'var(--cyan)'],
        ['연금자산', fmt(retirement.pensionAssetsAfter55), 'var(--purple-lt)'],
        ['최저 자산잔액', fmt(Math.round(retirement.minimumBalance)), retirement.minimumBalance >= 0 ? 'var(--text)' : 'var(--red-lt)'],
      ].map(([l,v,c])=>`<div class="s2-rounded">
        <div class="lbl-62-muted-3">${l}</div>
        <div style="font-size:.86rem;font-weight:800;color:${c}">${v}</div>
      </div>`).join('')}
    </div>

    <div class="retire-input-grid">
      <div><div class="lbl-62-muted-3">목표 월 생활비</div><input type="text" id="retire-monthly-expense" value="${monthlyExpense.toLocaleString()}" data-format="number-comma" style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/></div>
      <div><div class="lbl-62-muted-3">안전 인출률 (%)</div><input type="number" id="retire-withdrawal-rate" value="${withdrawalRate}" min="1" max="10" step="0.1" style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/></div>
      <div><div class="lbl-62-muted-3">은퇴 후 기간 (년)</div><input type="number" id="retire-years" value="${retireYears}" min="1" max="60" style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/></div>
      <div><div class="lbl-62-muted-3">목표 도달 수익률 (%)</div><input type="number" id="retire-return" value="${retireReturn}" min="0" max="20" step="0.5" style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/></div>
      <div><div class="lbl-62-muted-3">현재 나이</div><input type="number" id="retire-current-age" value="${_planSettings.retireCurrentAge}" min="0" max="100" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">목표 은퇴 나이</div><input type="number" id="retire-target-age" value="${_planSettings.retireTargetAge}" min="0" max="100" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">물가상승률 (%)</div><input type="number" id="retire-inflation" value="${_planSettings.retireInflation}" min="0" max="20" step="0.1" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">은퇴 후 수익률 (%)</div><input type="number" id="retire-post-return" value="${_planSettings.retirePostReturn}" min="0" max="20" step="0.1" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">기타 연간지출</div><input type="text" id="retire-extra-expense" value="${_planSettings.retireExtraExpense.toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">기타 연간소득</div><input type="text" id="retire-other-income" value="${_planSettings.retireOtherIncome.toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">주담대 처리</div><select id="retire-loan-mode" style="width:100%"><option value="maintain" ${_planSettings.retireLoanMode==='maintain'?'selected':''}>주담대 유지</option><option value="payoff" ${_planSettings.retireLoanMode==='payoff'?'selected':''}>은퇴시점 전액 상환</option></select></div>
      <div><div class="lbl-62-muted-3">연금 개시연령</div><input type="number" id="pension-start-age" value="${_planSettings.pensionStartAge ?? ''}" min="55" max="100" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">연간 연금수령액</div><input type="text" id="pension-annual-withdrawal" value="${_planSettings.annualPensionWithdrawal == null ? '' : _planSettings.annualPensionWithdrawal.toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">연금 수령기간(년)</div><input type="number" id="pension-withdrawal-years" value="${_planSettings.pensionWithdrawalYears ?? ''}" min="1" max="60" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">연금계좌 수익률(%)</div><input type="number" id="pension-return-rate" value="${_planSettings.pensionReturnRate ?? ''}" min="0" max="20" step="0.1" style="width:100%"/></div>
      <div><div class="lbl-62-muted-3">연금수령 세율 가정(%)</div><input type="number" id="pension-tax-rate" value="${_planSettings.pensionTaxRate ?? ''}" min="0" max="100" step="0.1" style="width:100%"/></div>
    </div>
    ${retirement.pensionSettingsMissing ? '<div class="retirement-cashflow-note" style="color:var(--amber)">⚠️ 연금 수령설정 미입력: 연금자산을 생활비에 자동 투입하지 않으며 은퇴 가능 여부를 확정하지 않습니다.</div>' : ''}
    ${loanDateValidation.warnings.length ? `<div class="retirement-cashflow-note" style="color:var(--amber)">⚠️ ${loanDateValidation.warnings.join(' ')}</div>` : ''}
    <button data-plan-action="save-retirement" class="btn-purple-sm" style="margin-bottom:14px">💾 은퇴 기준 저장</button>

    <div class="retire-flow-grid retire-flow-grid-single">
      <div class="s2-rounded">
        <div class="lbl-62-muted-3">목표 도달 예상</div>
        <div style="font-size:.86rem;font-weight:800;color:${yearsToTarget === 0 ? 'var(--green)' : 'var(--amber)'}">${yearsToTarget === 0 ? '현재 충족' : yearsToTarget ? `약 ${yearsToTarget}년` : '계산 불가'}</div>
        <div class="caption-text">월 추가 투자 ${fmt(monthlyInvest)} · 목표 도달 전 연 ${retireReturn}% 가정</div>
      </div>
    </div>
    <div style="font-size:.62rem;color:var(--muted);margin:-7px 0 12px">배당 생활비 충당률은 상단 ‘포트폴리오 배당·은퇴 현황’에서 확인합니다.</div>

    <div class="retirement-cashflow-heading">연도별 은퇴 현금흐름</div>
    <div class="retirement-cashflow-note">축적기의 주담대 원금·이자는 실제 스케줄 확인용이며 월 추가투자액을 이미 순투자금으로 보아 금융자산에서 다시 차감하지 않습니다. 은퇴기에는 원금과 이자를 금융자산에서 차감합니다.<br>${retirementLoanSummary.years.length ? `등록 스케줄 ${retirementLoanSummary.years[0].year}~${retirementLoanSummary.years[retirementLoanSummary.years.length-1].year}년 · 표 반영 ${loanYearsInTable}개 연도` : '등록된 주담대 상환스케줄이 없습니다.'}</div>
    <div class="retirement-cashflow-wrap">
      <table class="retirement-cashflow-table">
        <thead><tr>
          ${['연도/나이','단계','기초자산','연금 기초','연금수익','연금인출','연금세금','연금 기말','추가투자','투자수익','생활비','주담대 원금','주담대 이자','기타지출','배당·기타소득','기말자산'].map(label=>`<th>${label}</th>`).join('')}
        </tr></thead>
        <tbody>${retirement.rows.map(row=>`<tr class="${row.phase==='retirement'?'is-retirement':'is-accumulation'}">
          <td class="year-cell">${row.year} / ${row.age}세</td><td class="phase-cell">${row.phase==='retirement'?'은퇴':'축적'}</td>
          ${[row.beginningAssets,row.pensionBeginningAssets||0,row.pensionInvestmentReturn||0,row.pensionWithdrawal||0,row.taxExpense||0,row.pensionEndingAssets||0,row.additionalInvestment,row.investmentReturn,row.livingExpense,row.loanPrincipal,row.loanInterest,row.otherExpense,row.availableIncome,row.endingAssets].map(value=>{const money=_formatPlanTableMoney(value);return `<td class="money-cell" title="${money.full}">${money.compact}</td>`;}).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="retire-check-grid">
      ${checkpoints.map(([ok,label])=>`<div class="retire-check-item" style="color:${ok?'var(--text)':'var(--muted)'}">
        <span>${ok?'✅':'▫️'}</span><span>${label}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function _calcYearsToRetirementTarget(initAmt, monthly, gap, annualRate, targetAmt) {
  if (!targetAmt || targetAmt <= 0) return null;
  if (gap <= 0) return 0;
  if ((!monthly || monthly <= 0) && (!annualRate || annualRate <= 0)) return null;
  const monthlyRate = (annualRate || 0) / 100 / 12;
  let current = initAmt || 0;
  for (let m = 1; m <= 60 * 12; m++) {
    current = current * (1 + monthlyRate) + (monthly || 0);
    if (current >= targetAmt) return Math.ceil(m / 12);
  }
  return null;
}

// ════════════════════════════════════
// ⑤ 자산 시뮬레이터
// ════════════════════════════════════
