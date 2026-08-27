// ════════════════════════════════════════════════════════════════
//  views_portfolio.js — 포트폴리오 뷰 (계좌별·섹터별·종목별 합산·도넛)
//  의존: data.js, views_table.js
// ════════════════════════════════════════════════════════════════

// _fBtnClass → core_ui.js에서 제공

// ── ETF 이름 패턴 판별 공통 함수 (renderAcctView · renderDonut 공용)
const ETF_PREFIXES = ['KODEX','TIGER','ACE','TIME','SOL','KBSTAR','HANARO','ARIRANG','PLUS','RISE'];
function isEtfByName(name) {
  return ETF_PREFIXES.some(p => name.startsWith(p));
}

// ── 계좌별 + 종류별 뷰
let acctFilter = '전체';
let typeFilter = '전체';
let _donutModelCache = { key: '', model: null };
let _acctEnrichedCache = { key: '', data: [] };
let _mergeListCache = { key: '', list: [] };

function _portfolioDataKey() {
  return [
    rows.length,
    rawTrades.length,
    rawHoldings.length,
    EDITABLE_PRICES.length,
    lastUpdated || ''
  ].join('|');
}

function _buildPortfolioDividendSummary() {
  const dividendRows = typeof calcDividends === 'function' ? calcDividends() : [];
  const annual = dividendRows.reduce((sum, item) => sum + Number(item.annualDiv || 0), 0);
  const actual = dividendRows.reduce((sum, item) => sum + Number(item.actualDiv || 0), 0);
  const nowMonth = typeof _getNowMonth === 'function' ? _getNowMonth() : 0;
  const currentMonth = dividendRows.reduce((sum, item) => sum + Number(item.monthlyDiv?.[nowMonth] || 0), 0);
  const dividendNames = new Set(dividendRows.map(item => item.name));
  const dividendCost = rows.filter(row => dividendNames.has(row.name)).reduce((sum, row) => sum + Number(row.costAmt || 0), 0);
  const yieldPct = dividendCost > 0 ? annual / dividendCost * 100 : 0;
  const monthlyExpense = (typeof _planSettings !== 'undefined' && Number(_planSettings.retireMonthlyExpense) > 0)
    ? Number(_planSettings.retireMonthlyExpense)
    : 0;
  // 은퇴 계획과 동일한 일반계좌 원천징수 가정값이며 실제 계좌별 세액은 투자계획 탭에서 확인합니다.
  const afterTaxMonthly = Math.round(annual * 0.846 / 12);
  const coveragePct = monthlyExpense > 0 ? afterTaxMonthly / monthlyExpense * 100 : null;
  const schedule = (typeof LOAN_SCHEDULE !== 'undefined' && Array.isArray(LOAN_SCHEDULE))
    ? [...LOAN_SCHEDULE].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
    : [];
  const monthKey = typeof _kstMonthStr === 'function' ? _kstMonthStr() : '';
  const scheduleRow = monthKey ? [...schedule].reverse().find(item => String(item.date || '') <= monthKey) : null;
  const nextRow = monthKey ? schedule.find(item => String(item.date || '') >= monthKey) : null;
  const remainingMonths = monthKey ? schedule.filter(item => String(item.date || '') >= monthKey).length : 0;
  const metric = (label, value, sub, color = 'var(--text)') => `<div class="s2-rounded">
    <div class="lbl-62-muted-3">${label}</div><div style="font-size:.86rem;font-weight:800;color:${color}">${value}</div>
    <div style="font-size:.61rem;color:var(--muted);margin-top:2px">${sub}</div></div>`;

  return `<section style="margin-bottom:12px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--s1)" aria-label="포트폴리오 배당 현황">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div><div style="font-size:.78rem;font-weight:800;color:var(--text)">💰 포트폴리오 배당·은퇴 현황</div>
      <div style="font-size:.62rem;color:var(--muted);margin-top:2px">현재 보유수량과 등록된 배당정보 기준 · 확정 지급액과 향후 예상액 포함</div></div>
      <div style="display:flex;gap:6px"><button type="button" class="btn-ghost-sm" data-portfolio-action="open-dividend">배당 상세</button><button type="button" class="btn-purple-sm" data-portfolio-action="open-retirement">은퇴 점검</button></div>
    </div>
    <div class="retire-metric-grid">
      ${metric('연간 예상 배당 (세전)', fmt(annual), `${dividendRows.length}개 배당 종목`, 'var(--green)')}
      ${metric('월평균 예상 (세전)', fmt(Math.round(annual / 12)), `이번 달 ${fmt(Math.round(currentMonth))}`, 'var(--cyan)')}
      ${metric('올해 확정 배당', fmt(Math.round(actual)), '등록된 실제 배당 이벤트 합계', 'var(--gold)')}
      ${metric('배당수익률', `${yieldPct.toFixed(2)}%`, `배당 종목 매입금액 ${fmt(dividendCost)}`, 'var(--purple-lt)')}
      ${metric('세후 월 현금흐름 참고', fmt(afterTaxMonthly), coveragePct == null ? '은퇴 목표 생활비 미설정' : `목표 월 생활비의 ${coveragePct.toFixed(1)}%`, 'var(--amber)')}
    </div>
    <div style="font-size:.60rem;color:var(--muted);margin-top:8px">세후 월 현금흐름은 일반계좌 배당소득세 15.4%를 일괄 가정한 참고값입니다. ISA·IRP·연금 및 실제 세액은 투자계획의 계좌별 계산을 확인하세요.</div>
    <div style="height:1px;background:var(--border);margin:12px 0"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div><div style="font-size:.74rem;font-weight:800;color:var(--text)">🏠 주담대 상환스케줄</div>
      <div style="font-size:.61rem;color:var(--muted);margin-top:2px">${schedule.length ? `${_escapeHtml(schedule[0]?.date || '-')} ~ ${_escapeHtml(schedule[schedule.length - 1]?.date || '-')} · 총 ${schedule.length}개월` : '등록된 상환스케줄이 없습니다.'}</div></div>
      <button type="button" class="btn-ghost-sm" data-portfolio-action="open-mortgage">부동산·스케줄</button>
    </div>
    ${scheduleRow ? `<div class="retire-metric-grid">
      ${metric('스케줄 기준 대출잔액', fmt(Number(scheduleRow.balance || 0)), `${_escapeHtml(scheduleRow.date || '-')} 기준`, 'var(--red-lt)')}
      ${metric('다음 납입 원금', fmt(Number(nextRow?.principal || 0)), nextRow ? `${_escapeHtml(nextRow.date)} 예정` : '남은 일정 없음', 'var(--cyan)')}
      ${metric('다음 납입 이자', fmt(Number(nextRow?.interest || 0)), nextRow ? `${_escapeHtml(nextRow.date)} 예정` : '남은 일정 없음', 'var(--amber)')}
      ${metric('남은 상환기간', `${remainingMonths.toLocaleString()}개월`, schedule.length ? `최종 ${_escapeHtml(schedule[schedule.length - 1]?.date || '-')}` : '-', 'var(--purple-lt)')}
    </div>` : '<div style="font-size:.65rem;color:var(--muted);padding:8px 0">부동산 탭에서 상환스케줄 CSV를 업로드하면 잔액·다음 원금·이자·남은 기간을 함께 표시합니다.</div>'}
  </section>`;
}

