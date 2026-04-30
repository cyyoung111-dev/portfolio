// ════════════════════════════════════════════════════════════════
//  views_asset.js — 부동산/대출 뷰 통합 번들
//  (asset_schedule_section + asset_value_history + asset_chart + asset_view)
// ════════════════════════════════════════════════════════════════

// 스케줄/차트 로직은 views_asset_schedule.js 로 분리

function renderAssetView(area) {
  // ─ 부동산 데이터 ─
  const val    = REAL_ESTATE.currentValue || 0;
  const pur    = REAL_ESTATE.purchasePrice || 0;
  const reName = REAL_ESTATE.name || '보유 부동산';
  const memo   = REAL_ESTATE.memo || '';
  const tax      = REAL_ESTATE.taxCost || 0;
  const interior = REAL_ESTATE.interiorCost || 0;
  const etc      = REAL_ESTATE.etcCost || 0;
  const totalCost    = pur + tax + interior + etc;
  const totalIntPaid = LOAN.totalInterestPaid || 0;
  const totalOutflow = totalCost + totalIntPaid;   // 취득원가 + 누적 이자 합산
  const pnl          = val > 0 && pur > 0 ? val - pur : null;
  const pnlTotal     = totalCost > 0 && val > 0 ? val - totalCost : null;
  const pnlNet       = val > 0 && totalOutflow > 0 ? val - totalOutflow : null; // 이자 포함 실질 손익

  // ─ 대출 데이터 ─
  const bal  = LOAN.balance;
  const rate = LOAN.annualRate;
  const n    = LOAN.remainingMonths;
  const r    = rate / 100 / 12;
  const monthlyInterest = Math.round(bal * r);
  const pmt  = r > 0 ? Math.round(bal * r / (1 - Math.pow(1+r,-n))) : 0;
  const totalInterest = pmt * n - bal;
  const elapsedMonths = LOAN.totalMonths - n;
  const progressPct   = (elapsedMonths / LOAN.totalMonths * 100).toFixed(1);
  const payoffYear    = (LOAN.startYear||2024) + Math.ceil(LOAN.totalMonths/12);

  // ─ 통합 지표 ─
  const equity   = val > 0 ? val - bal : null;
  const ltv      = val > 0 ? (bal / val * 100).toFixed(1) : null;
  const netRE    = val > 0 ? val - bal : null;  // 부동산 순자산 = 시가 - 대출

  const fc = v => pColor(v);
  const fm = v => `<span style="color:${fc(v)}">${pSign(v)}${fmt(v)}</span>`;

  let h = `<div style="display:flex;flex-direction:column;gap:20px;padding:4px 0">
  ${renderTabSyncPanel('asset')}`;

  // ── 상단 핵심 지표 카드 4개 ──
  h += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    ${[
      ['🏠 부동산 시가', val>0?fmt(val):'미입력', val>0?`취득 ${fmt(pur)}`:''],
      ['💰 부동산 순자산', netRE!=null?fmt(netRE):'미입력', netRE!=null?`시가 ${fmt(val)} - 대출 ${fmt(bal)}`:'시가 미입력'],
      ['🏦 LTV', ltv?ltv+'%':'-', ltv?`대출 ${fmt(bal)} / 시가 ${fmt(val)}`:''],
      ['🏠 실거주 자기자본', equity!=null?fmt(equity):'미입력', equity!=null?`시가-대출`:''],
    ].map(([l,v,s])=>`<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div class="label-muted-68">${l}</div>
      <div style="font-size:.95rem;font-weight:700;color:var(--amber)">${v}</div>
      ${s?`<div style="font-size:.65rem;color:var(--muted);margin-top:3px">${s}</div>`:''}
    </div>`).join('')}
  </div>`;

  // ── 부동산 섹션 ──
  h += `<div class="card-12-p20">
    <div class="flex-between-mb14">
      <h4 class="h3-card">🏠 부동산 · ${reName}</h4>
      <button onclick="openRealEstateEditor()" class="btn-amber-outline">✏️ 수정</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:.80rem">
      ${[
        ['취득가', fmt(pur)],
        ['취득세 등', fmt(tax+interior+etc)],
        ['총 취득원가', fmt(totalCost)],
        ['현재 시가', val>0?fmt(val):'미입력'],
        ['매매 손익', pnl!=null?fm(pnl):'-'],
        ['실질 손익 (취득원가)', pnlTotal!=null?fm(pnlTotal):'-'],
        ['누적 이자 지급액', totalIntPaid>0?`<span style="color:var(--red)">-${fmt(totalIntPaid)}</span>`:'<span class="c-muted">미입력</span>'],
        ['이자 포함 순손익', pnlNet!=null?fm(pnlNet):'-'],
      ].map(([l,v])=>`<div class="s2-rounded">
        <div class="lbl-62-muted-3">${l}</div>
        <div class="fw-600">${v}</div>
      </div>`).join('')}
    </div>
    ${memo?`<div style="margin-top:10px;font-size:.72rem;color:var(--muted);background:var(--s2);border-radius:6px;padding:8px 12px">📝 ${memo}</div>`:''}
  </div>`;

  // ── 대출 섹션 ──
  const hasSched = LOAN_SCHEDULE.length > 0;
  const interestPaid = LOAN.monthlyInterestPaid || 0;
  const interestDiff = interestPaid > 0 ? interestPaid - monthlyInterest : null;
  const startDateLabel = LOAN.startDate
    ? (() => { const d = new Date(LOAN.startDate.replace(/-/g,'/')); return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`; })()
    : '-';
  h += `<div class="card-12-p20">
    <div class="flex-between-mb14">
      <h4 class="h3-card">🏦 주담대 현황</h4>
      <button onclick="openLoanEditor()" class="btn-amber-outline">✏️ 수정</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:.80rem;margin-bottom:14px">
      ${[
        ['잔액', `<span style="color:var(--red);font-weight:700">${fmt(bal)}</span>`],
        ['월 납입 (계산)', `${fmt(pmt)}`],
        ...(hasSched ? [
          ['이자 (스케줄)', `${fmt(LOAN.monthlyInterestPaid || 0)}`],
          ['원금상환 (스케줄)', (() => { const cur = LOAN_SCHEDULE.find(r => r.date === new Date().toISOString().slice(0,7)); return cur ? fmt(cur.principal) : (pmt > 0 ? fmt(pmt - (LOAN.monthlyInterestPaid||0)) : '-'); })()],
        ] : [
          ['이 중 이자 (계산)', `${fmt(monthlyInterest)}`],
          ['실제 이자지급액', interestPaid > 0
            ? `${fmt(interestPaid)}${interestDiff !== null ? ` <span style="font-size:.65rem;color:${interestDiff>0?'var(--red)':'var(--green)'}">(${interestDiff>0?'+':''}${fmt(interestDiff)})</span>` : ''}`
            : '-'],
          ['원금상환', pmt > 0 && interestPaid > 0 ? fmt(pmt - interestPaid) : (pmt > 0 ? fmt(pmt - monthlyInterest) : '-')],
        ]),
        ['금리', `${rate}%`],
        ['잔여 기간', `${Math.floor(n/12)}년 ${n%12}개월`],
        ['상환 완료', `${payoffYear}년`],
        ['대출실행일', startDateLabel],
      ].map(([l,v])=>`<div class="s2-rounded">
        <div class="lbl-62-muted-3">${l}</div>
        <div class="fw-600">${v}</div>
      </div>`).join('')}
    </div>
    <div style="margin-bottom:6px;display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted)">
      <span>상환 진행률</span><span class="c-text">${progressPct}%</span>
    </div>
    <div style="height:8px;background:var(--s2);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${progressPct}%;background:linear-gradient(90deg,var(--amber),var(--gold));border-radius:4px;transition:width .4s"></div>
    </div>
    <div style="margin-top:8px;font-size:.70rem;color:var(--muted);text-align:right">총 이자 ${fmt(totalInterest)} · ${elapsedMonths}개월 납입 완료</div>
  </div>`;

  // ── 상환스케줄 / 손익 차트 섹션 ──
  h += buildScheduleSection();

  h += '</div>';
  area.innerHTML = h;

  // 차트는 DOM 삽입 후 렌더링
  renderScheduleChart();
}
