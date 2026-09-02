// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
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
        <span style="font-size:.68rem;color:${overTarget?'var(--red-lt)':'var(--muted)'}">합계 ${totalTarget.toFixed(1)}% ${overTarget?'⚠️ 100% 초과':totalTarget<100?`· 현금 ${(100-totalTarget).toFixed(1)}%`:''}</span>
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
    ${rows_html || '<div class="helper-text empty-state-inline">보유 종목이 없습니다</div>'}
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
  EDITABLE_PRICES.forEach(ep => {
    if (!ep?.name || merged[ep.name]) return;
    merged[ep.name] = { name: ep.name, evalAmt: 0, sector: ep.sector || '기타' };
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
    const buyingResult = _calcBuyingPower(items, totalEval, cash);
    const recs = buyingResult.recommendations;
    recHtml = `${buyingResult.cashTargetPct > 0 ? `<div style="font-size:.68rem;color:var(--cyan);margin-bottom:8px">목표비중 미배정 ${buyingResult.cashTargetPct.toFixed(1)}%는 현금 목표비중으로 표시합니다.</div>` : ''}` + (recs.length > 0
      ? recs.map(r => {
          const color = resolveColor(SECTOR_COLORS[r.sector] || 'var(--muted)');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--s2);border-radius:8px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
              <span style="font-size:.75rem;font-weight:600;color:var(--text)">${_escapeHtml(r.name)}</span>
            </div>
            <div style="text-align:right">
              <div style="font-size:.80rem;font-weight:700;color:var(--green)">+${fmt(r.buyAmt)}</div>
              <div class="caption-text">${r.currentPct.toFixed(1)}% → ${r.targetPct.toFixed(1)}%</div>
              <div style="font-size:.62rem;color:var(--muted)">${r.estimatedQuantity == null ? '현재가 없음 · 금액만 표시' : `현재가 기준 약 ${r.estimatedQuantity.toLocaleString()}주`}</div>
            </div>
          </div>`;
        }).join('')
      : `<div class="helper-text empty-state-inline">목표 비중이 현재 비중보다 높은 종목이 없습니다</div>`);
  } else if (!hastarget) {
    recHtml = `<div class="helper-text empty-state-inline">① 목표 비중을 먼저 설정하세요</div>`;
  } else {
    recHtml = `<div class="helper-text empty-state-inline">현금을 입력하면 매수 추천이 표시됩니다</div>`;
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
  return { ...result, recommendations: result.recommendations.filter(item => item.buyAmount >= 1000).map(item => ({ ...item, buyAmt: item.buyAmount })) };
}

// ════════════════════════════════════
// ③ 세금 시뮬레이터
// ════════════════════════════════════