function renderAcctView(area) {
  const accts = ACCT_ORDER.filter(a => a !== '전체');
  const acctOpts = ['전체',...accts].map(a =>
    `<button data-portfolio-action="acct-filter" data-value="${_escapeHtml(a)}" class="${_fBtnClass(acctFilter===a)}">${_escapeHtml(a)}</button>`).join('');

  // ★ [계좌별 taxType] 종류 필터 = 자산 종류만 (ISA/IRP/연금은 계좌 구분으로 이동)
  const typeList = ['전체','주식','ETF','펀드','TDF'];
  const classify = r => {
    const ep = getEP(r.name);
    const epType = getEPType(ep, null);
    if (epType) return epType;
    if (r.type==='펀드'||r.type==='TDF') return r.type;
    if (!r.fund && isEtfByName(r.name)) return 'ETF';
    return '주식';
  };
  const typeOpts = typeList.map(t =>
    `<button data-portfolio-action="type-filter" data-value="${_escapeHtml(t)}" class="${_fBtnClass(typeFilter===t)}">${_escapeHtml(t)}</button>`).join('');

  let html = _buildPortfolioDividendSummary() + `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="txt-muted-72">🏦 계좌</span>
      <div class="flex-wrap-gap4">${acctOpts}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="txt-muted-72">📂 종류</span>
      <div class="flex-wrap-gap4">${typeOpts}</div>
    </div>
  </div>`;

  const acctDataKey = _portfolioDataKey();
  if (_acctEnrichedCache.key !== acctDataKey) {
    _acctEnrichedCache = {
      key: acctDataKey,
      data: rows.map(r => ({...r, classType: classify(r)}))
    };
  }
  const enriched = _acctEnrichedCache.data;
  let data = acctFilter === '전체' ? enriched : enriched.filter(r => r.acct === acctFilter);
  data = typeFilter === '전체' ? data : data.filter(r => r.classType === typeFilter);

  const tableId = 'tbl_acct';
  window._tableData.set(tableId, data);
  window._tableExtra.set(tableId, null);
  html += `<div id="tc_${tableId}">${buildTableInner(data, tableId, null)}</div>`;
  area.innerHTML = html;
}
function setAcctFilter(f) { acctFilter = f; renderView(); renderDonut(); }
function setTypeFilter(f) { typeFilter = f; renderView(); }

