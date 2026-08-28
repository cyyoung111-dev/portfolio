// ════════════════════════════════════════════════════════════════
//  views_plan.js — 투자 계획 탭
//  목표비중 관리 · 매수여력 계산기 · 세금 시뮬레이터 · 자산 시뮬레이터
//  의존: data.js, portfolio_service.js, core_ui.js, core_color.js
// ════════════════════════════════════════════════════════════════

// ── 상태
const PLAN_KEY = 'pf_plan_settings';
function _planNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

let _planSettings = (function() {
  try {
    const s = lsGet(PLAN_KEY, {});
    return {
      cash:          _planNumber(s.cash, 0),         // 현재 보유 현금 (원)
      // ★ [한국 세제 반영] ISA 비과세 유형: general(일반형 200만) | special(서민형/농어민 400만)
      isaExemptType: s.isaExemptType || 'general',
      // ★ [정확한 배당 추적] 세금 계산 귀속연도 (기본값: 올해)
      taxYear:       s.taxYear       || null,
      simMonthly:    _planNumber(s.simMonthly, 500000),     // 월 추가 투자금
      simYears:      _planNumber(s.simYears, 10),            // 시뮬레이션 기간 (년)
      simReturn:     _planNumber(s.simReturn, 7),            // 연 수익률 가정 %
      retireMonthlyExpense: _planNumber(s.retireMonthlyExpense, 3000000), // 은퇴 후 월 생활비 목표
      retireYears:          _planNumber(s.retireYears, 30),                // 은퇴자금 지속 기간(참고)
      retireReturn:         _planNumber(s.retireReturn, 4),                // 목표 도달 연 수익률 가정 %
      retirePostReturn:     _planNumber(s.retirePostReturn, 3),
      retireInflation:      _planNumber(s.retireInflation, 2),
      retireCurrentAge:     _planNumber(s.retireCurrentAge, 40),
      retireTargetAge:      _planNumber(s.retireTargetAge, 60),
      retireExtraExpense:   _planNumber(s.retireExtraExpense, 0),
      retireOtherIncome:    _planNumber(s.retireOtherIncome, 0),
      retireLoanMode:       s.retireLoanMode === 'payoff' ? 'payoff' : 'maintain',
      retireWithdrawalRate: _planNumber(s.retireWithdrawalRate, 4),        // 안전 인출률 %
    };
  } catch(e) { return { cash:0, isaExemptType:'general', simMonthly:500000, simYears:10, simReturn:7, retireMonthlyExpense:3000000, retireYears:30, retireReturn:4, retireWithdrawalRate:4 }; }
})();

function _savePlanSettings() {
  lsSave(PLAN_KEY, _planSettings);
}

// ── 메인 렌더
function renderPlanView(area) {
  const totalEval  = rows.reduce((s, r) => s + (r.evalAmt || 0), 0);
  const totalCost  = rows.reduce((s, r) => s + (r.costAmt || 0), 0);

  const viewHtml = `
<div data-view-section="plan" style="display:flex;flex-direction:column;gap:20px;padding:4px 0">

  <nav class="plan-section-nav" aria-label="투자계획 섹션 바로가기">
    <a href="#plan-cashflow">현금흐름</a><a href="#plan-export">엑셀</a><a href="#plan-weights">목표비중</a><a href="#plan-tax">세금</a><a href="#plan-retirement">은퇴</a><a href="#plan-simulation">시뮬레이션</a>
  </nav>

  <!-- 배당·부동산·주담대 통합 현황 -->
  ${_buildPlanCashflowOverview()}

  <!-- ⓪ 엑셀 내보내기 -->
  ${_buildExportSection(totalEval, totalCost)}

  <!-- ① 목표 비중 관리 -->
  ${_buildWeightSection(totalEval)}

  <!-- ② 매수 여력 계산기 -->
  ${_buildBuyingPowerSection(totalEval)}

  <!-- ③ 세금 시뮬레이터 -->
  ${_buildTaxSection(totalCost)}

  <!-- ④ 은퇴 포트폴리오 점검 -->
  ${_buildRetirementSection(totalEval)}

  <!-- ⑤ 자산 시뮬레이터 -->
  ${_buildSimSection(totalEval)}

</div>`;

  const template = document.createElement('template');
  template.innerHTML = viewHtml.trim();
  area.replaceChildren(template.content);
  _bindPlanEvents(area, totalEval, totalCost);
}

// ════════════════════════════════════
// ⓪ 엑셀 내보내기
// ════════════════════════════════════
function _buildExportSection(totalEval, totalCost) {
  const totalPnl = totalEval - totalCost;
  const acctCount = new Set(rows.map(r => r.acct).filter(Boolean)).size;
  const stockCount = rows.length;
  return `<div class="card-12-p20" id="plan-export">
    <div class="flex-between-mb14">
      <h4 class="h3-card">📊 포트폴리오 엑셀 내보내기</h4>
      <button data-plan-action="export-excel" class="btn-purple-sm">📥 엑셀 다운로드</button>
    </div>
    <div class="plan-export-grid">
      ${[
        ['계좌 수', `${acctCount}개`],
        ['종목 수', `${stockCount}개`],
        ['총 평가금액', fmt(totalEval)],
        ['총 손익', `${pSign(totalPnl)}${fmt(Math.abs(totalPnl))}`],
      ].map(([l,v])=>`<div class="s2-rounded">
        <div class="lbl-62-muted-3">${l}</div>
        <div class="fw-600">${v}</div>
      </div>`).join('')}
    </div>
    <div style="font-size:.68rem;color:var(--muted);margin-top:10px">
      종목별 상세 · 계좌/섹터 요약 · 배당 현황 · 은퇴 계획 · 부동산·주담대 · 상환스케줄을 함께 받습니다.
    </div>
  </div>`;
}

