// ════════════════════════════════════════════════════════════════
//  views_plan.js — 투자 계획 탭
//  목표비중 관리 · 매수여력 계산기 · 세금 시뮬레이터 · 자산 시뮬레이터
//  의존: data.js, portfolio_service.js, core_ui.js, core_color.js
// ════════════════════════════════════════════════════════════════

// ── 상태
const PLAN_KEY = 'pf_plan_settings';
let _planSettings = (function() {
  try {
    const s = lsGet(PLAN_KEY, {});
    return {
      cash:        s.cash        || 0,       // 현재 보유 현금 (원)
      taxAcctType: s.taxAcctType || 'normal', // normal | isa | irp
      taxRate:     s.taxRate     || 22,       // 양도세율 % (기본 22%)
      simMonthly:  s.simMonthly  || 500000,   // 월 추가 투자금
      simYears:    s.simYears    || 10,        // 시뮬레이션 기간 (년)
      simReturn:   s.simReturn   || 7,         // 연 수익률 가정 %
    };
  } catch(e) { return { cash:0, taxAcctType:'normal', taxRate:22, simMonthly:500000, simYears:10, simReturn:7 }; }
})();

function _savePlanSettings() {
  lsSave(PLAN_KEY, _planSettings);
}

// ── 메인 렌더
function renderPlanView(area) {
  const totalEval  = rows.reduce((s, r) => s + (r.evalAmt || 0), 0);
  const totalCost  = rows.reduce((s, r) => s + (r.costAmt || 0), 0);

  area.innerHTML = `
<div style="display:flex;flex-direction:column;gap:20px;padding:4px 0">

  <!-- ⓪ 엑셀 내보내기 -->
  ${_buildExportSection(totalEval, totalCost)}

  <!-- ① 목표 비중 관리 -->
  ${_buildWeightSection(totalEval)}

  <!-- ② 매수 여력 계산기 -->
  ${_buildBuyingPowerSection(totalEval)}

  <!-- ③ 세금 시뮬레이터 -->
  ${_buildTaxSection(totalCost)}

  <!-- ④ 자산 시뮬레이터 -->
  ${_buildSimSection(totalEval)}

</div>`;

  _bindPlanEvents(area, totalEval, totalCost);
}

// ════════════════════════════════════
// ⓪ 엑셀 내보내기
// ════════════════════════════════════
function _buildExportSection(totalEval, totalCost) {
  const totalPnl = totalEval - totalCost;
  const acctCount = new Set(rows.map(r => r.acct).filter(Boolean)).size;
  const stockCount = rows.length;
  return `<div class="card-12-p20">
    <div class="flex-between-mb14">
      <h4 class="h3-card">📊 포트폴리오 엑셀 내보내기</h4>
      <button data-plan-action="export-excel" class="btn-purple-sm">📥 엑셀 다운로드</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:.78rem">
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
      종목별 상세 · 계좌별 요약 · 섹터별 요약 3개 시트로 구성된 엑셀 파일을 받습니다.
    </div>
  </div>`;
}

// 현재 보유 종목(rows)을 엑셀(.xlsx)로 내보내기
// 시트1: 종목별 상세 (계좌/종목/유형/섹터/수량/단가/평가금액/손익/수익률/통화)
// 시트2: 계좌별 요약
// 시트3: 섹터별 요약
function exportPortfolioExcel() {
  if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
  if (!rows || rows.length === 0) { showToast('내보낼 보유 종목이 없습니다', 'warn'); return; }

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

  XLSX.writeFile(wb, `포트폴리오_${todayStr.replace(/-/g,'')}.xlsx`);
  showToast('📥 엑셀 다운로드 완료', 'ok');
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

    return `<div style="display:grid;grid-template-columns:110px 1fr 60px 60px 70px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
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

  return `<div class="card-12-p20">
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
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      ${[['💰 현금', fmt(cash)],['📈 주식 평가액', fmt(totalEval)],['🏦 총 자산', fmt(totalAssets)]].map(([l,v])=>`
      <div class="s2-rounded"><div class="lbl-62-muted-3">${l}</div><div class="fw-600 c-amber">${v}</div></div>`).join('')}
    </div>` : ''}
    <div id="plan-buying-recs">${recHtml}</div>
  </div>`;
}

