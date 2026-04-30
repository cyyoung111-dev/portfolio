// views_asset_schedule_chart.js — 스케줄 차트 렌더

function renderScheduleChart() {
  const wrap = $el('scheduleChartWrap');
  if (!wrap || LOAN_SCHEDULE.length === 0) return;

  const pur       = REAL_ESTATE.purchasePrice || 0;
  const tax       = (REAL_ESTATE.taxCost || 0) + (REAL_ESTATE.interiorCost || 0) + (REAL_ESTATE.etcCost || 0);
  const totalCost = pur + tax;

  const valMap = {};
  RE_VALUE_HIST.forEach(r => { valMap[r.date] = r.value; });
  const valDates = Object.keys(valMap).sort();

  function getVal(date) {
    const d = valDates.filter(d => d <= date);
    return d.length > 0 ? valMap[d[d.length-1]] : (REAL_ESTATE.currentValue || 0);
  }

  let cumInterest = 0;
  const data = LOAN_SCHEDULE.map(row => {
    cumInterest += row.interest;
    const val    = getVal(row.date);
    const outflow = totalCost + cumInterest;
    const pnl    = val > 0 ? val - outflow : null;
    const equity = val > 0 ? val - row.balance : null;
    return { date: row.date, balance: row.balance, cumInterest, val, pnl, equity };
  });

  const n       = data.length;
  const dates   = data.map(d => d.date.slice(2));
  const bals    = data.map(d => d.balance);
  const equities= data.map(d => d.equity);
  const pnls    = data.map(d => d.pnl);
  const validPnl = pnls.filter(v => v !== null);

  function yLbl(v) {
    const abs = Math.abs(v), s = v < 0 ? '-' : '';
    if (abs >= 100000000) return s + (abs / 100000000).toFixed(1) + '억';
    if (abs >= 10000)     return s + Math.round(abs / 10000) + '만';
    return s + abs.toLocaleString();
  }

  const nYears = new Set(LOAN_SCHEDULE.map(r => r.date.slice(0,4))).size;
  const W   = Math.max(640, nYears * 60);
  const H1  = 320;
  const H2  = 180;
  const PAD = { t: 28, r: 24, b: 44, l: 88 };
  const gW  = W - PAD.l - PAD.r;
  const gH1 = H1 - PAD.t - PAD.b;
  const gH2 = H2 - PAD.t - PAD.b;

  function toX(i) { return PAD.l + (n <= 1 ? gW / 2 : (i / (n - 1)) * gW); }

  function makeYScale(vals, padPct = 0.08) {
    const clean = vals.filter(v => v !== null);
    if (!clean.length) return { mn: 0, mx: 1 };
    let mn = Math.min(...clean), mx = Math.max(...clean);
    const range = mx - mn || 1;
    return { mn: mn - range * padPct, mx: mx + range * padPct };
  }

  function toY(v, mn, mx, padT, h) {
    if (mx === mn) return padT + h / 2;
    return padT + (1 - (v - mn) / (mx - mn)) * h;
  }

  function yTicks(mn, mx, count = 5) {
    const step = (mx - mn) / (count - 1);
    return Array.from({ length: count }, (_, i) => mn + i * step);
  }

  const { mn: balMn, mx: balMx } = makeYScale([...bals, ...equities.filter(v => v !== null)]);
  const ticks1 = yTicks(balMn, balMx);

  function pt1(v, i) {
    return `${toX(i).toFixed(1)},${toY(v, balMn, balMx, PAD.t, gH1).toFixed(1)}`;
  }

  const balPath = 'M' + bals.map((v, i) => pt1(v, i)).join(' L');

  let eqPath = null;
  const validEqIdx = equities.map((v, i) => v !== null ? i : -1).filter(i => i >= 0);
  if (validEqIdx.length > 1) {
    eqPath = 'M' + validEqIdx.map(i => pt1(equities[i], i)).join(' L');
  }

  const balFill = balPath + ` L${toX(n-1).toFixed(1)},${(PAD.t+gH1).toFixed(1)} L${toX(0).toFixed(1)},${(PAD.t+gH1).toFixed(1)} Z`;

  function xLabelsSvg(yPos, fontSize = 10) {
    const useAll = n <= 12;
    const seenYears = new Set();
    return data.map((row, i) => {
      if (useAll) {
        return `<text x="${toX(i).toFixed(1)}" y="${yPos}" text-anchor="middle" font-size="${fontSize}" fill="var(--muted)">${dates[i]}</text>`;
      }
      const yyyy = row.date.slice(0, 4);
      if (!seenYears.has(yyyy)) {
        seenYears.add(yyyy);
        return `<text x="${toX(i).toFixed(1)}" y="${yPos}" text-anchor="middle" font-size="${fontSize}" fill="var(--muted)">${yyyy}</text>`;
      }
      return '';
    }).join('');
  }

  const pnlAbsMax = validPnl.length > 0
    ? Math.max(Math.abs(Math.min(...validPnl)), Math.abs(Math.max(...validPnl))) * 1.1 || 1
    : 1;
  function toY2(v) { return PAD.t + (1 - (v + pnlAbsMax) / (2 * pnlAbsMax)) * gH2; }
  const zero2 = toY2(0);
  const barW  = n > 12 ? Math.max(8, Math.min(24, gW / nYears - 4)) : Math.max(5, Math.min(18, gW / n - 2));

  const seenBarYears = new Set();
  const barsHtml = pnls.map((v, i) => {
    if (v === null) return '';
    if (n > 12) {
      const yyyy = data[i].date.slice(0, 4);
      if (seenBarYears.has(yyyy)) return '';
      seenBarYears.add(yyyy);
    }
    const x  = toX(i) - barW / 2;
    const yy = v >= 0 ? toY2(v) : zero2;
    const h  = Math.max(2, Math.abs(toY2(v) - zero2));
    const clr = v >= 0 ? 'var(--green)' : 'var(--red)';
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}"
      fill="${clr}" opacity="0.92" rx="3"/>`;
  }).join('');

  const pnlTicks = [-pnlAbsMax, -pnlAbsMax/2, 0, pnlAbsMax/2, pnlAbsMax];

  const latestBal    = bals[n - 1];
  const latestEq     = equities.filter(v => v !== null).slice(-1)[0];
  const latestPnl    = validPnl.slice(-1)[0] ?? null;
  const pnlColor     = latestPnl !== null ? (latestPnl >= 0 ? 'var(--green-lt)' : 'var(--red-lt)') : 'var(--muted)';

  wrap.innerHTML = `
  <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:var(--c-white-03);border:1px solid var(--border);border-radius:10px">
    <div class="flex-gap6-ai">
      <svg width="28" height="12"><line x1="0" y1="6" x2="28" y2="6" stroke="var(--blue-lt)" stroke-width="2.5" stroke-linecap="round"/></svg>
      <span class="txt-75-slate">대출 잔액</span>
      <span style="font-size:.78rem;font-weight:700;color:var(--blue-lt);margin-left:4px">${yLbl(latestBal)}</span>
    </div>
    ${eqPath ? `
    <div class="flex-gap6-ai" style="flex-wrap:wrap">
      <svg width="28" height="12"><line x1="0" y1="6" x2="28" y2="6" stroke="var(--amber)" stroke-width="2.5" stroke-dasharray="5,3" stroke-linecap="round"/></svg>
      <span class="txt-75-slate">순자산 (시가−잔액)</span>
      ${latestEq != null ? `<span style="font-size:.78rem;font-weight:700;color:var(--amber);margin-left:4px">${yLbl(latestEq)}</span>` : ''}
    </div>` : ''}
    <div style="margin-left:0;display:flex;align-items:center;gap:8px;background:var(--c-black-20);padding:6px 12px;border-radius:8px;flex-shrink:0">
      <span style="font-size:.70rem;color:var(--muted)">이자포함 순손익</span>
      <span style="font-size:.90rem;font-weight:800;color:${pnlColor}">${latestPnl !== null ? (latestPnl >= 0 ? '+' : '') + yLbl(latestPnl) : '시가 미입력'}</span>
    </div>
  </div>

  <div style="background:var(--c-s1-60);border:1px solid var(--border);border-radius:10px;overflow:hidden;overflow-x:auto;margin-bottom:8px;-webkit-overflow-scrolling:touch">
    <div class="section-label">잔액 · 순자산</div>
    <svg viewBox="0 0 ${W} ${H1}" width="${W}" height="${H1}" style="display:block;min-width:${W}px">
      <defs>
        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--blue-lt)" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="var(--blue-lt)" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${ticks1.map(v => {
        const y = toY(v, balMn, balMx, PAD.t, gH1).toFixed(1);
        return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
        <text x="${PAD.l - 8}" y="${(+y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${yLbl(v)}</text>`;
      }).join('')}
      <path d="${balFill}" fill="url(#balGrad)"/>
      <path d="${balPath}" fill="none" stroke="var(--blue-lt)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${toX(n-1).toFixed(1)}" cy="${toY(bals[n-1], balMn, balMx, PAD.t, gH1).toFixed(1)}" r="5.5" fill="var(--blue-lt)" stroke="var(--s1)" stroke-width="2"/>
      ${eqPath ? `<path d="${eqPath}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6,3"/>
      <circle cx="${toX(validEqIdx[validEqIdx.length-1]).toFixed(1)}" cy="${toY(equities[validEqIdx[validEqIdx.length-1]], balMn, balMx, PAD.t, gH1).toFixed(1)}" r="5.5" fill="var(--amber)" stroke="var(--s1)" stroke-width="2"/>` : ''}
      <text transform="rotate(-90)" x="${-(PAD.t + gH1/2)}" y="18" text-anchor="middle" font-size="11" fill="var(--muted)">잔액 (원)</text>
      <text x="${PAD.l + gW/2}" y="${H1 - 4}" text-anchor="middle" font-size="11" fill="var(--muted)">상환월</text>
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${H1 - PAD.b}" y2="${H1 - PAD.b}" stroke="var(--border)" stroke-width="1"/>
      ${xLabelsSvg(H1 - PAD.b + 16, 11)}
    </svg>
  </div>

  <div style="background:var(--c-s1-60);border:1px solid var(--border);border-radius:10px;overflow:hidden;overflow-x:auto;-webkit-overflow-scrolling:touch">
    <div class="section-label">이자포함 순손익</div>
    <svg viewBox="0 0 ${W} ${H2}" width="${W}" height="${H2}" style="display:block;min-width:${W}px">
      ${pnlTicks.map(v => {
        const y = toY2(v).toFixed(1);
        return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" stroke="${v === 0 ? 'var(--s2)' : 'var(--border)'}" stroke-width="${v === 0 ? 2 : 1}"/>
        <text x="${PAD.l - 8}" y="${(+y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${v === 0 ? 'var(--text)' : 'var(--muted)'}">${v === 0 ? '0' : yLbl(v)}</text>`;
      }).join('')}
      <text transform="rotate(-90)" x="${-(PAD.t + gH2/2)}" y="18" text-anchor="middle" font-size="11" fill="var(--muted)">손익 (원)</text>
      <text x="${PAD.l + gW/2}" y="${H2 - 4}" text-anchor="middle" font-size="11" fill="var(--muted)">상환월</text>
      ${barsHtml}
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${H2 - PAD.b}" y2="${H2 - PAD.b}" stroke="var(--border)" stroke-width="1"/>
      ${xLabelsSvg(H2 - PAD.b + 16, 11)}
    </svg>
  </div>`;
}