// ── 섹터별 뷰
function renderSectorView(area) {
  const sectors = {};
  rows.forEach(r => {
    const s = r.sector || '기타';
    if (!sectors[s]) sectors[s] = { rows:[], eval:0, cost:0, names:new Set() };
    sectors[s].rows.push(r); sectors[s].eval += r.evalAmt; sectors[s].cost += r.costAmt;
    sectors[s].names.add(r.name);
  });

  let html = `<div class="sector-grid">`;
  Object.entries(sectors).sort((a,b) => b[1].eval - a[1].eval).forEach(([sec, d]) => {
    const pnl = d.eval - d.cost, pct = d.cost > 0 ? pnl/d.cost*100 : 0;
    const pC = pColor(pnl), pS = pSign(pnl);
    const color = SECTOR_COLORS[sec] || 'var(--muted)';
    const uniqueNames = new Set(d.rows.map(r => r.name));
    html += `<div class="sector-card">
      <div class="sector-hdr" style="border-left:3px solid ${color};flex-wrap:wrap;gap:6px">
        <h4 style="color:${color}">${sec} <span style="color:var(--muted);font-size:.72rem;font-weight:400">${d.names.size}종목</span></h4>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div class="td-right"><div class="lbl-62-muted">평가금액</div><div class="sval">${fmt(d.eval)}</div></div>
          <div class="td-right"><div class="lbl-62-muted">손익</div><div class="sval" style="color:${pC}">${pS}${fmt(pnl)}</div></div>
          <div class="td-right"><div class="lbl-62-muted">수익률</div><div class="sval" style="color:${pC};font-weight:700">${pS}${pct.toFixed(1)}%</div></div>
        </div>
      </div>`;

    html += `<div class="overflow-x-auto">
      <table style="width:100%;border-collapse:collapse;margin-top:6px">
        <thead><tr style="background:var(--s2);border-bottom:1px solid var(--border)">
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">종목명</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">구분</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">보유 계좌</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">주식수</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">매입단가</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">매입금액</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">현재단가</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">평가금액</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">손익</th>
          <th style="padding:8px 10px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">수익률</th>
        </tr></thead><tbody>`;

    const secMerged = {};
    d.rows.forEach(r => {
      if (!secMerged[r.name]) {
        const ep = getEP(r.name);
        secMerged[r.name] = {
          name:r.name, code:r.code||'', evalAmt:0, costAmt:0, pnl:0,
          acctSet:new Set(), totalQty:0, totalCostAmt:0, curPrice:null,
          epType:getEPType(ep, null)
        };
      }
      const m = secMerged[r.name];
      m.evalAmt    += r.evalAmt; m.costAmt += r.costAmt; m.pnl += r.pnl;
      m.totalQty   += (r.qty||0);
      m.totalCostAmt += (r.costAmt||0);
      if (r.acct) m.acctSet.add(r.acct);
      if (m.curPrice == null && r.price != null) m.curPrice = r.price;
    });
    Object.values(secMerged).sort((a,b) => b.evalAmt - a.evalAmt).forEach(m => {
      const accts = [...m.acctSet];
      const mPct = m.costAmt > 0 ? m.pnl/m.costAmt*100 : 0;
      const rC = pColor(m.pnl), rS = pSign(m.pnl);
      // 평균 매입단가: totalCostAmt / totalQty
      const avgCost = m.totalQty > 0 ? Math.round(m.totalCostAmt / m.totalQty) : null;
      const curPrice = m.curPrice;
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:7px 8px;font-size:.78rem;font-weight:600;text-align:left">
          ${m.name}${m.code?`<span style="display:block;font-size:.65rem;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:1px">${m.code}</span>`:''}
        </td>
        <td style="padding:7px 8px;font-size:.72rem;text-align:center">
          <span class="tag tg-${m.epType}">${m.epType}</span>
        </td>
        <td style="padding:7px 8px;font-size:.72rem;text-align:center">
          <div class="flex-wrap-gap6">
            ${accts.map(a=>`<div style="display:flex;flex-direction:column;align-items:center;gap:2px"><span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span><span style="font-size:.62rem;color:var(--muted)">${a}</span></div>`).join('')}
          </div>
        </td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;font-variant-numeric:tabular-nums">${m.totalQty > 0 ? m.totalQty.toLocaleString() : '-'}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;font-variant-numeric:tabular-nums">${avgCost != null ? avgCost.toLocaleString() : '-'}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right">${fmtW(m.costAmt)}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;font-variant-numeric:tabular-nums">${curPrice != null ? curPrice.toLocaleString() : '-'}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right">${fmtW(m.evalAmt)}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;color:${rC}">${rS}${fmt(m.pnl)}</td>
        <td style="padding:7px 8px;font-size:.78rem;text-align:right;color:${rC};font-weight:700">${rS}${mPct.toFixed(1)}%</td>
      </tr>`;
    });
    html += `</tbody></table></div></div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
}

// ── 도넛 차트 (섹터/종류/종목별)
function renderDonut() {
  const perfRun = window.__pfPerfRun;
  if (window.__pfPerfMode && typeof perfRun === 'function') {
    return perfRun(`renderDonut:${currentView}`, renderDonutCore);
  }
  return renderDonutCore();
}

function renderDonutCore() {
  const canvas = $el('donut-canvas');
  if (!canvas) return;

  const TYPE_CLASSIFY = r => {
    if (r.type==='펀드'||r.type==='TDF') return '펀드/TDF';
    // ★ [계좌별 taxType] 절세계좌 판별은 taxType(계좌 기준) 사용
    const tx = r.taxType || (typeof getAcctTaxType === 'function' ? getAcctTaxType(r.acct) : '일반');
    if (tx==='ISA'||tx==='IRP'||tx==='연금') return '절세계좌';
    if (!r.fund && isEtfByName(r.name)) return 'ETF';
    return '개별주식';
  };
  const TYPE_COLORS = {'개별주식':'var(--green)','ETF':'var(--blue)','펀드/TDF':'var(--purple)','절세계좌':'var(--amber)'};
  const ACCT_PALETTE_FALLBACK = ['var(--green)','var(--blue)','var(--purple)','var(--amber)','var(--red)','var(--pink)','var(--cyan)','var(--gold2)'];

  const collapseToTop = (raw, n=8) => {
    const sorted = Object.entries(raw).sort((a,b) => b[1] - a[1]);
    if (sorted.length <= n) return raw;
    const top = sorted.slice(0, n);
    const etcVal = sorted.slice(n).reduce((s,[,v]) => s+v, 0);
    const result = Object.fromEntries(top);
    if (etcVal > 0) result['기타'] = etcVal;
    return result;
  };

  const donutCacheKey = `${currentView}|${acctFilter}|${_portfolioDataKey()}`;
  let model = _donutModelCache.key === donutCacheKey ? _donutModelCache.model : null;
  if (!model) {
    let totals = {}, getColor, title;
    if (currentView === 'acct') {
      const filteredRows = (acctFilter && acctFilter !== '전체')
        ? rows.filter(r => r.acct === acctFilter)
        : rows;
      if (acctFilter && acctFilter !== '전체') {
        // 특정 계좌 선택 시: 종목별 비중
        title = acctFilter + ' · 종목별 비중';
        filteredRows.forEach(r => { totals[r.name] = (totals[r.name]||0) + r.evalAmt; });
        totals = collapseToTop(totals, 8);
        const acctKeys = Object.keys(totals);
        getColor = k => k === '기타' ? 'var(--muted)' : ACCT_PALETTE_FALLBACK[acctKeys.indexOf(k) % ACCT_PALETTE_FALLBACK.length];
      } else {
        // 전체 계좌: 종류별 비중
        title = '종류별 자산 비중';
        filteredRows.forEach(r => { const k = TYPE_CLASSIFY(r); totals[k] = (totals[k]||0) + r.evalAmt; });
        getColor = k => TYPE_COLORS[k] || 'var(--muted)';
      }
    } else if (currentView === 'sector') {
      title = '섹터별 자산 비중';
      rows.forEach(r => { const k = r.sector||'기타'; totals[k] = (totals[k]||0) + r.evalAmt; });
      getColor = k => SECTOR_COLORS[k] || 'var(--muted)';
    } else if (currentView === 'merge') {
      title = '종목별 자산 비중';
      rows.forEach(r => { const k = r.name; totals[k] = (totals[k]||0) + r.evalAmt; });
      totals = collapseToTop(totals, 8);
      const mergeKeys = Object.keys(totals);
      getColor = k => k === '기타' ? 'var(--muted)' : ACCT_PALETTE_FALLBACK[mergeKeys.indexOf(k) % ACCT_PALETTE_FALLBACK.length];
    } else {
      title = '섹터별 자산 비중';
      rows.forEach(r => { const k = r.sector||'기타'; totals[k] = (totals[k]||0) + r.evalAmt; });
      getColor = k => SECTOR_COLORS[k] || 'var(--muted)';
    }
    model = {
      title,
      getColor,
      entries: Object.entries(totals).sort((a,b) => b[1] - a[1]),
    };
    model.total = model.entries.reduce((s,[,v]) => s+v, 0);
    _donutModelCache = { key: donutCacheKey, model };
  }
  const { title, getColor, entries, total } = model;

  const titleEl = $el('donut-title');
  if (titleEl) titleEl.textContent = title;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 120, 120);

  const leg = $el('donut-legend');

  if (!entries.length || total <= 0) {
    ctx.beginPath(); ctx.arc(60,60,52,0,2*Math.PI);
    ctx.fillStyle = resolveColor('var(--s2)'); ctx.fill();
    ctx.beginPath(); ctx.arc(60,60,28,0,2*Math.PI);
    ctx.fillStyle = resolveColor('var(--s1)'); ctx.fill();
    if (leg) leg.innerHTML = '<div class="legend-label" style="padding:8px">데이터 없음</div>';
    return;
  }

  let start = -Math.PI/2;
  entries.forEach(([k, val]) => {
    const resolvedColor = resolveColor(getColor(k));
    const slice = val/total*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(60,60); ctx.arc(60,60,52,start,start+slice); ctx.closePath();
    ctx.fillStyle = resolvedColor; ctx.fill(); start += slice;
  });
  ctx.beginPath(); ctx.arc(60,60,28,0,2*Math.PI);
  ctx.fillStyle = resolveColor('var(--s1)'); ctx.fill();

  if (!leg) return;
  const legendRows = entries.map(([k, val]) => {
    const rc = resolveColor(getColor(k));
    const pct = (val/total*100).toFixed(1);
    return `<div class="legend-item"><div class="legend-dot" style="background:${rc}"></div><div class="legend-label">${k}</div><div class="legend-val" style="color:${rc}">${pct}% · ${fmt(val)}</div></div>`;
  });
  leg.innerHTML = legendRows.join('');
}

// ── 종목별 합산 뷰
let mergeSortKey = 'eval';
function setMergeSortKey(k) { mergeSortKey = k; renderView(); }

function renderMergeView(area) {
  const mergeDataKey = _portfolioDataKey();

  if (_mergeListCache.key !== mergeDataKey) {
    const merged = {};
    rows.forEach(r => {
      const key = r.name;
      if (!merged[key]) {
        merged[key] = { name:r.name, type:r.type, sector:r.sector, code:r.code||'', evalAmt:0, costAmt:0, pnl:0, acctSet:new Set(), totalQty:0, breakdown:[] };
      }
      const m = merged[key];
      m.evalAmt += r.evalAmt; m.costAmt += r.costAmt; m.pnl += r.pnl;
      m.totalQty += (r.qty || 0);
      if (r.acct) m.acctSet.add(r.acct);
      m.breakdown.push(r);
    });

    _mergeListCache = {
      key: mergeDataKey,
      list: Object.values(merged).map(m => {
        const { acctSet, ...rest } = m;
        return {
          ...rest,
          accts: [...acctSet],
          pct: m.costAmt > 0 ? m.pnl/m.costAmt*100 : 0
        };
      })
    };
  }
  const list = _mergeListCache.list;

  const sortOpts = [{k:'eval',l:'평가금액순'},{k:'pct',l:'수익률순'},{k:'pnl',l:'손익순'},{k:'name',l:'이름순'}];
  const sortLabel = sortOpts.find(o => o.k === mergeSortKey)?.l || '평가금액순';
  const sorted = [...list].sort((a,b) => {
    if (mergeSortKey==='eval') return b.evalAmt - a.evalAmt;
    if (mergeSortKey==='pct')  return b.pct - a.pct;
    if (mergeSortKey==='pnl')  return b.pnl - a.pnl;
    if (mergeSortKey==='name') return a.name.localeCompare(b.name, 'ko');
    return 0;
  });

  const grandEval = sorted.reduce((s,r) => s+r.evalAmt, 0);
  const grandCost = sorted.reduce((s,r) => s+r.costAmt, 0);
  const grandPnl  = grandEval - grandCost;
  const grandPct  = grandCost > 0 ? grandPnl/grandCost*100 : 0;
  const gC = pColor(grandPnl), gS = pSign(grandPnl);

  const thSort = (key, label, isNum=false) => {
    const active = mergeSortKey === key;
    const icon = active ? (key==='name' ? ' ▲' : ' ▼') : '';
    return `<th class="${isNum?'num':''}" style="cursor:pointer;user-select:none;${active?'color:var(--amber)':''}"
      data-portfolio-action="merge-sort" data-key="${_escapeHtml(key)}">${_escapeHtml(label)}${icon}</th>`;
  };

  let html = `<div class="tbl-wrap">
    <div class="tbl-head">
      <h3>🔀 종목별 합산 <span style="color:var(--muted);font-size:.75rem;font-weight:400">(${sorted.length}개 종목)</span>
        <span style="font-size:.70rem;color:var(--amber);margin-left:8px;font-weight:400">▸ ${sortLabel}</span>
      </h3>
      <div class="tsum">평가 <b>${fmt(grandEval)}</b> &nbsp; 손익 <span style="color:${gC}">${gS}${fmt(grandPnl)} (${gS}${grandPct.toFixed(1)}%)</span></div>
    </div>
    <div class="overflow-x-auto"><table><thead><tr>
      ${thSort('name','종목명')}
      <th>구분</th><th>보유 계좌</th>
      <th class="num">주식수</th>
      <th class="num">매입단가</th>
      ${thSort('eval','매입금액',true)}
      <th class="num">현재단가</th>
      ${thSort('eval','평가금액',true)}
      ${thSort('pnl','손익',true)}
      ${thSort('pct','수익률',true)}
      <th class="num">비중</th>
    </tr></thead><tbody>`;

  sorted.forEach((m, idx) => {
    const pC = pColor(m.pnl), pS = pSign(m.pnl);
    const weight = grandEval > 0 ? (m.evalAmt/grandEval*100).toFixed(1) : '0.0';
    const acctNames = m.accts.join(' · ');
    const detailId = 'merge-detail-'+idx;
    const isMulti = m.breakdown.length > 1;
    const acctDots = m.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>`).join('');
    const avgCostMerge = m.totalQty > 0 ? Math.round(m.costAmt / m.totalQty) : null;
    const curPriceMerge = m.breakdown[0]?.price ?? null;

    html += `<tr style="cursor:${isMulti?'pointer':'default'}" ${isMulti?`data-portfolio-action="merge-detail" data-detail-id="${_escapeHtml(detailId)}"`:''} title="${isMulti?'클릭하면 계좌별 상세 보기':''}">
      <td class="fw6"><span data-portfolio-action="trade-group" data-gname="${_escapeHtml(m.name)}" class="dotted-link" title="종목별 거래 보기">${_escapeHtml(m.name)}</span>${isMulti?` <span style="font-size:.65rem;color:var(--pink);margin-left:4px">▸ ${m.breakdown.length}계좌</span>`:''}${m.code?`<span class="lbl-62-mt2">${_escapeHtml(m.code)}</span>`:''}</td>
      <td><span class="tag">${_escapeHtml(m.type)}</span></td>
      <td>${acctDots} <span class="txt-muted-72">${_escapeHtml(acctNames)}</span></td>
      <td class="num">${m.totalQty > 0 ? m.totalQty.toLocaleString() : '-'}</td>
      <td class="num">${avgCostMerge != null ? avgCostMerge.toLocaleString() : '-'}</td>
      <td class="num">${fmtW(m.costAmt)}</td>
      <td class="num">${curPriceMerge != null ? curPriceMerge.toLocaleString() : '-'}</td>
      <td class="num">${fmtW(m.evalAmt)}</td>
      <td class="num" style="color:${pC}">${pS}${fmt(m.pnl)}</td>
      <td class="num" style="color:${pC}">${pS}${m.pct.toFixed(1)}%</td>
      <td>
        <div class="flex-center-gap8">
          <span class="mono" style="font-size:.85rem;font-weight:600;color:var(--pink);min-width:42px">${weight}%</span>
          <div style="width:50px;height:4px;background:var(--s2);border-radius:3px;flex-shrink:0">
            <div style="width:${Math.min(parseFloat(weight),100)}%;height:100%;background:var(--pink);border-radius:3px"></div>
          </div>
        </div>
      </td>
    </tr>`;

    if (isMulti) {
      html += `<tr id="${detailId}" style="display:none;"><td colspan="11" style="padding:0">
        <table style="width:100%;background:var(--s2)"><thead><tr>
          <th class="p-8-14">계좌</th><th class="num">수량</th><th class="num">매수단가</th><th class="num">현재가</th><th class="num">평가금액</th><th class="num">손익</th><th class="num">수익률</th>
        </tr></thead><tbody>`;
      m.breakdown.forEach(r => {
        const rC = pColor(r.pnl), rS = pSign(r.pnl);
        const priceCell = r.fund ? `<span class="c-cyan">${r.price.toLocaleString()}</span>` : r.price ? r.price.toLocaleString() : '-';
        html += `<tr style="border-top:1px solid var(--border)">
          <td class="p-8-14"><span class="adot" style="background:${ACCT_COLORS[r.acct]}"></span>${_escapeHtml(r.acct || '-')}</td>
          <td class="mono">${r.qty!=null?r.qty.toLocaleString():'-'}</td>
          <td class="mono">${r.cost!=null?r.cost.toLocaleString():'-'}</td>
          <td class="mono">${priceCell}</td>
          <td class="mono">${fmtW(r.evalAmt)}</td>
          <td class="mono" style="color:${rC}">${rS}${fmt(r.pnl)}</td>
          <td class="mono" style="color:${rC}">${rS}${r.pct.toFixed(1)}%</td>
        </tr>`;
      });
      html += `</tbody></table></td></tr>`;
    }
  });

  html += `</tbody></table></div></div>`;
  area.innerHTML = html;
}

function toggleMergeDetail(id) {
  const el = $el(id);
  if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
}


// ★ click 핸들러는 event_delegation.js에서 통합 처리