function _calcBuyingPower(items, totalEval, cash) {
  // 총 자산 기준으로 목표 금액 계산 → 부족한 종목 순으로 매수 추천
  const totalAssets = totalEval + cash;
  let remaining = cash;
  const result = [];

  // 목표 비중이 있는 종목만, 현재보다 목표가 큰 것만
  const needBuy = items
    .filter(i => i.targetPct > 0 && i.targetPct > i.currentPct)
    .map(i => ({
      ...i,
      targetAmt: totalAssets * i.targetPct / 100,
      gap: totalAssets * (i.targetPct - i.currentPct) / 100,
    }))
    .sort((a, b) => b.gap - a.gap);

  needBuy.forEach(i => {
    if (remaining <= 0) return;
    const buyAmt = Math.min(remaining, Math.round(i.gap));
    if (buyAmt < 1000) return; // 1천원 미만 무시
    result.push({ ...i, buyAmt });
    remaining -= buyAmt;
  });

  return result;
}

// ════════════════════════════════════
// ③ 세금 시뮬레이터
// ════════════════════════════════════
function _buildTaxSection(totalCost) {
  const totalEvalNow = rows.reduce((s, r) => s + (r.evalAmt || 0), 0);
  const totalPnl     = totalEvalNow - totalCost;
  const acctType     = _planSettings.taxAcctType || 'normal';
  const taxRate      = _planSettings.taxRate || 22;

  // 계좌별 손익 분리
  const acctPnl = {};
  rows.forEach(r => {
    if (!r.acct) return;
    if (!acctPnl[r.acct]) acctPnl[r.acct] = { eval: 0, cost: 0 };
    acctPnl[r.acct].eval += (r.evalAmt || 0);
    acctPnl[r.acct].cost += (r.costAmt || 0);
  });

  // 세금 계산
  const { taxable, tax, note } = _calcTax(totalPnl, acctType, taxRate);

  const acctRows = Object.entries(acctPnl).map(([acct, v]) => {
    const pnl   = v.eval - v.cost;
    const pct   = v.cost > 0 ? pnl / v.cost * 100 : 0;
    const color = pColor(pnl);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--s2);border-radius:8px;margin-bottom:5px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="width:7px;height:7px;border-radius:50%;background:${ACCT_COLORS[acct]||'var(--muted)'}"></span>
        <span style="font-size:.73rem;color:var(--text)">${_escapeHtml(acct)}</span>
      </div>
      <div style="text-align:right">
        <span style="font-size:.75rem;font-weight:600;color:${color}">${pSign(pnl)}${fmt(pnl)}</span>
        <span style="font-size:.65rem;color:var(--muted);margin-left:6px">(${pSign(pct)}${pct.toFixed(1)}%)</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="card-12-p20">
    <h4 class="h3-card" style="margin-bottom:14px">🧾 세금 시뮬레이터</h4>

    <!-- 계좌 유형 선택 -->
    <div style="margin-bottom:12px">
      <div class="lbl-62-muted-3" style="margin-bottom:6px">계좌 유형</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[['normal','일반계좌'],['isa','ISA'],['irp','IRP/연금']].map(([v,l])=>
          `<button data-plan-acct-type="${v}" class="${acctType===v?'btn-purple-sm':'btn-ghost-sm'}">${l}</button>`
        ).join('')}
      </div>
    </div>

    <!-- 세율 입력 (일반계좌만) -->
    ${acctType === 'normal' ? `
    <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:14px">
      <div>
        <div class="lbl-62-muted-3">양도소득세율 (%)</div>
        <input type="number" id="plan-tax-rate" value="${taxRate}" min="0" max="50" step="0.1"
          style="width:90px;background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem"/>
      </div>
      <button data-plan-action="calc-tax" class="btn-ghost-sm">계산</button>
    </div>` : ''}

    <!-- 계좌별 손익 -->
    <div style="margin-bottom:14px">${acctRows}</div>

    <!-- 세금 결과 -->
    <div style="background:${tax > 0 ? 'rgba(239,68,68,.08)' : 'var(--s2)'};border:1px solid ${tax > 0 ? 'rgba(239,68,68,.25)' : 'var(--border)'};border-radius:10px;padding:14px 16px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
        ${[
          ['총 손익', totalPnl, pColor(totalPnl)],
          ['과세 대상 손익', taxable, pColor(taxable)],
          ['예상 세금', -tax, tax > 0 ? 'var(--red-lt)' : 'var(--muted)'],
        ].map(([l,v,c])=>`<div class="s2-rounded">
          <div class="lbl-62-muted-3">${l}</div>
          <div style="font-size:.82rem;font-weight:700;color:${c}">${pSign(v)}${fmt(Math.abs(v))}</div>
        </div>`).join('')}
      </div>
      <div style="font-size:.68rem;color:var(--muted)">${_escapeHtml(note)}</div>
      ${tax > 0 ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)">
        <div class="lbl-62-muted-3" style="margin-bottom:4px">세후 실현 손익</div>
        <div style="font-size:1rem;font-weight:800;color:${pColor(totalPnl - tax)}">${pSign(totalPnl - tax)}${fmt(Math.abs(totalPnl - tax))}</div>
      </div>` : ''}
    </div>
  </div>`;
}

