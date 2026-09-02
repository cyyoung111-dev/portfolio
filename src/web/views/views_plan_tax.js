// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
function _buildTaxSection(totalCost) {
  // ★ [한국 세제 반영] 일반계좌는 매매차익 비과세(거래세만 발생), 배당/이자만 과세
  //   - 일반: 배당소득세 15.4% 원천징수, 연 2천만원 초과 시 금융소득종합과세 대상
  //   - ISA : 손익(매매차익+배당) 통산 후 200만원(서민형 400만원) 비과세, 초과분 9.9% 분리과세 (종합과세 미포함)
  //   - IRP/연금: 과세이연 — 보유 중에는 비과세, 인출 시에만 연금소득세 3.3~5.5%
  const isaExemptType = _planSettings.isaExemptType || 'general'; // general(200만) | special(400만, 서민형/농어민)

  // ★ [계좌별 taxType] 계좌 기준으로 taxType 결정 — computeRows()에서 r.taxType = getAcctTaxType(r.acct)로 이미 설정됨
  const acctGroups = { '일반': [], 'ISA': [], 'IRP': [], '연금': [], '미분류': [] };
  const acctSeen = new Set();
  rows.forEach(r => {
    if (!r.acct || acctSeen.has(r.acct)) return;
    acctSeen.add(r.acct);
    const tx = ['일반','ISA','IRP','연금'].includes(r.taxType) ? r.taxType : '미분류';
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
  const domesticTax = PlanCalculations.calculateDomesticStockTax({ saleValue: normalSum.evalAmt, year: taxYear });
  const sellTaxRate = domesticTax.saleTaxRate * 100;
  const estSellTax  = domesticTax.saleTaxReference;
  const normalDivTax = Math.round(normalDiv * 0.154);
  const enrichedTrades = rawTrades.map(trade => {
    const ep = getEP(trade.name);
    return { ...trade, market: String(ep?.market || '').toUpperCase(), taxType: ACCT_TAX_TYPES?.[trade.acct] || '' };
  });
  const domesticRealized = PlanCalculations.calculateRealizedGainFromTrades({ trades: enrichedTrades, year: taxYear, market: 'KR', taxTypes: ['normal'] });

  // ── ② ISA
  const isaSum = _sumByAccts(acctGroups['ISA']);
  const isaDiv = _divSum(acctGroups['ISA']);
  const isaRealizedResult = PlanCalculations.calculateRealizedGainFromTrades({ trades: enrichedTrades, year: taxYear, taxTypes: ['isa'] });
  const isaJoinYear = /^\d{4}-/.test(_planSettings.isaJoinDate || '') ? Number(_planSettings.isaJoinDate.slice(0,4)) : taxYear;
  let isaCumulativeRealized = 0;
  for (let year = isaJoinYear; year <= taxYear; year += 1) isaCumulativeRealized += PlanCalculations.calculateRealizedGainFromTrades({ trades: enrichedTrades, year, taxTypes: ['isa'] }).realizedGain;
  const isaPeriods = PlanCalculations.calculateIsaPeriodEstimates({
    selectedYear: { realizedGain: Math.max(0, isaRealizedResult.realizedGain), dividendAndInterest: isaDiv, eligibleLoss: Math.max(0, -isaRealizedResult.realizedGain) },
    cumulative: { realizedGain: Math.max(0, isaCumulativeRealized), unrealizedGain: isaSum.pnl, dividendAndInterest: isaDiv, eligibleLoss: Math.max(0, -isaCumulativeRealized) },
    isaType: isaExemptType, year: taxYear, calculationDate: _todayStr,
    dataGaps: ['과거연도 배당·이자 원장이 없으면 누적액에서 누락됩니다.'],
  });
  const isaEstimate = isaPeriods.cumulative;
  const isaTotalGain = isaEstimate.estimatedNetTaxableProfit;
  const isaExempt = isaEstimate.exemption;
  const isaTaxable = isaEstimate.excess;
  const isaTax = isaEstimate.estimatedSettlementTax;
  const foreignRealized = PlanCalculations.calculateRealizedGainFromTrades({ trades: enrichedTrades, year: taxYear, market: 'US', taxTypes: ['normal'] });
  const foreignTax = PlanCalculations.calculateForeignStockTax({ realizedGain: foreignRealized.realizedGain, manualAdjustment: _planSettings.foreignTaxAdjustment || 0, year: taxYear });

  // ── ③ IRP/연금 (과세이연)
  const irpSum = _sumByAccts(acctGroups['IRP']);
  const pensionSum = _sumByAccts(acctGroups['연금']);
  const irpDiv = _divSum(acctGroups['IRP']);
  const pensionDiv = _divSum(acctGroups['연금']);

  const FIN_INCOME_THRESHOLD = 20000000;
  const isOverThreshold = normalDiv > FIN_INCOME_THRESHOLD;

  function _acctListHtml(accts, emptyMsg) {
    if (accts.length === 0) return `<span class="caption-text">${emptyMsg}</span>`;
    return accts.map(a => `<span style="font-size:.65rem;color:var(--text);background:var(--s2);border-radius:4px;padding:1px 6px;margin-right:4px">${_escapeHtml(a)}</span>`).join('');
  }

  return `<div class="card-12-p20" id="plan-tax">
    <div class="flex-between-mb14">
      <h4 class="h3-card" style="margin-bottom:0">🧾 세금 시뮬레이터</h4>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="caption-text">귀속연도</span>
        <select id="plan-tax-year" style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.75rem">
          ${Array.from({length:5},(_,i)=>nowYear-i).map(y=>
            `<option value="${y}" ${y===taxYear?'selected':''}>${y}년</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="font-size:.65rem;color:var(--muted);margin-bottom:14px">
      모든 금액은 거래내역 기반 추정치입니다. 국내주식 비과세에는 대주주 등 예외가 있으며 실제 신고·납부액은 증권사 원장과 세무 전문가에게 확인하세요. 배당소득은 거래이력 기준 ${taxYear}년 실제 보유수량으로 계산됩니다.
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
          <div class="lbl-62-muted-3">전량 매도 가정 거래세 참고 (${sellTaxRate}%)</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--amber)">-${fmt(estSellTax)}</div>
        </div>
      </div>
      <div class="s2-rounded" style="background:var(--s1);margin-bottom:8px">
        <div class="lbl-62-muted-3">${taxYear}년 국내주식 거래내역 기준 실현손익</div>
        <div style="font-size:.80rem;font-weight:700;color:${pColor(domesticRealized.realizedGain)}">${pSign(domesticRealized.realizedGain)}${fmt(Math.abs(domesticRealized.realizedGain))}</div>
        <div style="font-size:.61rem;color:var(--muted)">market=KR · 일반계좌 · 이동평균 추정</div>
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
      <div class="plan-metric-grid" style="margin-bottom:8px">
        <div><div class="lbl-62-muted-3">가입일</div><input id="isa-join-date" type="date" value="${_escapeHtml(_planSettings.isaJoinDate||'')}" style="width:100%"/></div>
        <div><div class="lbl-62-muted-3">만기일</div><input id="isa-maturity-date" type="date" value="${_escapeHtml(_planSettings.isaMaturityDate||'')}" style="width:100%"/></div>
        <div><div class="lbl-62-muted-3">총 납입한도</div><input id="isa-contribution-limit" type="text" value="${Number(_planSettings.isaContributionLimit||0).toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
        <div><div class="lbl-62-muted-3">한도사용금액</div><input id="isa-contribution-used" type="text" value="${Number(_planSettings.isaContributionUsed||0).toLocaleString()}" data-format="number-comma" style="width:100%"/></div>
      </div>
      <button data-plan-action="save-isa-settings" class="btn-ghost-sm" style="margin-bottom:8px">ISA 정보 저장</button>
      <div class="caption-text mb-8">납입가능금액: ${_planSettings.isaContributionLimit>0 ? fmt(Math.max(0,_planSettings.isaContributionLimit-_planSettings.isaContributionUsed)) : '한도 미입력'}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px">
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">가입 이후 누적 과세대상 추정 순이익</div>
          <div style="font-size:.80rem;font-weight:700;color:${pColor(isaTotalGain)}">${pSign(isaTotalGain)}${fmt(Math.abs(isaTotalGain))}</div>
        </div>
        <div class="s2-rounded" style="background:var(--s1)">
          <div class="lbl-62-muted-3">비과세 한도</div>
          <div style="font-size:.80rem;font-weight:700;color:var(--text)">${fmt(isaExempt)}</div>
        </div>
      </div>
      <div style="font-size:.63rem;color:var(--muted);margin-top:6px">실현이익 ${fmt(isaEstimate.realizedGain)} · 통산대상 손실 ${fmt(isaEstimate.eligibleLoss)} · 배당·이자 ${fmt(isaEstimate.dividendAndInterest)}</div>
      <div style="font-size:.63rem;color:var(--muted);margin-top:6px">선택연도 참고: 실현손익 ${fmt(isaPeriods.selectedYear.realizedGain)} · 배당·이자 ${fmt(isaPeriods.selectedYear.dividendAndInterest)} · 예상 분리과세 ${fmt(isaPeriods.selectedYear.estimatedSettlementTax)}</div>
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
        누적 계산 기준일 ${isaPeriods.calculationDate} · 세법 기준연도 ${isaPeriods.appliedRuleYear}년. 미실현 평가손익 ${fmt(isaEstimate.unrealizedGain)}은 즉시 과세대상에 포함하지 않았습니다. 데이터 누락 범위: ${isaPeriods.dataGaps.join(' ')} 확정세액이 아니며 실제 적용 여부와 한도는 금융기관·세무 전문가에게 확인하세요.
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