// 현재 보유 종목(rows)을 엑셀(.xlsx)로 내보내기
// 시트1: 종목별 상세 (계좌/종목/유형/섹터/수량/단가/평가금액/손익/수익률/통화)
// 시트2: 계좌별 요약
// 시트3: 섹터별 요약
let _portfolioExportBusy = false;
function exportPortfolioExcel() {
  if (_portfolioExportBusy) return;
  if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
  const hasPortfolio = Array.isArray(rows) && rows.length > 0;
  const hasRealEstate = Number(REAL_ESTATE?.currentValue || REAL_ESTATE?.purchasePrice || 0) > 0;
  const hasLoan = Number(LOAN?.originalAmt || LOAN?.balance || 0) > 0 || (Array.isArray(LOAN_SCHEDULE) && LOAN_SCHEDULE.length > 0);
  if (!hasPortfolio && !hasRealEstate && !hasLoan) { showToast('내보낼 자산 데이터가 없습니다', 'warn'); return; }
  _portfolioExportBusy = true;
  setTimeout(() => { _portfolioExportBusy = false; }, 2000); // 중간 오류가 발생해도 잠금 자동 해제

  const wb = XLSX.utils.book_new();
  const todayStr = (typeof _kstTodayStr === 'function') ? _kstTodayStr() : new Date().toISOString().slice(0,10);

  // ── 시트1: 종목별 상세
  const headerRow1 = ['계좌','종목명','종목코드','유형','섹터','수량','매입단가','매입금액','현재단가','평가금액','손익','수익률(%)','통화'];
  const dataRows1 = [...rows]
    .sort((a,b) => (b.evalAmt||0) - (a.evalAmt||0))
    .map(r => [
      r.acct || '',
      r.name || '',
      r.code || '',
      r.type || '',
      r.sector || '기타',
      r.qty != null ? r.qty : '',
      Math.round(r.cost || 0),
      Math.round(r.costAmt || 0),
      Math.round(r.price || 0),
      Math.round(r.evalAmt || 0),
      Math.round(r.pnl || 0),
      Number((r.pct || 0).toFixed(2)),
      (r.currency || 'KRW'),
    ]);
  const totalEval1 = rows.reduce((s,r)=>s+(r.evalAmt||0),0);
  const totalCost1 = rows.reduce((s,r)=>s+(r.costAmt||0),0);
  const totalPnl1  = totalEval1 - totalCost1;
  const totalPct1  = totalCost1 > 0 ? (totalPnl1/totalCost1*100) : 0;
  const footerRow1 = ['합계','','','','','','', Math.round(totalCost1), '', Math.round(totalEval1), Math.round(totalPnl1), Number(totalPct1.toFixed(2)), ''];

  const ws1 = XLSX.utils.aoa_to_sheet([headerRow1, ...dataRows1, footerRow1]);
  ws1['!cols'] = [
    {wch:10},{wch:18},{wch:10},{wch:8},{wch:10},
    {wch:10},{wch:12},{wch:14},{wch:12},{wch:14},
    {wch:14},{wch:10},{wch:8},
  ];
  // 헤더 스타일
  headerRow1.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:0, c:i });
    if (ws1[cell]) ws1[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  // 합계 행 스타일
  const footerIdx = dataRows1.length + 1;
  footerRow1.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:footerIdx, c:i });
    if (ws1[cell]) ws1[cell].s = { font:{bold:true}, fill:{fgColor:{rgb:'F1F5F9'}} };
  });
  XLSX.utils.book_append_sheet(wb, ws1, '종목별 상세');

  // ── 시트2: 계좌별 요약
  const acctMap = {};
  rows.forEach(r => {
    const acct = r.acct || '미분류';
    if (!acctMap[acct]) acctMap[acct] = { evalAmt:0, costAmt:0, count:0 };
    acctMap[acct].evalAmt += (r.evalAmt || 0);
    acctMap[acct].costAmt += (r.costAmt || 0);
    acctMap[acct].count   += 1;
  });
  const headerRow2 = ['계좌','종목 수','매입금액','평가금액','손익','수익률(%)','비중(%)'];
  const dataRows2 = Object.entries(acctMap)
    .sort((a,b) => b[1].evalAmt - a[1].evalAmt)
    .map(([acct, v]) => {
      const pnl = v.evalAmt - v.costAmt;
      const pct = v.costAmt > 0 ? (pnl/v.costAmt*100) : 0;
      const weight = totalEval1 > 0 ? (v.evalAmt/totalEval1*100) : 0;
      return [acct, v.count, Math.round(v.costAmt), Math.round(v.evalAmt), Math.round(pnl), Number(pct.toFixed(2)), Number(weight.toFixed(1))];
    });
  const ws2 = XLSX.utils.aoa_to_sheet([headerRow2, ...dataRows2,
    ['합계', rows.length, Math.round(totalCost1), Math.round(totalEval1), Math.round(totalPnl1), Number(totalPct1.toFixed(2)), 100]]);
  ws2['!cols'] = [{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:10},{wch:10}];
  headerRow2.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:0, c:i });
    if (ws2[cell]) ws2[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  const footer2Idx = dataRows2.length + 1;
  headerRow2.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:footer2Idx, c:i });
    if (ws2[cell]) ws2[cell].s = { font:{bold:true}, fill:{fgColor:{rgb:'F1F5F9'}} };
  });
  XLSX.utils.book_append_sheet(wb, ws2, '계좌별 요약');

  // ── 시트3: 섹터별 요약
  const secMap = {};
  rows.forEach(r => {
    const sec = r.sector || '기타';
    if (!secMap[sec]) secMap[sec] = { evalAmt:0, costAmt:0, count:0 };
    secMap[sec].evalAmt += (r.evalAmt || 0);
    secMap[sec].costAmt += (r.costAmt || 0);
    secMap[sec].count   += 1;
  });
  const headerRow3 = ['섹터','종목 수','매입금액','평가금액','손익','수익률(%)','비중(%)'];
  const dataRows3 = Object.entries(secMap)
    .sort((a,b) => b[1].evalAmt - a[1].evalAmt)
    .map(([sec, v]) => {
      const pnl = v.evalAmt - v.costAmt;
      const pct = v.costAmt > 0 ? (pnl/v.costAmt*100) : 0;
      const weight = totalEval1 > 0 ? (v.evalAmt/totalEval1*100) : 0;
      return [sec, v.count, Math.round(v.costAmt), Math.round(v.evalAmt), Math.round(pnl), Number(pct.toFixed(2)), Number(weight.toFixed(1))];
    });
  const ws3 = XLSX.utils.aoa_to_sheet([headerRow3, ...dataRows3,
    ['합계', rows.length, Math.round(totalCost1), Math.round(totalEval1), Math.round(totalPnl1), Number(totalPct1.toFixed(2)), 100]]);
  ws3['!cols'] = [{wch:14},{wch:8},{wch:14},{wch:14},{wch:14},{wch:10},{wch:10}];
  headerRow3.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:0, c:i });
    if (ws3[cell]) ws3[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  const footer3Idx = dataRows3.length + 1;
  headerRow3.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:footer3Idx, c:i });
    if (ws3[cell]) ws3[cell].s = { font:{bold:true}, fill:{fgColor:{rgb:'F1F5F9'}} };
  });
  XLSX.utils.book_append_sheet(wb, ws3, '섹터별 요약');

  // ── 시트4: 부동산·주담대 요약 (현재 시세 포함)
  const currentValue = Number(REAL_ESTATE?.currentValue || 0);
  const purchasePrice = Number(REAL_ESTATE?.purchasePrice || 0);
  const taxCost = Number(REAL_ESTATE?.taxCost || 0);
  const interiorCost = Number(REAL_ESTATE?.interiorCost || 0);
  const etcCost = Number(REAL_ESTATE?.etcCost || 0);
  const totalAcquisition = purchasePrice + taxCost + interiorCost + etcCost;
  const loanBalance = Number(LOAN?.balance || 0);
  const realEstateRows = [
    ['구분','항목','값','비고'],
    ['부동산','자산명', REAL_ESTATE?.name || '보유 부동산',''],
    ['부동산','현재 시세', Math.round(currentValue),'최근 입력 시세'],
    ['부동산','매입가', Math.round(purchasePrice),''],
    ['부동산','취득세 등', Math.round(taxCost),''],
    ['부동산','인테리어 비용', Math.round(interiorCost),''],
    ['부동산','기타 비용', Math.round(etcCost),''],
    ['부동산','총 취득원가', Math.round(totalAcquisition),'매입가와 부대비용 합계'],
    ['부동산','평가손익', Math.round(currentValue - totalAcquisition),'현재 시세 - 총 취득원가'],
    ['주담대','최초 대출금', Math.round(Number(LOAN?.originalAmt || 0)),''],
    ['주담대','현재 대출잔액', Math.round(loanBalance),''],
    ['주담대','금리(%)', Number(LOAN?.annualRate || 0),'연 금리'],
    ['주담대','대출 실행일', LOAN?.startDate || '',''],
    ['주담대','전체 상환개월', Number(LOAN?.totalMonths || 0),''],
    ['주담대','남은 상환개월', Number(LOAN?.remainingMonths || 0),''],
    ['주담대','이번 달 이자', Math.round(Number(LOAN?.monthlyInterestPaid || 0)),''],
    ['주담대','누적 납부이자', Math.round(Number(LOAN?.totalInterestPaid || 0)),''],
    ['순자산','부동산 순자산', Math.round(currentValue - loanBalance),'현재 시세 - 현재 대출잔액'],
    ['메모','부동산 메모', REAL_ESTATE?.memo || '',''],
  ];
  const ws4 = XLSX.utils.aoa_to_sheet(realEstateRows);
  ws4['!cols'] = [{wch:10},{wch:18},{wch:16},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws4, '부동산·주담대');

  // ── 시트5: 주담대 월별 상환스케줄
  const scheduleRows = [['상환월','상환 후 잔액','원금','이자'],
    ...(Array.isArray(LOAN_SCHEDULE) ? LOAN_SCHEDULE : []).map(item => [
      item?.date || '',
      Math.round(Number(item?.balance || 0)),
      Math.round(Number(item?.principal || 0)),
      Math.round(Number(item?.interest || 0)),
    ])
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(scheduleRows);
  ws5['!cols'] = [{wch:12},{wch:16},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws5, '주담대 상환스케줄');

  // ── 시트6: 종목별 배당 현황
  const dividendRows = typeof calcDividends === 'function' ? calcDividends() : [];
  const dividendSheetRows = [['종목명','유형','보유수량','보유계좌','연간 예상 배당','올해 확정 배당','월평균 예상 배당'],
    ...dividendRows.map(item => [
      item.name || '', item.assetType || '', Number(item.totalQty || 0), (item.accts || []).join(', '),
      Math.round(Number(item.annualDiv || 0)), Math.round(Number(item.actualDiv || 0)), Math.round(Number(item.annualDiv || 0) / 12),
    ]),
    ['합계','','','',Math.round(dividendRows.reduce((s,item)=>s+Number(item.annualDiv||0),0)),
      Math.round(dividendRows.reduce((s,item)=>s+Number(item.actualDiv||0),0)),
      Math.round(dividendRows.reduce((s,item)=>s+Number(item.annualDiv||0),0) / 12)]
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(dividendSheetRows);
  ws6['!cols'] = [{wch:24},{wch:10},{wch:12},{wch:24},{wch:16},{wch:16},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws6, '배당 현황');

  // ── 시트7: 저장된 은퇴 계획과 현금흐름 기준
  const annualDividend = dividendRows.reduce((s,item)=>s+Number(item.annualDiv||0),0);
  const retirementRows = [
    ['항목','값','비고'],
    ['목표 월 생활비', Number(_planSettings.retireMonthlyExpense || 0),'저장된 투자계획 기준'],
    ['안전 인출률(%)', Number(_planSettings.retireWithdrawalRate || 0),''],
    ['은퇴 후 기간(년)', Number(_planSettings.retireYears || 0),''],
    ['목표 도달 수익률(%)', Number(_planSettings.retireReturn || 0),''],
    ['현재 평가자산', Math.round(totalEval1),''],
    ['연간 예상 배당(세전)', Math.round(annualDividend),'배당 현황 합계'],
    ['월평균 예상 배당(세전)', Math.round(annualDividend / 12),''],
    ['월평균 참고 배당(15.4% 차감)', Math.round(annualDividend * 0.846 / 12),'일반계좌 일괄 가정'],
  ];
  const ws7 = XLSX.utils.aoa_to_sheet(retirementRows);
  ws7['!cols'] = [{wch:28},{wch:18},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws7, '은퇴 계획');

  try {
    XLSX.writeFile(wb, `포트폴리오_${todayStr.replace(/-/g,'')}.xlsx`);
    showToast('📥 엑셀 다운로드 완료', 'ok');
  } finally {
    setTimeout(() => { _portfolioExportBusy = false; }, 500);
  }
}

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
  const remainingMonths = monthKey ? schedule.filter(item => String(item.date || '') >= monthKey).length : 0;
  const balance = Number(currentLoan?.balance ?? LOAN?.balance ?? 0);
  const item = (label, value, sub, color='var(--text)') => `<div class="s2-rounded"><div class="lbl-62-muted-3">${label}</div><div style="font-size:.86rem;font-weight:800;color:${color}">${value}</div><div style="font-size:.61rem;color:var(--muted);margin-top:2px">${sub}</div></div>`;
  return `<div class="card-12-p20" id="plan-cashflow" data-plan-section="cashflow">
    <div class="flex-between-mb14"><div><h4 class="h3-card">💰 포트폴리오 배당·은퇴 현황</h4><div style="font-size:.62rem;color:var(--muted);margin-top:3px">현재 보유수량과 등록된 배당정보 기준 · 확정 지급액과 향후 예상액 포함</div></div><div style="display:flex;gap:6px"><button type="button" class="btn-ghost-sm" data-plan-action="open-dividend">배당 상세</button></div></div>
    <div class="retire-metric-grid">
      ${item('연간 예상 배당 (세전)', fmt(annual), `${dividendRows.length}개 종목`, 'var(--green)')}
      ${item('일반계좌 세후 참고', fmt(dividendFlow.normalAfterTax), `세전 ${fmt(dividendFlow.normalGross)} · 단순 원천징수 기준`, 'var(--cyan)')}
      ${item('올해 확정 배당', fmt(Math.round(actual)), '등록된 실제 배당 이벤트 합계', 'var(--gold)')}
      ${item('현재 사용 가능 월 배당', fmt(afterTaxMonthly), '일반계좌 세후 참고액만 포함', 'var(--amber)')}
      ${item('ISA 내부 연간 배당', fmt(dividendFlow.isaInternal), 'ISA 내부 재투자 가능액', 'var(--purple-lt)')}
      ${item('연금저축 내부 배당', fmt(dividendFlow.pensionSavingsInternal), '55세 전 생활비에서 제외', 'var(--purple-lt)')}
      ${item('IRP 내부 연간 배당', fmt(dividendFlow.irpInternal), '55세 전 생활비에서 제외', 'var(--purple-lt)')}
      ${item('배당수익률', `${yieldPct.toFixed(2)}%`, `배당 종목 매입금액 ${fmt(dividendCost)}`, 'var(--purple-lt)')}
    </div>
    <div style="font-size:.60rem;color:var(--muted);margin-top:8px">배당수익률 분모는 배당 종목의 매입금액입니다. 일반계좌 세후액은 단순 원천징수 기준 참고값이며 ISA·연금계좌 배당에는 즉시 차감하지 않습니다.</div>
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
    <div class="flex-between-mb14"><div><h4 class="h3-card">🏠 주담대 상환스케줄</h4><div style="font-size:.62rem;color:var(--muted);margin-top:3px">${schedule.length ? `${schedule[0]?.date || '-'} ~ ${schedule[schedule.length-1]?.date || '-'} · 총 ${schedule.length}개월` : '등록된 상환스케줄이 없습니다.'}</div></div><button type="button" class="btn-ghost-sm" data-plan-action="open-property">부동산·스케줄</button></div>
    ${currentLoan ? `<div class="retire-metric-grid">
      ${item('스케줄 기준 대출잔액', fmt(balance), `${currentLoan.date} 기준`, 'var(--red-lt)')}
      ${item('다음 납입 원금', nextLoan ? fmt(Number(nextLoan.principal||0)) : '-', nextLoan ? `${nextLoan.date} 예정` : '남은 일정 없음', 'var(--cyan)')}
      ${item('다음 납입 이자', nextLoan ? fmt(Number(nextLoan.interest||0)) : '-', nextLoan ? `${nextLoan.date} 예정` : '남은 일정 없음', 'var(--amber)')}
      ${item('남은 상환기간', `${remainingMonths}개월`, schedule.length ? `최종 ${schedule[schedule.length-1]?.date || '-'}` : '-', 'var(--purple-lt)')}
    </div>` : '<div style="font-size:.65rem;color:var(--muted)">부동산 탭에서 상환스케줄을 등록하면 대출잔액·다음 원금·이자·남은 기간을 표시합니다.</div>'}
  </div>`;
}

