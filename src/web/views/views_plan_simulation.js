// 투자계획 기능별 뷰 — views_plan.js의 공용 상태와 계산 컨텍스트를 사용합니다.
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
