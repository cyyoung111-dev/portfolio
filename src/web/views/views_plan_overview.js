// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
function _getPlanDividendEntries(dividendRows) {
  const entries = [];
  (dividendRows || []).forEach(dividend => {
    const matching = rows.filter(row => row.name === dividend.name && Number(row.qty || 0) > 0);
    const totalQty = matching.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    matching.forEach(row => entries.push({
      name: dividend.name,
      acct: row.acct,
      taxType: Object.prototype.hasOwnProperty.call(ACCT_TAX_TYPES || {}, row.acct) ? ACCT_TAX_TYPES[row.acct] : '',
      amount: totalQty > 0 ? Number(dividend.annualDiv || 0) * Number(row.qty || 0) / totalQty : 0,
    }));
  });
  return entries;
}

function _buildPlanCashflowOverview() {
  const dividendRows = typeof calcDividends === 'function' ? calcDividends() : [];
  const dividendFlow = PlanCalculations.calculateDividendCashflow({ dividends: _getPlanDividendEntries(dividendRows), year: _planSettings.taxYear || new Date().getFullYear() });
  const liquidity = PlanCalculations.calculateAccountLiquidity({
    accounts: rows.map(row => ({ acct: row.acct, taxType: Object.prototype.hasOwnProperty.call(ACCT_TAX_TYPES || {}, row.acct) ? ACCT_TAX_TYPES[row.acct] : '', evalAmt: row.evalAmt })),
    realEstateValue: REAL_ESTATE?.currentValue,
    loanBalance: LOAN?.balance,
  });
  const annual = dividendFlow.totalGross;
  const actual = dividendRows.reduce((sum, item) => sum + Number(item.actualDiv || 0), 0);
  const dividendNames = new Set(dividendRows.map(item => item.name));
  const dividendCost = rows.filter(row => dividendNames.has(row.name)).reduce((sum, row) => sum + Number(row.costAmt || 0), 0);
  const yieldPct = dividendCost > 0 ? annual / dividendCost * 100 : 0;
  const afterTaxMonthly = dividendFlow.availableMonthly;
  const monthlyExpense = _planNumber(_planSettings.retireMonthlyExpense, 0);
  const dividendCoveragePct = monthlyExpense > 0 ? afterTaxMonthly / monthlyExpense * 100 : null;
  const schedule = Array.isArray(LOAN_SCHEDULE)
    ? [...LOAN_SCHEDULE].sort((a,b)=>String(a?.date||'').localeCompare(String(b?.date||''))) : [];
  const monthKey = typeof _kstMonthStr === 'function' ? _kstMonthStr() : '';
  const currentLoan = monthKey ? [...schedule].reverse().find(item => String(item.date || '') <= monthKey) : null;
  const nextLoan = monthKey ? schedule.find(item => String(item.date || '') >= monthKey) : null;
  const remainingMonths = monthKey ? schedule.filter(item => String(item.date || '') > monthKey).length : 0;
  const balance = Number(currentLoan?.balance ?? LOAN?.balance ?? 0);
  const item = (label, value, sub, color='var(--text)') => `<div class="s2-rounded"><div class="lbl-62-muted-3">${label}</div><div style="font-size:.86rem;font-weight:800;color:${color}">${value}</div><div class="caption-text mt-2">${sub}</div></div>`;
  return `<div class="card-12-p20" id="plan-cashflow" data-plan-section="cashflow">
    <div class="flex-between-mb14"><div><h4 class="h3-card">💰 포트폴리오 배당·은퇴 현황</h4><div class="caption-text mt-3">현재 보유수량과 등록된 배당정보 기준 · 확정 지급액과 향후 예상액 포함</div></div><div style="display:flex;gap:6px"><button type="button" class="btn-ghost-sm" data-plan-action="open-dividend">배당 상세</button></div></div>
    <div class="retire-metric-grid">
      ${item('연간 예상 배당 (세전)', fmt(annual), `${dividendRows.length}개 종목`, 'var(--green)')}
      ${item('일반계좌 세후 참고', fmt(dividendFlow.normalAfterTax), `세전 ${fmt(dividendFlow.normalGross)} · 단순 원천징수 기준`, 'var(--cyan)')}
      ${item('올해 확정 배당', fmt(Math.round(actual)), '등록된 실제 배당 이벤트 합계', 'var(--gold)')}
      ${item('향후 예상 배당', fmt(Math.max(0, Math.round(annual-actual))), '연간 예상 - 올해 확정', 'var(--green)')}
      ${item('현재 사용 가능 월 배당', fmt(afterTaxMonthly), '일반계좌 세후 참고액만 포함', 'var(--amber)')}
      ${item('ISA 내부 연간 배당', fmt(dividendFlow.isaInternal), 'ISA 내부 재투자 가능액', 'var(--purple-lt)')}
      ${item('연금저축 내부 배당', fmt(dividendFlow.pensionSavingsInternal), '55세 전 생활비에서 제외', 'var(--purple-lt)')}
      ${item('IRP 내부 연간 배당', fmt(dividendFlow.irpInternal), '55세 전 생활비에서 제외', 'var(--purple-lt)')}
      ${item('배당수익률', `${yieldPct.toFixed(2)}%`, `배당 종목 매입금액 ${fmt(dividendCost)}`, 'var(--purple-lt)')}
    </div>
    <div class="caption-text mt-8">배당수익률 분모는 배당 종목의 매입금액입니다. 일반계좌 세후액은 단순 원천징수 기준 참고값이며 ISA·연금계좌 배당에는 즉시 차감하지 않습니다.</div>
    ${dividendFlow.warnings.length ? `<div style="font-size:.62rem;color:var(--amber);margin-top:6px">⚠️ ${dividendFlow.warnings.map(_escapeHtml).join(' · ')}</div>` : ''}
    <div style="height:1px;background:var(--border);margin:12px 0"></div>
    <div class="retire-metric-grid">
      ${item('총 금융자산', fmt(liquidity.totalFinancialAssets), '부동산 제외', 'var(--text)')}
      ${item('55세 전 가용자산', fmt(liquidity.availableBefore55), '일반계좌 + ISA', 'var(--green)')}
      ${item('ISA 평가자산', fmt(liquidity.isaAssets), 'ISA 내부자금', 'var(--purple-lt)')}
      ${item('55세 이후 연금자산', fmt(liquidity.pensionAssets), '연금저축 + IRP', 'var(--cyan)')}
      ${item('부동산 시가', fmt(liquidity.realEstateValue), '생활비 운용자산에는 미포함', 'var(--gold)')}
      ${item('주담대 잔액', fmt(liquidity.loanBalance), '순자산에서 차감', 'var(--red-lt)')}
      ${item('총순자산', fmt(liquidity.totalNetWorth), '금융자산 + 부동산 - 주담대', 'var(--amber)')}
    </div>
    ${liquidity.warnings.length ? `<div style="font-size:.62rem;color:var(--amber);margin-top:6px">⚠️ ${liquidity.warnings.map(_escapeHtml).join(' · ')}</div>` : ''}
    <div style="height:1px;background:var(--border);margin:12px 0"></div>
    <div class="flex-between-mb14"><div><h4 class="h3-card">🏠 주담대 상환스케줄</h4><div class="caption-text mt-3">${schedule.length ? `${schedule[0]?.date || '-'} ~ ${schedule[schedule.length-1]?.date || '-'} · 총 ${schedule.length}개월` : '등록된 상환스케줄이 없습니다.'}</div></div><button type="button" class="btn-ghost-sm" data-plan-action="open-property">부동산·스케줄</button></div>
    ${currentLoan ? `<div class="retire-metric-grid">
      ${item('스케줄 기준 대출잔액', fmt(balance), `${currentLoan.date} 기준`, 'var(--red-lt)')}
      ${item('다음 납입 원금', nextLoan ? fmt(Number(nextLoan.principal||0)) : '-', nextLoan ? `${nextLoan.date} 예정` : '남은 일정 없음', 'var(--cyan)')}
      ${item('다음 납입 이자', nextLoan ? fmt(Number(nextLoan.interest||0)) : '-', nextLoan ? `${nextLoan.date} 예정` : '남은 일정 없음', 'var(--amber)')}
      ${item('남은 상환기간', `${remainingMonths}개월`, schedule.length ? `최종 ${schedule[schedule.length-1]?.date || '-'}` : '-', 'var(--purple-lt)')}
    </div>` : '<div class="caption-text">부동산 탭에서 상환스케줄을 등록하면 대출잔액·다음 원금·이자·남은 기간을 표시합니다.</div>'}
  </div>`;
}

// ════════════════════════════════════
// ① 목표 비중 관리
// ════════════════════════════════════