// ════════════════════════════════════
// ① 목표 비중 관리
// ════════════════════════════════════
function _buildWeightSection(totalEval) {
  const items = _getWeightItems(totalEval);
  const totalTarget = items.reduce((s, i) => s + (i.targetPct || 0), 0);
  const overTarget = totalTarget > 100;

  const rows_html = items.map(item => {
    const bar_current = Math.min(100, item.currentPct).toFixed(1);
    const bar_target  = Math.min(100, item.targetPct || 0).toFixed(1);
    const diff        = (item.targetPct || 0) - item.currentPct;
    const diffColor   = Math.abs(diff) < 1 ? 'var(--muted)' : diff > 0 ? 'var(--green)' : 'var(--red)';
    const diffLabel   = Math.abs(diff) < 0.1 ? '균형' : (diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`);
    const sectorColor = SECTOR_COLORS[item.sector] || 'var(--muted)';

    return `<div style="display:grid;grid-template-columns:110px 1fr 60px 60px 70px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:.73rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_escapeHtml(item.name)}">${_escapeHtml(item.name)}</div>
      <div style="position:relative;height:18px;background:var(--s2);border-radius:4px;overflow:hidden">
        <div style="position:absolute;left:0;top:0;height:100%;width:${bar_current}%;background:${resolveColor(sectorColor)};opacity:.7;border-radius:4px;transition:width .3s"></div>
        ${item.targetPct > 0 ? `<div style="position:absolute;top:0;left:${bar_target}%;width:2px;height:100%;background:var(--amber);border-radius:1px"></div>` : ''}
      </div>
      <div style="font-size:.72rem;color:var(--muted);text-align:right">${item.currentPct.toFixed(1)}%</div>
      <div style="text-align:right">
        <input type="number" min="0" max="100" step="0.5"
          data-plan-weight="${_escapeHtml(item.name)}"
          value="${item.targetPct || ''}"
          placeholder="0"
          style="width:52px;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:3px 5px;color:var(--text);font-size:.72rem;text-align:right"/>
      </div>
      <div style="font-size:.72rem;font-weight:600;color:${diffColor};text-align:right">${diffLabel}</div>
    </div>`;
  }).join('');

  return `<div class="card-12-p20" id="plan-weights">
    <div class="flex-between-mb14">
      <h4 class="h3-card">🎯 목표 비중 관리</h4>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:.68rem;color:${overTarget?'var(--red-lt)':'var(--muted)'}">합계 ${totalTarget.toFixed(1)}% ${overTarget?'⚠️ 100% 초과':''}</span>
        <button data-plan-action="save-weights" class="btn-purple-sm">💾 저장</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:110px 1fr 60px 60px 70px;gap:8px;margin-bottom:6px">
      <div class="lbl-62-muted-3">종목</div>
      <div class="lbl-62-muted-3">현재 / 목표</div>
      <div class="lbl-62-muted-3" style="text-align:right">현재</div>
      <div class="lbl-62-muted-3" style="text-align:right">목표%</div>
      <div class="lbl-62-muted-3" style="text-align:right">차이</div>
    </div>
    ${rows_html || '<div style="color:var(--muted);font-size:.75rem;padding:12px 0">보유 종목이 없습니다</div>'}
  </div>`;
}

function _getWeightItems(totalEval) {
  // 종목별 합산 (계좌 구분 없이)
  const merged = {};
  rows.forEach(r => {
    if (!r.name) return;
    if (!merged[r.name]) merged[r.name] = { name: r.name, evalAmt: 0, sector: r.sector || '기타' };
    merged[r.name].evalAmt += (r.evalAmt || 0);
  });
  return Object.values(merged).map(m => {
    const ep = getEP(m.name);
    return {
      name:       m.name,
      sector:     m.sector,
      evalAmt:    m.evalAmt,
      currentPct: totalEval > 0 ? m.evalAmt / totalEval * 100 : 0,
      targetPct:  Number(ep?.targetWeight || 0),
    };
  }).sort((a, b) => b.evalAmt - a.evalAmt);
}

// ════════════════════════════════════
// ② 매수 여력 계산기
// ════════════════════════════════════
function _buildBuyingPowerSection(totalEval) {
  const cash        = _planSettings.cash || 0;
  const totalAssets = totalEval + cash;
  const items       = _getWeightItems(totalEval);
  const hastarget   = items.some(i => i.targetPct > 0);

  let recHtml = '';
  if (hastarget && cash > 0) {
    const recs = _calcBuyingPower(items, totalEval, cash);
    recHtml = recs.length > 0
      ? recs.map(r => {
          const color = resolveColor(SECTOR_COLORS[r.sector] || 'var(--muted)');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--s2);border-radius:8px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
              <span style="font-size:.75rem;font-weight:600;color:var(--text)">${_escapeHtml(r.name)}</span>
            </div>
            <div style="text-align:right">
              <div style="font-size:.80rem;font-weight:700;color:var(--green)">+${fmt(r.buyAmt)}</div>
              <div style="font-size:.65rem;color:var(--muted)">${r.currentPct.toFixed(1)}% → ${r.targetPct.toFixed(1)}%</div>
            </div>
          </div>`;
        }).join('')
      : `<div style="font-size:.73rem;color:var(--muted);padding:10px 0">목표 비중이 현재 비중보다 높은 종목이 없습니다</div>`;
  } else if (!hastarget) {
    recHtml = `<div style="font-size:.73rem;color:var(--muted);padding:10px 0">① 목표 비중을 먼저 설정하세요</div>`;
  } else {
    recHtml = `<div style="font-size:.73rem;color:var(--muted);padding:10px 0">현금을 입력하면 매수 추천이 표시됩니다</div>`;
  }

  return `<div class="card-12-p20">
    <h4 class="h3-card" style="margin-bottom:14px">💰 매수 여력 계산기</h4>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <div class="lbl-62-muted-3">보유 현금 (원)</div>
        <input type="text" id="plan-cash-input" value="${cash > 0 ? cash.toLocaleString() : ''}" placeholder="10,000,000"
          data-format="number-comma"
          style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.78rem;width:160px"/>
      </div>
      <button data-plan-action="calc-buying-power" class="btn-purple-sm">계산</button>
    </div>
    ${cash > 0 ? `
    <div class="plan-metric-grid">
      ${[['💰 현금', fmt(cash)],['📈 주식 평가액', fmt(totalEval)],['🏦 총 자산', fmt(totalAssets)]].map(([l,v])=>`
      <div class="s2-rounded"><div class="lbl-62-muted-3">${l}</div><div class="fw-600 c-amber">${v}</div></div>`).join('')}
    </div>` : ''}
    <div id="plan-buying-recs">${recHtml}</div>
  </div>`;
}

