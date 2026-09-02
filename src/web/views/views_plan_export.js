// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
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
    <div class="helper-text mt-8">
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

  const snapshotNotice = [
    ['기준일', todayStr],
    ['문서 유형', '값 기준 스냅샷 문서'],
    ['갱신 방법', '웹앱에서 다시 내보내야 갱신됩니다.'],
    ['주의', '수식으로 자동 갱신되지 않습니다.'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet([...snapshotNotice, headerRow1, ...dataRows1, footerRow1]);
  ws1['!cols'] = [
    {wch:10},{wch:18},{wch:10},{wch:8},{wch:10},
    {wch:10},{wch:12},{wch:14},{wch:12},{wch:14},
    {wch:14},{wch:10},{wch:8},
  ];
  // 헤더 스타일
  headerRow1.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r:snapshotNotice.length, c:i });
    if (ws1[cell]) ws1[cell].s = { font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'1E293B'}}, alignment:{horizontal:'center'} };
  });
  // 합계 행 스타일
  const footerIdx = snapshotNotice.length + dataRows1.length + 1;
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
  ensureAccountsMaster();
  const headerRow2 = ['계좌','계좌 ID','종목 수','매입금액','평가금액','손익','수익률(%)','비중(%)'];
  const dataRows2 = Object.entries(acctMap)
    .sort((a,b) => b[1].evalAmt - a[1].evalAmt)
    .map(([acct, v]) => {
      const pnl = v.evalAmt - v.costAmt;
      const pct = v.costAmt > 0 ? (pnl/v.costAmt*100) : 0;
      const weight = totalEval1 > 0 ? (v.evalAmt/totalEval1*100) : 0;
      return [acct, getAccountId(acct) || '', v.count, Math.round(v.costAmt), Math.round(v.evalAmt), Math.round(pnl), Number(pct.toFixed(2)), Number(weight.toFixed(1))];
    });
  const ws2 = XLSX.utils.aoa_to_sheet([headerRow2, ...dataRows2,
    ['합계','', rows.length, Math.round(totalCost1), Math.round(totalEval1), Math.round(totalPnl1), Number(totalPct1.toFixed(2)), 100]]);
  ws2['!cols'] = [{wch:12},{wch:16},{wch:8},{wch:14},{wch:14},{wch:14},{wch:10},{wch:10}];
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
  ensureAccountsMaster();
  const exportAsOfMonth = todayStr.slice(0,7);
  const exportLoanValidation = PlanCalculations.validateLoanScheduleDates({ startDate:LOAN?.startDate, schedule:LOAN_SCHEDULE, remainingMonths:LOAN?.remainingMonths, asOfMonth:exportAsOfMonth });
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
    ['주담대','일정 검증 경고', exportLoanValidation.warnings.join(' ') || '없음','원본 일정은 자동 수정하지 않음'],
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
  const dividendEntries = _getPlanDividendEntries(dividendRows);
  const dividendFlow = PlanCalculations.calculateDividendCashflow({ dividends: dividendEntries, year: _planSettings.taxYear || Number(todayStr.slice(0,4)) });
  const accountIdsForExport = Object.fromEntries(ACCOUNTS_MASTER.map(item => [item.displayName, item.id]));
  const dividendSheetRows = [['계좌','계좌 ID','세제유형','종목','세전 예상 배당','현재 생활비 사용 가능 여부','일반계좌 참고 세후액','ISA 내부 배당','연금저축 내부 배당','IRP 내부 배당','기록된 실제 배당','데이터 기준일'],
    ...dividendEntries.map(item => {
      const type = PlanCalculations.classifyTaxType(item.taxType);
      const gross = Math.round(Number(item.amount || 0));
      return [item.acct || '', accountIdsForExport[item.acct] || '', type, item.name || '', gross, type === 'normal' ? '예' : '아니오', type === 'normal' ? Math.round(gross * 0.846) : 0, type === 'isa' ? gross : 0, type === 'pension' ? gross : 0, type === 'irp' ? gross : 0, 0, todayStr];
    }),
    ['합계','','','',Math.round(dividendFlow.totalGross),'',Math.round(dividendFlow.normalAfterTax),Math.round(dividendFlow.isaInternal),Math.round(dividendFlow.pensionSavingsInternal),Math.round(dividendFlow.irpInternal),0,todayStr]
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(dividendSheetRows);
  ws6['!cols'] = [{wch:14},{wch:12},{wch:18},{wch:24},{wch:16},{wch:18},{wch:20},{wch:16},{wch:20},{wch:16},{wch:18},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws6, '배당 현황');

  // ── 시트7: 저장된 은퇴 계획과 현금흐름 기준
  const annualDividend = dividendFlow.totalGross;
  const exportLiquidity = PlanCalculations.calculateAccountLiquidity({ accounts:rows.map(item => ({ taxType:getAcctTaxType(item.acct), value:item.evalAmt, acct:item.acct })) });
  const exportPensionSavings = rows.filter(item => PlanCalculations.classifyTaxType(getAcctTaxType(item.acct)) === 'pension').reduce((sum,item)=>sum+Number(item.evalAmt||0),0);
  const exportIrp = rows.filter(item => PlanCalculations.classifyTaxType(getAcctTaxType(item.acct)) === 'irp').reduce((sum,item)=>sum+Number(item.evalAmt||0),0);
  const pensionSettingsMissing = _planSettings.pensionStartAge == null || !_planSettings.annualPensionWithdrawal || !_planSettings.pensionWithdrawalYears || _planSettings.pensionReturnRate == null || _planSettings.pensionTaxRate == null;
  const retirementRows = [
    ['항목','값','비고'],
    ['목표 월 생활비', Number(_planSettings.retireMonthlyExpense || 0),'저장된 투자계획 기준'],
    ['안전 인출률(%)', Number(_planSettings.retireWithdrawalRate || 0),''],
    ['은퇴 후 기간(년)', Number(_planSettings.retireYears || 0),''],
    ['목표 도달 수익률(%)', Number(_planSettings.retireReturn || 0),''],
    ['현재 평가자산', Math.round(totalEval1),''],
    ['일반계좌', Math.round(exportLiquidity.availableBefore55-exportLiquidity.isaAssets),''],
    ['ISA', Math.round(exportLiquidity.isaAssets),''],
    ['55세 전 접근 가능 자산', Math.round(exportLiquidity.availableBefore55),'일반계좌 + ISA'],
    ['연금저축', Math.round(exportPensionSavings),''],
    ['IRP', Math.round(exportIrp),''],
    ['연금자산 합계', Math.round(exportLiquidity.pensionAssets),''],
    ['전체 예상 배당 세전', Math.round(annualDividend),'배당 현황 합계'],
    ['일반계좌 예상 배당 세전', Math.round(dividendFlow.normalGross),''],
    ['일반계좌 참고 세후 배당', Math.round(dividendFlow.normalAfterTax),'15.4% 단순 원천징수 참고'],
    ['현재 사용 가능 월 배당', Math.round(dividendFlow.availableMonthly),'일반계좌 참고 세후액만 포함'],
    ['ISA 내부 예상 배당', Math.round(dividendFlow.isaInternal),'즉시 생활비에 포함하지 않음'],
    ['연금저축 내부 예상 배당', Math.round(dividendFlow.pensionSavingsInternal),'즉시 생활비에 포함하지 않음'],
    ['IRP 내부 예상 배당', Math.round(dividendFlow.irpInternal),'즉시 생활비에 포함하지 않음'],
    ['미분류 계좌 경고', exportLiquidity.warnings.join(' ') || '없음','미분류 자산은 가용자산에서 제외'],
    ['연금설정 경고', pensionSettingsMissing ? '연금 수령설정 미입력' : '없음',''],
    ['대출일정 경고', exportLoanValidation.warnings.join(' ') || '없음',''],
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