function _calcTax(pnl, acctType, taxRate) {
  if (pnl <= 0) {
    return { taxable: 0, tax: 0, note: '손실 구간 — 양도소득세 없음' };
  }
  if (acctType === 'isa') {
    // ISA: 200만원 비과세, 초과분 9.9% 분리과세
    const exempt = 2000000;
    const taxable = Math.max(0, pnl - exempt);
    const tax = Math.round(taxable * 0.099);
    return { taxable, tax, note: `ISA 계좌: 200만원 비과세 후 초과분 9.9% 분리과세 (서민형/농어민 400만원 비과세)` };
  }
  if (acctType === 'irp') {
    // IRP/연금: 인출 시 연금소득세 3.3~5.5%, 여기서는 5.5% 기본 적용
    const taxable = pnl;
    const tax = Math.round(taxable * 0.055);
    return { taxable, tax, note: `IRP/연금 계좌: 연금 수령 시 3.3~5.5% 연금소득세 (55세 이상 3.3% ~ 69세 이하 5.5%)` };
  }
  // 일반계좌: 기본공제 250만원 후 과세
  const exempt = 2500000;
  const taxable = Math.max(0, pnl - exempt);
  const tax = Math.round(taxable * taxRate / 100);
  return { taxable, tax, note: `일반계좌: 250만원 기본공제 후 ${taxRate}% 과세 (지방소득세 포함 시 약 ${(taxRate * 1.1).toFixed(1)}%)` };
}

// ════════════════════════════════════
// ④ 자산 시뮬레이터
// ════════════════════════════════════
function _buildSimSection(totalEval) {
  const monthly = _planSettings.simMonthly || 500000;
  const years   = _planSettings.simYears   || 10;
  const rate    = _planSettings.simReturn  || 7;
  const simData = _calcSimData(totalEval, monthly, years, rate);
  const last    = simData[simData.length - 1];

  return `<div class="card-12-p20">
    <h4 class="h3-card" style="margin-bottom:14px">📈 자산 시뮬레이터</h4>

    <!-- 파라미터 입력 -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
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
  // number-comma 포맷 인풋
  area.querySelectorAll('[data-format="number-comma"]').forEach(inp => {
    inp.addEventListener('input', function() {
      const pos = this.selectionStart;
      const raw = this.value.replace(/[^0-9]/g, '');
      this.value = raw ? Number(raw).toLocaleString() : '';
      try { this.setSelectionRange(pos, pos); } catch(e) {}
    });
  });

  area.addEventListener('click', function(e) {
    const action = e.target.closest('[data-plan-action]')?.dataset?.planAction;
    const acctType = e.target.closest('[data-plan-acct-type]')?.dataset?.planAcctType;

    if (acctType) {
      _planSettings.taxAcctType = acctType;
      _savePlanSettings();
      renderView(true);
      return;
    }

    if (action === 'export-excel') {
      exportPortfolioExcel();
      return;
    }

    if (action === 'save-weights') {
      area.querySelectorAll('[data-plan-weight]').forEach(inp => {
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

    if (action === 'calc-tax') {
      const rate = parseFloat($el('plan-tax-rate')?.value || '22') || 22;
      _planSettings.taxRate = rate;
      _savePlanSettings();
      renderView(true);
    }

    if (action === 'run-sim') {
      const raw     = ($el('sim-monthly')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.simMonthly = parseInt(raw) || 0;
      _planSettings.simYears   = parseInt($el('sim-years')?.value || '10') || 10;
      _planSettings.simReturn  = parseFloat($el('sim-rate')?.value || '7') || 7;
      _savePlanSettings();
      renderView(true);
    }
  });
}