function _calcBuyingPower(items, totalEval, cash) {
  const result = PlanCalculations.calculateBuyingRecommendations({
    currentTotalValue: totalEval,
    newCash: cash,
    items: items.map(item => ({ ...item, currentValue: item.evalAmt, price: rows.find(row => row.name === item.name)?.price })),
  });
  return result.recommendations.filter(item => item.buyAmount >= 1000).map(item => ({ ...item, buyAmt: item.buyAmount }));
}

// ════════════════════════════════════
// ③ 세금 시뮬레이터
// ════════════════════════════════════
function _buildTaxSection(totalCost) {
  // ★ [한국 세제 반영] 일반계좌는 매매차익 비과세(거래세만 발생), 배당/이자만 과세
  //   - 일반: 배당소득세 15.4% 원천징수, 연 2천만원 초과 시 금융소득종합과세 대상
  //   - ISA : 손익(매매차익+배당) 통산 후 200만원(서민형 400만원) 비과세, 초과분 9.9% 분리과세 (종합과세 미포함)
  //   - IRP/연금: 과세이연 — 보유 중에는 비과세, 인출 시에만 연금소득세 3.3~5.5%
  const isaExemptType = _planSettings.isaExemptType || 'general'; // general(200만) | special(400만, 서민형/농어민)

  // ★ [계좌별 taxType] 계좌 기준으로 taxType 결정 — computeRows()에서 r.taxType = getAcctTaxType(r.acct)로 이미 설정됨
  const acctGroups = { '일반': [], 'ISA': [], 'IRP': [], '연금': [] };
  const acctSeen = new Set();
  rows.forEach(r => {
    if (!r.acct || acctSeen.has(r.acct)) return;
    acctSeen.add(r.acct);
    const tx = ['ISA','IRP','연금'].includes(r.taxType) ? r.taxType : '일반';
    acctGroups[tx].push(r.acct);
  });

  function _sumByAccts(accts) {
    let pnl = 0, cost = 0, evalAmt = 0;
    rows.forEach(r => { if (accts.includes(r.acct)) { pnl += (r.pnl||0); cost += (r.costAmt||0); evalAmt += (r.evalAmt||0); } });
    return { pnl, cost, evalAmt };
  }

  // ── [정확한 배당소득 계산] 거래이력 기반으로 계좌별·월별 실제 보유수량 추적
  // 기존 방식(현재 보유비율로 배분)은 계좌 변경/중도매도 시 부정확 → 시점별 정확 계산으로 개선
  // ★ [최적화] 종목별 거래내역을 미리 한 번만 정리해서 재사용 (반복 전체탐색 방지)
  const nowYear = _kstYear ? _kstYear() : new Date().getFullYear();
  const taxYear = _planSettings.taxYear || nowYear;

  const _tradesByName = {};
  rawTrades.forEach(t => {
    if (!t.name) return;
    (_tradesByName[t.name] = _tradesByName[t.name] || []).push(t);
  });
  Object.values(_tradesByName).forEach(arr => arr.sort((a,b) => (a.date||'').localeCompare(b.date||'')));

  const _todayStr = (typeof _kstTodayStr === 'function') ? _kstTodayStr() : new Date().toISOString().slice(0,10);
  function _qtyAtDateFast(name, dateStr, acct) {
    if (dateStr > _todayStr) {
      return rawHoldings.filter(h => h.name === name && !h.fund && (!acct || h.acct === acct))
        .reduce((s, h) => s + (h.qty || 0), 0);
    }
    const arr = _tradesByName[name];
    if (!arr) return 0;
    let qty = 0;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t.date > dateStr) break;
      if (acct && t.acct !== acct) continue;
      if (t.tradeType === 'buy')  qty += (t.qty || 0);
      if (t.tradeType === 'sell') qty -= (t.qty || 0);
    }
    return Math.max(0, qty);
  }

  let totalDivAnnual = 0;
  const divByAcct = {};
  Object.keys(DIVDATA || {}).forEach(divKey => {
    const dd = DIVDATA[divKey];
    if (!dd || !dd.perShare || !Array.isArray(dd.months) || dd.months.length === 0) return;
    const ep = (typeof getEPByCode === 'function') ? getEPByCode(divKey) : null;
    const name = ep?.name || divKey;
    const nameTradesArr = _tradesByName[name] || [];
    const accts = [...new Set(nameTradesArr.map(t => t.acct).filter(Boolean))];
    accts.forEach(acct => {
      dd.months.forEach(month => {
        const refDate = getDivRefDate(taxYear, month);
        const qty = _qtyAtDateFast(name, refDate, acct);
        if (qty > 0) {
          const div = dd.perShare * qty;
          divByAcct[acct] = (divByAcct[acct] || 0) + div;
          totalDivAnnual += div;
        }
      });
    });
  });

  function _divSum(accts) {
    return accts.reduce((s,a) => s + (divByAcct[a] || 0), 0);
  }

  // ── ① 일반계좌
  const normalSum = _sumByAccts(acctGroups['일반']);
  const normalDiv = _divSum(acctGroups['일반']);
  const sellTaxRate = 0.18;
  const estSellTax  = Math.round(normalSum.evalAmt * sellTaxRate / 100);
  const normalDivTax = Math.round(normalDiv * 0.154);

  // ── ② ISA
  const isaSum = _sumByAccts(acctGroups['ISA']);
  const isaDiv = _divSum(acctGroups['ISA']);
  const isaEstimate = PlanCalculations.calculateIsaSettlementEstimate({ unrealizedGain: isaSum.pnl, dividendAndInterest: isaDiv, isaType: isaExemptType, year: taxYear });
  const isaTotalGain = isaEstimate.estimatedNetTaxableProfit;
  const isaExempt = isaEstimate.exemption;
  const isaTaxable = isaEstimate.excess;
  const isaTax = isaEstimate.estimatedSettlementTax;
  const foreignTrades = rawTrades.map(trade => ({ ...trade, market: getEP(trade.name)?.market || '' }));
  const foreignRealized = PlanCalculations.calculateRealizedGainFromTrades({ trades: foreignTrades, year: taxYear, market: 'US' });
  const foreignTax = PlanCalculations.calculateForeignStockTax({ realizedGain: foreignRealized.realizedGain, manualAdjustment: _planSettings.foreignTaxAdjustment || 0, year: taxYear });

  // ── ③ IRP/연금 (과세이연)
  const irpSum = _sumByAccts(acctGroups['IRP']);
  const pensionSum = _sumByAccts(acctGroups['연금']);
  const irpDiv = _divSum(acctGroups['IRP']);
  const pensionDiv = _divSum(acctGroups['연금']);

  const FIN_INCOME_THRESHOLD = 20000000;
  const isOverThreshold = normalDiv > FIN_INCOME_THRESHOLD;

  function _acctListHtml(accts, emptyMsg) {
    if (accts.length === 0) return `<span style="font-size:.68rem;color:var(--muted)">${emptyMsg}</span>`;
    return accts.map(a => `<span style="font-size:.65rem;color:var(--text);background:var(--s2);border-radius:4px;padding:1px 6px;margin-right:4px">${_escapeHtml(a)}</span>`).join('');
  }

  return `<div class="card-12-p20" id="plan-tax">
    <div class="flex-between-mb14">
      <h4 class="h3-card" style="margin-bottom:0">🧾 세금 시뮬레이터</h4>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:.68rem;color:var(--muted)">귀속연도</span>
        <select id="plan-tax-year" style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.75rem">
          ${Array.from({length:5},(_,i)=>nowYear-i).map(y=>
            `<option value="${y}" ${y===taxYear?'selected':''}>${y}년</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="font-size:.65rem;color:var(--muted);margin-bottom:14px">
      한국 주식 매매차익은 원칙적으로 비과세(대주주 제외)이며, 매도 시 거래세만 발생합니다. 과세는 배당·이자소득 중심으로 계산됩니다. 배당소득은 거래이력 기준 ${taxYear}년 실제 보유수량으로 계산됩니다.
    </div>

    <!-- ① 일반계좌 -->
    <div style="background:var(--s2);border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.78rem;font-weight:700;color:var(--text)">💼 일반계좌</span>
        <span>${_acctListHtml(acctGroups['일반'], '해당 계좌 없음')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">평가손익 (매매차익, 비과세)</div>
          <div style="font-size:.80rem;font-weight:700;color:${pColor(normalSum.pnl)}">${pSign(normalSum.pnl)}${fmt(Math.abs(normalSum.pnl))}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">매도 시 예상 거래세 (${sellTaxRate}%)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--amber)">-${fmt(estSellTax)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">연간 배당소득 (세전)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(normalDiv)}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">배당소득세 (15.4% 원천징수)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--red-lt)">-${fmt(normalDivTax)}</div>
        </div>
      </div>
      ${isOverThreshold ? `
      <div style="margin-top:10px;padding:8px 10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;font-size:.68rem;color:var(--red-lt)">
        ⚠️ 연간 금융소득(배당) ${fmt(normalDiv)}원이 2,000만원을 초과했습니다. 초과분은 다른 소득과 합산해 <b>금융소득종합과세</b> 대상이 될 수 있습니다 (누진세율 적용, 정확한 세액은 세무사 상담 필요).
      </div>` : `
      <div style="margin-top:10px;font-size:.65rem;color:var(--muted)">
        금융소득종합과세 기준 2,000만원 중 ${fmt(normalDiv)}원 (${(normalDiv/FIN_INCOME_THRESHOLD*100).toFixed(1)}%) 사용 중
      </div>`}
    </div>

    <!-- ② ISA -->
    <div style="background:var(--s2);border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.78rem;font-weight:700;color:var(--purple)">🛡️ ISA 계좌</span>
        <span>${_acctListHtml(acctGroups['ISA'], '해당 계좌 없음')}</span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        ${[['general','일반형 (200만원)'],['special','서민형/농어민 (400만원)']].map(([v,l])=>
          `<button data-plan-isa-type="${v}" class="${isaExemptType===v?'btn-purple-sm':'btn-ghost-sm'}">${l}</button>`
        ).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">실현손익 + 배당·이자 추정</div>
          <div style="font-size:.80rem;font-weight:700;color:${pColor(isaTotalGain)}">${pSign(isaTotalGain)}${fmt(Math.abs(isaTotalGain))}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">비과세 한도</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(isaExempt)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">과세대상 (한도 초과분)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(isaTaxable)}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">예상 세금 (9.9% 분리과세)</div>
          <div style="font-size:.80rem;font-weight:700;color:${isaTax>0?'var(--red-lt)':'var(--muted)'}">${isaTax>0?'-'+fmt(isaTax):'-'}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:.65rem;color:var(--muted)">
        ISA는 연간 납부세액이 아니라 만기·해지 시 누적 정산 성격의 추정치입니다. 미실현 평가손익 ${fmt(isaEstimate.unrealizedGain)}은 즉시 과세대상에 포함하지 않았습니다. 실제 적용 여부와 한도는 금융기관·세무 전문가에게 확인하세요.
      </div>
    </div>

    <div style="background:var(--s2);border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="font-size:.78rem;font-weight:700;color:var(--cyan);margin-bottom:8px">🌐 해외주식 직접투자 양도세 추정</div>
      <div class="plan-metric-grid">
        <div><div class="lbl-62-muted-3">거래내역 기준 실현손익</div><div>${fmt(foreignTax.transactionEstimate)}</div></div>
        <div><div class="lbl-62-muted-3">수동조정액</div><input id="foreign-tax-adjustment" type="text" value="${Number(_planSettings.foreignTaxAdjustment||0).toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
        <div><div class="lbl-62-muted-3">과세표준 추정</div><div>${fmt(foreignTax.taxableBase)}</div></div>
        <div><div class="lbl-62-muted-3">예상세금</div><div style="color:var(--red-lt)">${fmt(foreignTax.estimatedTax)}</div></div>
      </div>
      <button data-plan-action="save-foreign-tax" class="btn-ghost-sm" style="margin-top:8px">수동조정 저장</button>
      <div style="font-size:.62rem;color:var(--muted);margin-top:8px">market이 명시적으로 US인 종목의 거래만 포함한 이동평균 추정치입니다. 통화만으로 국내·해외를 판단하지 않으며 증권사 계산과 다를 수 있습니다. 세율·공제는 ${foreignTax.appliedRuleYear}년 참고 상수입니다.</div>
    </div>

    <!-- ③ IRP / 연금 -->
    <div style="background:var(--s2);border-radius:10px;padding:12px 14px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.78rem;font-weight:700;color:var(--amber)">🏦 IRP / 연금계좌</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3" style="display:flex;justify-content:space-between;align-items:center">
            <span>IRP</span><span>${_acctListHtml(acctGroups['IRP'], '없음')}</span>
          </div>
          <div style="font-size:.80rem;font-weight:700;color:${pColor(irpSum.pnl)}">${pSign(irpSum.pnl)}${fmt(Math.abs(irpSum.pnl))}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3" style="display:flex;justify-content:space-between;align-items:center">
            <span>연금저축</span><span>${_acctListHtml(acctGroups['연금'], '없음')}</span>
          </div>
          <div style="font-size:.80rem;font-weight:700;color:${pColor(pensionSum.pnl)}">${pSign(pensionSum.pnl)}${fmt(Math.abs(pensionSum.pnl))}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">IRP 배당소득 (과세이연)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(irpDiv)}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">연금 배당소득 (과세이연)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(pensionDiv)}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:.65rem;color:var(--muted)">
        IRP/연금저축은 보유·운용 중 발생하는 매매차익과 배당소득에 <b>세금이 부과되지 않습니다(과세이연)</b>. 추후 연금으로 수령 시 연령에 따라 3.3~5.5% 연금소득세가 적용되며, 일시금으로 중도 인출하면 기타소득세(16.5%) 등 불이익이 있을 수 있습니다.
      </div>
    </div>

  </div>`;
}



// ════════════════════════════════════
// ④ 은퇴 포트폴리오 점검
// ════════════════════════════════════
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
  });
  const yearsToTarget = _calcYearsToRetirementTarget(totalEval, monthlyInvest, gap, retireReturn, fireNumber);
  const status = coveragePct >= 100 ? '은퇴 가능권' : coveragePct >= 70 ? '근접' : coveragePct >= 40 ? '축적 중' : '초기 구축';
  const statusColor = coveragePct >= 100 ? 'var(--green)' : coveragePct >= 70 ? 'var(--amber)' : 'var(--muted)';

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
        ['달성률', coveragePct.toFixed(1) + '%', statusColor],
        ['현금흐름 결과', retirement.sustainable ? '기간 내 유지' : `${retirement.depletionYear}년 고갈`, retirement.sustainable ? 'var(--green)' : 'var(--red-lt)'],
        ['은퇴시점 예상자산', fmt(Math.round(retirement.projectedAssetsAtRetirement)), 'var(--cyan)'],
        ['55세 이후 연금자산', fmt(retirement.pensionAssetsAfter55), 'var(--purple-lt)'],
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
    </div>
    <button data-plan-action="save-retirement" class="btn-purple-sm" style="margin-bottom:14px">💾 은퇴 기준 저장</button>

    <div class="retire-flow-grid retire-flow-grid-single">
      <div class="s2-rounded">
        <div class="lbl-62-muted-3">목표 도달 예상</div>
        <div style="font-size:.86rem;font-weight:800;color:${yearsToTarget === 0 ? 'var(--green)' : 'var(--amber)'}">${yearsToTarget === 0 ? '현재 충족' : yearsToTarget ? `약 ${yearsToTarget}년` : '계산 불가'}</div>
        <div style="font-size:.65rem;color:var(--muted)">월 추가 투자 ${fmt(monthlyInvest)} · 목표 도달 전 연 ${retireReturn}% 가정</div>
      </div>
    </div>
    <div style="font-size:.62rem;color:var(--muted);margin:-7px 0 12px">배당 생활비 충당률은 상단 ‘포트폴리오 배당·은퇴 현황’에서 확인합니다.</div>

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
function _buildSimSection(totalEval) {
  const monthly = _planNumber(_planSettings.simMonthly, 500000);
  const years   = _planNumber(_planSettings.simYears, 10);
  const rate    = _planNumber(_planSettings.simReturn, 7);
  const simData = _calcSimData(totalEval, monthly, years, rate);
  const last    = simData[simData.length - 1];

  return `<div class="card-12-p20" id="plan-simulation">
    <h4 class="h3-card" style="margin-bottom:14px">📈 자산 시뮬레이터</h4>

    <!-- 파라미터 입력 -->
    <div class="plan-metric-grid plan-sim-grid">
      <div>
        <div class="lbl-62-muted-3">월 추가 투자 (원)</div>
        <input type="text" id="sim-monthly" value="${monthly.toLocaleString()}" data-format="number-comma"
          style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/>
      </div>
      <div>
        <div class="lbl-62-muted-3">기간 (년)</div>
        <input type="number" id="sim-years" value="${years}" min="1" max="40"
          style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/>
      </div>
      <div>
        <div class="lbl-62-muted-3">연 수익률 (%)</div>
        <input type="number" id="sim-rate" value="${rate}" min="0" max="50" step="0.5"
          style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.75rem"/>
      </div>
    </div>
    <button data-plan-action="run-sim" class="btn-purple-sm" style="margin-bottom:16px">🔄 시뮬레이션</button>

    <!-- 요약 카드 -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">
      ${[
        ['현재 자산', fmt(totalEval), 'var(--text)'],
        [`${years}년 후 예상`, fmt(last.total), 'var(--green)'],
        ['총 투자 원금', fmt(last.principal), 'var(--muted)'],
        ['예상 수익', fmt(last.total - last.principal), 'var(--amber)'],
      ].map(([l,v,c])=>`<div class="s2-rounded">
        <div class="lbl-62-muted-3">${l}</div>
        <div style="font-size:.88rem;font-weight:700;color:${c}">${v}</div>
      </div>`).join('')}
    </div>

    <!-- SVG 차트 -->
    <div id="sim-chart-wrap">${_renderSimChart(simData, years)}</div>
  </div>`;
}

function _calcSimData(initAmt, monthly, years, annualRate) {
  const months      = years * 12;
  const monthlyRate = annualRate / 100 / 12;
  const data        = [];
  let current       = initAmt;
  let principal     = initAmt;

  for (let m = 1; m <= months; m++) {
    current   = current * (1 + monthlyRate) + monthly;
    principal = initAmt + monthly * m;
    if (m % 12 === 0) {
      data.push({
        year:      m / 12,
        total:     Math.round(current),
        principal: Math.round(principal),
        gain:      Math.round(current - principal),
      });
    }
  }
  return data;
}

function _renderSimChart(data, years) {
  if (!data.length) return '';
  const W = 600, H = 220;
  const PAD = { t: 16, r: 16, b: 36, l: 80 };
  const gW = W - PAD.l - PAD.r;
  const gH = H - PAD.t - PAD.b;

  const maxVal = Math.max(...data.map(d => d.total));
  const minVal = 0;
  const n      = data.length;

  function toX(i) { return PAD.l + (n <= 1 ? gW / 2 : i / (n - 1) * gW); }
  function toY(v) { return PAD.t + (1 - (v - minVal) / (maxVal - minVal || 1)) * gH; }

  function yLbl(v) {
    if (v >= 1e8) return (v / 1e8).toFixed(0) + '억';
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
    return v.toLocaleString();
  }

  const totalPath     = 'M' + data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.total).toFixed(1)}`).join(' L');
  const principalPath = 'M' + data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.principal).toFixed(1)}`).join(' L');
  const fillPath      = totalPath + ` L${toX(n-1).toFixed(1)},${(PAD.t+gH).toFixed(1)} L${toX(0).toFixed(1)},${(PAD.t+gH).toFixed(1)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(r => minVal + r * maxVal);

  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
  <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;min-width:${W}px">
    <defs>
      <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--green)" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="var(--green)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${ticks.map(v => {
      const y = toY(v).toFixed(1);
      return `<line x1="${PAD.l}" x2="${W-PAD.r}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
              <text x="${PAD.l-6}" y="${(+y+4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${yLbl(v)}</text>`;
    }).join('')}
    <path d="${fillPath}" fill="url(#simGrad)"/>
    <path d="${totalPath}" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${principalPath}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5,3" stroke-linejoin="round"/>
    ${data.map((d, i) => {
      if (i % Math.ceil(n / 6) !== 0 && i !== n - 1) return '';
      const x = toX(i).toFixed(1);
      return `<text x="${x}" y="${H - PAD.b + 14}" text-anchor="middle" font-size="11" fill="var(--muted)">${d.year}년</text>`;
    }).join('')}
    <circle cx="${toX(n-1).toFixed(1)}" cy="${toY(data[n-1].total).toFixed(1)}" r="5" fill="var(--green)" stroke="var(--s1)" stroke-width="2"/>
    <text x="${(W-PAD.r-4)}" y="${(PAD.t+12)}" text-anchor="end" font-size="10" fill="var(--green)">예상 총액</text>
    <text x="${(W-PAD.r-4)}" y="${(PAD.t+24)}" text-anchor="end" font-size="10" fill="var(--muted)">- - 투자 원금</text>
    <line x1="${PAD.l}" x2="${W-PAD.r}" y1="${(PAD.t+gH).toFixed(1)}" y2="${(PAD.t+gH).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
  </svg>
  </div>`;
}

// ════════════════════════════════════
// 이벤트 바인딩
// ════════════════════════════════════
function _bindPlanEvents(area, totalEval, totalCost) {
  // ★ [통일] number-comma 서식은 event_delegation.js 전역 리스너로 통합됨 (로컬 중복 제거)

  // ★ [정확한 배당 추적] 귀속연도 변경 시 재계산
  area.querySelector('#plan-tax-year')?.addEventListener('change', function() {
    _planSettings.taxYear = parseInt(this.value, 10) || null;
    _savePlanSettings();
    renderView(true);
  });

  if (area._planClickHandler) area.removeEventListener('click', area._planClickHandler);
  area._planClickHandler = function(e) {
    const action = e.target.closest('[data-plan-action]')?.dataset?.planAction;
    // ★ [한국 세제 반영] ISA 비과세 유형 선택
    const isaType = e.target.closest('[data-plan-isa-type]')?.dataset?.planIsaType;

    if (isaType) {
      _planSettings.isaExemptType = isaType;
      _savePlanSettings();
      renderView(true);
      return;
    }

    if (action === 'export-excel') {
      exportPortfolioExcel();
      return;
    }

    if (action === 'open-dividend') {
      switchView('div');
      return;
    }

    if (action === 'open-property') {
      switchView('asset');
      return;
    }

    if (action === 'save-weights') {
      const inputs = [...area.querySelectorAll('[data-plan-weight]')];
      const targetTotal = inputs.reduce((sum, inp) => sum + Math.max(0, parseFloat(inp.value) || 0), 0);
      if (targetTotal > 100.000001) {
        showToast('목표 비중 합계가 100%를 초과하여 저장할 수 없습니다', 'error', 5000);
        return;
      }
      inputs.forEach(inp => {
        const name = inp.dataset.planWeight;
        const ep   = getEP(name);
        if (ep) ep.targetWeight = parseFloat(inp.value) || 0;
      });
      // ★ saveHoldings: localStorage 저장 + GAS syncCodes/Holdings/Trades
      saveHoldings();
      // ★ saveSettings도 호출 — GSheet 연동 모드에서 EDITABLE_PRICES(targetWeight 포함)를 GAS에 저장
      // REMOTE_ONLY_KEYS로 인해 lsSave(EDITABLES_KEY)가 차단되는 경우를 대비
      if (typeof saveSettings === 'function') saveSettings(true);
      showToast('목표 비중 저장 완료', 'ok');
      renderView(true);
    }

    if (action === 'calc-buying-power') {
      const raw = ($el('plan-cash-input')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.cash = parseInt(raw) || 0;
      _savePlanSettings();
      renderView(true);
    }

    if (action === 'save-foreign-tax') {
      _planSettings.foreignTaxAdjustment = _planNumber(($el('foreign-tax-adjustment')?.value || '').replace(/,/g, ''), 0);
      _savePlanSettings();
      renderView(true);
      return;
    }

    if (action === 'save-retirement') {
      const rawExpense = ($el('retire-monthly-expense')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.retireMonthlyExpense = _planNumber(parseInt(rawExpense, 10), 0);
      _planSettings.retireWithdrawalRate = _planNumber(parseFloat($el('retire-withdrawal-rate')?.value || '4'), 4);
      _planSettings.retireYears          = _planNumber(parseInt($el('retire-years')?.value || '30', 10), 30);
      _planSettings.retireReturn         = _planNumber(parseFloat($el('retire-return')?.value || '4'), 4);
      _planSettings.retireCurrentAge     = _planNumber($el('retire-current-age')?.value, 40);
      _planSettings.retireTargetAge      = _planNumber($el('retire-target-age')?.value, 60);
      _planSettings.retireInflation      = _planNumber($el('retire-inflation')?.value, 2);
      _planSettings.retirePostReturn     = _planNumber($el('retire-post-return')?.value, 3);
      _planSettings.retireExtraExpense   = _planNumber(($el('retire-extra-expense')?.value || '').replace(/,/g, ''), 0);
      _planSettings.retireOtherIncome    = _planNumber(($el('retire-other-income')?.value || '').replace(/,/g, ''), 0);
      _planSettings.retireLoanMode       = $el('retire-loan-mode')?.value === 'payoff' ? 'payoff' : 'maintain';
      _savePlanSettings();
      showToast('은퇴 포트폴리오 기준 저장 완료', 'ok');
      renderView(true);
      return;
    }

    if (action === 'run-sim') {
      const raw     = ($el('sim-monthly')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.simMonthly = _planNumber(parseInt(raw, 10), 0);
      _planSettings.simYears   = _planNumber(parseInt($el('sim-years')?.value || '10', 10), 10);
      _planSettings.simReturn  = _planNumber(parseFloat($el('sim-rate')?.value || '7'), 7);
      _savePlanSettings();
      renderView(true);
    }
  };
  area.addEventListener('click', area._planClickHandler);
}
