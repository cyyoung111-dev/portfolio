// ════════════════════════════════════════════════════════════════
//  현재 월 상수 (배당 탭에서 이번달/지난달 구분에 사용)
// ════════════════════════════════════════════════════════════════
const NOW_MONTH = new Date().getMonth() + 1; // 1~12

// ════════════════════════════════════════════════════════════════
//  calcDividends — DIVDATA + rawHoldings 기반 배당 계산
//  반환: [{ name, totalQty, accts, dd, annualDiv }]
// ════════════════════════════════════════════════════════════════
function calcDividends() {
  // 보유 종목별 계좌 집계 (펀드 제외)
  const acctMap = {};
  rawHoldings.filter(h => !h.fund && h.name).forEach(h => {
    if (!acctMap[h.name]) acctMap[h.name] = [];
    if (h.acct && !acctMap[h.name].includes(h.acct)) acctMap[h.name].push(h.acct);
  });

  const now = new Date();
  const thisYear = now.getFullYear();

  const result = [];

  // DIVDATA에 있는 종목 기준으로 계산
  // ★ code 기반 키로 변경 — code → name 역매핑 필요
  const codeToNameMap = {};
  EDITABLE_PRICES.forEach(ep => {
    if (ep.code) codeToNameMap[ep.code] = ep.name;
  });

  Object.entries(DIVDATA).forEach(([key, dd]) => {
    if (!dd || !dd.perShare || dd.perShare <= 0) return;
    if (!dd.months || dd.months.length === 0) return;

    // key가 코드이면 name으로 역매핑, 아니면 key 자체가 name
    const name = codeToNameMap[key] || key;
    const accts = acctMap[name] || [];

    // ★ 월별 기준일(해당 월 말일) 보유수량으로 배당금 계산
    let annualDiv = 0;
    const monthlyDiv = {}; // month → 배당금
    dd.months.forEach(month => {
      const refDate = getDivRefDate(thisYear, month);
      const qty = (typeof getQtyAtDate === 'function')
        ? getQtyAtDate(name, refDate)
        : rawHoldings.filter(h => h.name === name && !h.fund).reduce((s,h) => s+(h.qty||0), 0);
      if (qty > 0) {
        const div = dd.perShare * qty;
        annualDiv += div;
        monthlyDiv[month] = div;
      }
    });

    // 현재 보유수량 (표시용)
    const totalQty = rawHoldings.filter(h => h.name === name && !h.fund)
      .reduce((s, h) => s + (h.qty || 0), 0);

    if (annualDiv > 0 || totalQty > 0) {
      result.push({ name, totalQty, accts, dd, annualDiv, monthlyDiv });
    }
  });

  return result;
}

function renderDivView(area, skipFetch) {
  // GS 연동 시 탭 진입마다 자동 fetch → 완료 후 재렌더 (skipFetch=true 시 생략 — 재귀 방지)
  if (GSHEET_API_URL && !skipFetch) _autoFetchDiv(area);

  const divRows = calcDividends();
  const totalAnnual   = divRows.reduce((s,r)=>s+r.annualDiv,0);
  const totalAfterTax = Math.round(totalAnnual * 0.846);
  const monthlyAvg    = Math.round(totalAnnual / 12);
  const monthlyAfter  = Math.round(totalAfterTax / 12);

  // 투자원금 합산 (rows 기준, 배당 종목만)
  const divNames = new Set(divRows.map(r=>r.name));
  const totalCostForDiv = rows.filter(r=>divNames.has(r.name)).reduce((s,r)=>s+(r.costAmt||0),0);
  const yieldPct = totalCostForDiv > 0 ? (totalAnnual / totalCostForDiv * 100) : 0;

  // 월별 배당 집계
  const monthly = Array(12).fill(0);
  // ★ monthlyDiv: 월별 기준일 보유수량 반영된 배당금
  divRows.forEach(r => {
    if (r.monthlyDiv) {
      Object.entries(r.monthlyDiv).forEach(([m, div]) => { monthly[Number(m)-1] += div; });
    } else {
      r.dd.months.forEach(m => { monthly[m-1] += r.dd.perShare * r.totalQty; });
    }
  });

  // 올해 지난달까지 누적 수령액
  const receivedSoFar = monthly.slice(0, NOW_MONTH - 1).reduce((s,v)=>s+v, 0);
  const remainingYear = monthly.slice(NOW_MONTH - 1).reduce((s,v)=>s+v, 0);

  let html = `


  <!-- ── 배당 재동기화 배너 ── -->
  <div style="margin-bottom:14px">
    ${renderTabSyncPanel('div')}
    <div style="font-size:.65rem;color:var(--muted);margin-top:-4px;padding:0 2px">
      ${GSHEET_API_URL ? '탭 진입 시 자동 조회 · 필요 시 🔄 재동기화로 즉시 갱신' : '재동기화 설정 필요'}
    </div>
  </div>

  <!-- ── 요약 카드 5개 — PC: 1줄, 모바일: 2×2+1 ── -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px" class="div-summary-grid">
    <div class="div-stat-card">
      <div class="div-stat-label">💸 연간 예상 (세전)</div>
      <div class="div-stat-value" style="color:var(--cyan)">${fmtW(Math.round(totalAnnual))}</div>
      <div class="div-stat-sub">배당 종목 ${divRows.length}개</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">📅 월 평균 (세전)</div>
      <div class="div-stat-value c-green">${fmtW(monthlyAvg)}</div>
      <div class="div-stat-sub">세후 ${fmtW(monthlyAfter)}/월</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">🏦 세후 연간 (15.4%)</div>
      <div class="div-stat-value c-amber">${fmtW(totalAfterTax)}</div>
      <div class="div-stat-sub">일반계좌 기준</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">📊 배당수익률</div>
      <div class="div-stat-value" style="color:var(--purple)">${yieldPct.toFixed(2)}<span style="font-size:.65rem">%</span></div>
      <div class="div-stat-sub">투자원금 대비 연간</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">✅ 올해 수령 (${NOW_MONTH-1}월까지)</div>
      <div class="div-stat-value c-green">${fmtW(Math.round(receivedSoFar))}</div>
      <div class="div-stat-sub">남은 예상 ${fmtW(Math.round(remainingYear))}</div>
    </div>
  </div>

  <!-- ── 월별 바 차트 ── -->
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
      <div>
        <div style="font-size:.85rem;font-weight:700">📅 ${new Date().getFullYear()}년 월별 배당 예상</div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:2px">세전 기준 · 현재월 <span style="color:var(--cyan)">${NOW_MONTH}월</span></div>
      </div>
      <div style="display:flex;gap:10px;font-size:.63rem;color:var(--muted);align-items:center;flex-shrink:0">
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:rgba(255,255,255,.18);margin-right:3px;vertical-align:middle"></span>지난달</span>
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--cyan);margin-right:3px;vertical-align:middle"></span>이번달</span>
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--green);margin-right:3px;vertical-align:middle"></span>예정</span>
      </div>
    </div>
    <div style="display:flex;align-items:flex-end;gap:3px;height:110px;padding-bottom:18px;position:relative">
      ${(() => {
        const maxV = Math.max(...monthly, 1);
        return monthly.map((v, i) => {
          const isPast    = (i + 1) < NOW_MONTH;
          const isCurrent = (i + 1) === NOW_MONTH;
          const pct = v > 0 ? Math.max((v / maxV) * 100, 3) : 1;
          const label = v > 0 ? (v >= 1000000 ? (v/10000).toFixed(0)+'만' : v >= 10000 ? Math.round(v/1000)+'천' : v.toLocaleString()) : '';
          const bg = isCurrent
            ? 'linear-gradient(to top,rgba(6,182,212,.3),rgba(6,182,212,1))'
            : isPast
            ? 'rgba(255,255,255,.12)'
            : 'linear-gradient(to top,rgba(16,185,129,.25),rgba(16,185,129,.85))';
          const border = isCurrent ? '1px solid rgba(6,182,212,.8)' : 'none';
          const labelColor = isCurrent ? 'var(--cyan)' : isPast ? 'rgba(255,255,255,.3)' : 'var(--green)';
          const monthColor = isCurrent ? 'var(--cyan)' : 'rgba(100,116,139,.85)';
          const fw = isCurrent ? '700' : '400';
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
            ${label ? `<div style="font-size:8px;color:${labelColor};font-weight:${fw};margin-bottom:2px;white-space:nowrap;overflow:hidden;max-width:100%;text-align:center">${label}</div>` : '<div style="margin-bottom:10px"></div>'}
            <div style="width:100%;height:${pct}%;background:${bg};border:${border};border-radius:3px 3px 0 0;box-shadow:${isCurrent?'0 0 6px var(--c-cyan-50)':'none'}"></div>
            <div style="font-size:8px;color:${monthColor};font-weight:${fw};margin-top:2px">${i+1}월</div>
          </div>`;
        }).join('');
      })()}
    </div>
  </div>`;

  // ── 종목별 배당 테이블 (PC: 풀 테이블, 모바일: 카드형)
  const sorted = [...divRows].sort((a,b)=>b.annualDiv-a.annualDiv);

  // PC 테이블
  html += `
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden" class="div-tbl-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
      <h3 style="margin:0;font-size:.88rem;font-weight:700">💸 종목별 배당 상세</h3>
      <div style="font-size:.70rem;color:var(--cyan)">연간 합계 <b>${fmtW(Math.round(totalAnnual))}</b></div>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table style="width:100%;border-collapse:collapse;min-width:560px">
      <thead>
        <tr style="background:var(--s2)">
          <th style="padding:7px 14px;text-align:left;font-size:.68rem;color:var(--muted);font-weight:600">종목명</th>
          <th style="padding:7px 8px;text-align:center;font-size:.68rem;color:var(--muted);font-weight:600">주기</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">수량</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">주당</th>
          <th style="padding:7px 8px;text-align:left;font-size:.68rem;color:var(--muted);font-weight:600">지급월</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">연간(세전)</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">월(세전)</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">수익률</th>
        </tr>
      </thead>
      <tbody>`;

  sorted.forEach(r => {
    const acctDots  = r.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>`).join('');
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.58rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
    const freqColors = { '월배당':'var(--green)', '분기':'var(--blue)', '반기':'var(--purple)', '연간':'var(--amber)' };
    const fCol = freqColors[r.dd.freq] || 'var(--muted)';
    const costAmt = rows.filter(rr=>rr.name===r.name).reduce((s,rr)=>s+(rr.costAmt||0),0);
    const yld = costAmt > 0 ? (r.annualDiv / costAmt * 100).toFixed(2) : '-';
    const monthlyDiv = Math.round(r.annualDiv / 12);

    html += `<tr style="border-top:1px solid var(--border)">
      <td style="padding:9px 14px">
        <div style="font-weight:600;font-size:.82rem">${r.name}</div>
        <div style="font-size:.63rem;color:var(--muted);margin-top:1px">${acctDots} ${r.accts.join('·')}</div>
      </td>
      <td style="padding:9px 8px;text-align:center">
        <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.63rem;font-weight:700;background:${fCol}22;color:${fCol}">${r.dd.freq}</span>
      </td>
      <td style="padding:9px 8px;text-align:right;font-size:.82rem;font-variant-numeric:tabular-nums">${r.totalQty.toLocaleString()}</td>
      <td style="padding:9px 8px;text-align:right;font-size:.82rem;font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}원</td>
      <td style="padding:9px 8px">${monthBadges}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--cyan);font-weight:600;font-variant-numeric:tabular-nums">${fmtW(Math.round(r.annualDiv))}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--green);font-variant-numeric:tabular-nums">${fmtW(monthlyDiv)}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--purple);font-variant-numeric:tabular-nums">${yld !== '-' ? yld+'%' : '-'}</td>
    </tr>`;
  });

  html += `</tbody></table></div></div>`;

  // ── 모바일 카드형 (JS로 화면 폭 분기)
  html += `<div class="div-card-list" style="display:none;margin-bottom:14px">`;
  sorted.forEach(r => {
    const freqColors = { '월배당':'var(--green)', '분기':'var(--blue)', '반기':'var(--purple)', '연간':'var(--amber)' };
    const fCol = freqColors[r.dd.freq] || 'var(--muted)';
    const costAmt = rows.filter(rr=>rr.name===r.name).reduce((s,rr)=>s+(rr.costAmt||0),0);
    const yld = costAmt > 0 ? (r.annualDiv / costAmt * 100).toFixed(2) : '-';
    const monthlyDiv = Math.round(r.annualDiv / 12);
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.58rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
    const acctDots = r.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}"></span>`).join('');
    html += `
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:1px">${acctDots} ${r.accts.join('·')}</div>
        </div>
        <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:.62rem;font-weight:700;background:${fCol}22;color:${fCol};flex-shrink:0;margin-left:8px">${r.dd.freq}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.75rem">
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.60rem;color:var(--muted);margin-bottom:2px">연간(세전)</div>
          <div style="font-weight:700;color:var(--cyan);font-variant-numeric:tabular-nums">${fmtW(Math.round(r.annualDiv))}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.60rem;color:var(--muted);margin-bottom:2px">월(세전)</div>
          <div style="font-weight:600;color:var(--green);font-variant-numeric:tabular-nums">${fmtW(monthlyDiv)}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.60rem;color:var(--muted);margin-bottom:2px">주당 배당금</div>
          <div style="font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}원</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.60rem;color:var(--muted);margin-bottom:2px">수익률</div>
          <div style="color:var(--purple);font-variant-numeric:tabular-nums">${yld !== '-' ? yld+'%' : '-'}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:.62rem;color:var(--muted)">지급월: ${monthBadges || '-'}</div>
    </div>`;
  });
  html += `</div>`;

  // 배당 없는 종목
  const noDivNames = rawHoldings
    .filter(h => {
      if (h.fund) return false;
      const divKey = (typeof getDivKey === 'function') ? getDivKey(h.name) : h.name;
      const dd = DIVDATA[divKey] || DIVDATA[h.name];
      return !dd || dd.perShare === 0;
    })
    .map(h=>h.name).filter((v,i,a)=>a.indexOf(v)===i);
  if (noDivNames.length > 0) {
    html += `<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:.75rem;color:var(--muted);margin-bottom:14px">
      <span style="font-weight:600;color:var(--text)">🚫 배당 없는 종목</span>
      <span style="margin-left:8px">${noDivNames.join(' · ')}</span>
    </div>`;
  }

  // 배당 설정 수동 편집
  html += `<div class="card-12">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:.78rem;font-weight:700;color:var(--gold)">⚙️ 배당 설정 수동 편집</div>
      <button onclick="applyDivChanges()" class="btn-amber-sm">💾 저장</button>
    </div>
    <div id="divMgmtBody" style="max-height:420px;overflow-y:auto"></div>
  </div>`;

  area.innerHTML = html;
  buildDivMgmt();

  // ── PC/모바일 분기: 560px 이하면 카드형, 초과면 테이블
  (function applyDivLayout() {
    const tbl  = area.querySelector('.div-tbl-wrap');
    const card = area.querySelector('.div-card-list');
    const grid = area.querySelector('.div-summary-grid');
    if (!tbl || !card) return;
    const isMobile = window.innerWidth <= 560;
    tbl.style.display  = isMobile ? 'none' : '';
    card.style.display = isMobile ? '' : 'none';
    if (grid) grid.style.gridTemplateColumns = isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)';
    // 모바일 요약 카드 5번째 항목 full-width
    if (grid) {
      const cards = grid.querySelectorAll('.div-stat-card');
      if (cards.length === 5) {
        cards[4].style.gridColumn = isMobile ? 'span 2' : '';
      }
    }
  })();
}

// LOAN VIEW + 부동산
// LOAN, REAL_ESTATE 선언 → loadHoldings 앞으로 이동 (복원 순서 보장)

function saveRealEstate() {
  persistRealEstateSettings(true);
}

function openLoanEditor() {
  $el('le-originalAmt').value = LOAN.originalAmt.toLocaleString();
  $el('le-balance').value = LOAN.balance.toLocaleString();
  $el('le-annualRate').value = LOAN.annualRate;
  $el('le-totalMonths').value = LOAN.totalMonths;
  $el('le-remainingMonths').value = LOAN.remainingMonths;
  $el('le-startDate').value = LOAN.startDate || '';
  $el('le-monthlyInterestPaid').value = LOAN.monthlyInterestPaid ? LOAN.monthlyInterestPaid.toLocaleString() : '';
  $el('le-totalInterestPaid').value = LOAN.totalInterestPaid ? LOAN.totalInterestPaid.toLocaleString() : '';
  // 스케줄 있을 때 실제 이자지급액 입력행 숨김 (스케줄이 자동 입력)
  const intRow = $el('le-monthlyInterestPaid')?.closest('.editor-row');
  if (intRow) intRow.style.display = LOAN_SCHEDULE.length > 0 ? 'none' : '';
  $el('loanEditor').classList.add('open');
}
function closeLoanEditor() {
  $el('loanEditor').classList.remove('open');
}
function applyLoan() {
  const bal    = parseInt($el('le-balance').value.replace(/,/g,''));
  const rate   = parseFloat($el('le-annualRate').value);
  const total  = parseInt($el('le-totalMonths').value);
  const remain = parseInt($el('le-remainingMonths').value);
  const orig   = parseInt($el('le-originalAmt').value.replace(/,/g,''));
  const startDate = $el('le-startDate').value || '';
  const interestPaid      = parseInt(($el('le-monthlyInterestPaid').value||'0').replace(/,/g,'')) || 0;
  const totalInterestPaid = parseInt(($el('le-totalInterestPaid').value||'0').replace(/,/g,'')) || 0;
  if(!bal || !rate || !total || !remain) { showToast('필수 항목을 입력해주세요', 'warn'); return; }
  LOAN.originalAmt          = orig || LOAN.originalAmt;
  LOAN.balance              = bal;
  LOAN.annualRate           = rate;
  LOAN.totalMonths          = total;
  LOAN.remainingMonths      = remain;
  LOAN.startDate            = startDate;
  // 스케줄 있을 때는 스케줄 값 유지 (에디터 입력값으로 덮어쓰지 않음)
  if (LOAN_SCHEDULE.length === 0) LOAN.monthlyInterestPaid = interestPaid;
  LOAN.totalInterestPaid    = totalInterestPaid;
  // startYear 도 startDate에서 자동 추출
  if (startDate) LOAN.startYear = parseInt(startDate.slice(0,4));
  persistRealEstateSettings(true);
  renderSummary();
  renderView();
  closeLoanEditor();
}

// ── 상환스케줄 / 부동산 시가이력 전역 변수
// LOAN_SCHEDULE: [{date:'2024-01', balance:356550000, principal:450000, interest:1200000}]
// RE_VALUE_HIST:  [{date:'2024-01', value:480000000}]
// ★ 선언과 동시에 localStorage에서 복원 (IIFE 재할당 패턴 제거)
let LOAN_SCHEDULE = lsGet(LOAN_SCHEDULE_KEY, []);
let RE_VALUE_HIST  = lsGet(RE_VALUE_KEY, []);

function saveSchedule() {
  persistRealEstateSettings(true);
}

// ── 자산/대출 통합 뷰
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

// ── 상환스케줄 섹션 HTML 빌더
function buildScheduleSection() {
  const hasSched = LOAN_SCHEDULE.length > 0;
  const hasVal   = RE_VALUE_HIST.length > 0;

  // 시가 이력 테이블 행
  const valRows = RE_VALUE_HIST.slice().sort((a,b)=>b.date.localeCompare(a.date))
    .map((r,i) => `<tr>
      <td style="padding:5px 8px;font-size:.75rem;color:var(--muted)">${fmtDateDot(r.date)}</td>
      <td style="padding:5px 8px;font-size:.78rem;font-weight:600;color:var(--amber);text-align:right">${fmt(r.value)}</td>
      <td style="padding:5px 8px;text-align:right">
        <button onclick="removeReValue(${i})"
          style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.72rem;padding:2px 6px;border-radius:4px"
          onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">✕</button>
      </td>
    </tr>`).join('');

  return `
  <!-- ── 상환스케줄 CSV 업로드 ── -->
  <div class="card-12-p20">
    <div class="flex-between-mb14">
      <h4 class="h3-card">📋 상환스케줄 · 손익 분석</h4>
      <div style="display:flex;gap:8px">
        <button onclick="downloadScheduleTemplate()" class="btn-amber-outline" style="font-size:.72rem">📥 양식</button>
        <label class="btn-amber-outline" style="font-size:.72rem;cursor:pointer">
          📂 CSV 업로드
          <input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="uploadScheduleCsv(this)">
        </label>
        ${hasSched ? `<button onclick="clearSchedule()" style="background:none;border:1px solid var(--c-red-30);color:var(--red);border-radius:6px;padding:4px 10px;font-size:.72rem;cursor:pointer">🗑 초기화</button>` : ''}
      </div>
    </div>

    ${!hasSched ? `
    <div style="text-align:center;padding:24px 0;color:var(--muted);font-size:.78rem">
      <div style="font-size:1.6rem;margin-bottom:8px">📂</div>
      상환스케줄 CSV를 업로드하면 월별 손익 차트를 볼 수 있어요<br>
      <span style="font-size:.70rem;opacity:.7">날짜, 대출잔액, 납입원금, 납입이자 컬럼이 필요합니다</span>
    </div>` : `
    <div style="font-size:.72rem;color:var(--muted);margin-bottom:12px">
      총 <strong class="c-text">${LOAN_SCHEDULE.length}개월</strong> 데이터 ·
      ${fmtDateDot(LOAN_SCHEDULE[0]?.date)} ~ ${fmtDateDot(LOAN_SCHEDULE[LOAN_SCHEDULE.length-1]?.date)}
    </div>
    <div id="scheduleChartWrap" style="width:100%;overflow-x:auto"></div>`}
  </div>

  <!-- ── 부동산 시가 이력 ── -->
  <div class="card-12-p20">
    <div class="flex-between-mb14">
      <h4 class="h3-card">🏠 부동산 시가 이력</h4>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;align-items:flex-end">
      <div>
        <div class="txt-70-muted-mb4">날짜 (YYYY-MM)</div>
        <input type="month" id="re-val-date"
          style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem">
      </div>
      <div>
        <div class="txt-70-muted-mb4">시가 (원)</div>
        <input type="text" id="re-val-price" placeholder="480,000,000"
          style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:.78rem;width:150px"
          oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')">
      </div>
      <button onclick="addReValue()"
        style="background:var(--c-amber-15);border:1px solid var(--c-amber-30);color:var(--amber);border-radius:6px;padding:6px 14px;font-size:.78rem;cursor:pointer">
        ➕ 추가
      </button>
    </div>
    ${hasVal ? `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th class="td-header-muted">날짜</th>
        <th class="td-header-muted">시가</th>
        <th style="border-bottom:1px solid var(--border)"></th>
      </tr></thead>
      <tbody>${valRows}</tbody>
    </table>` : `
    <div style="font-size:.75rem;color:var(--muted);text-align:center;padding:12px 0">
      시가를 날짜별로 입력하면 상환스케줄 차트에 손익이 함께 표시됩니다
    </div>`}
  </div>`;
}

// ── 시가 이력 추가 / 삭제
function addReValue() {
  const dateEl  = $el('re-val-date');
  const priceEl = $el('re-val-price');
  if (!dateEl || !priceEl) return;
  const date  = dateEl.value;  // YYYY-MM
  const price = parseInt((priceEl.value||'').replace(/,/g,'')) || 0;
  if (!date) { showToast('날짜를 입력해주세요', 'warn'); return; }
  if (price <= 0) { showToast('시가를 입력해주세요', 'warn'); return; }
  const idx = RE_VALUE_HIST.findIndex(r => r.date === date);
  if (idx >= 0) RE_VALUE_HIST[idx].value = price;
  else RE_VALUE_HIST.push({ date, value: price });
  RE_VALUE_HIST.sort((a,b) => a.date.localeCompare(b.date));
  saveSchedule();
  dateEl.value = ''; priceEl.value = '';
  if (currentView === 'asset') renderView();
  showToast('시가 이력 추가됨', 'ok');
}

function removeReValue(sortedIdx) {
  const sorted = RE_VALUE_HIST.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const target = sorted[sortedIdx];
  if (!target) return;
  const idx = RE_VALUE_HIST.findIndex(r => r.date === target.date);
  if (idx >= 0) RE_VALUE_HIST.splice(idx, 1);
  saveSchedule();
  if (currentView === 'asset') renderView();
}

// ── 상환스케줄 CSV 양식 다운로드
function downloadScheduleTemplate() {
  if (typeof XLSX === 'undefined') { showToast('라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.', 'warn'); return; }
  const wb  = XLSX.utils.book_new();
  const rows = [
    ['날짜', '대출잔액', '납입원금', '납입이자'],
    ['2024-01', 356550000, 450000, 1200000],
    ['2024-02', 356098000, 452000, 1198000],
    ['2024-03', 355644000, 454000, 1196000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:16},{wch:14},{wch:14}];
  ['A1','B1','C1','D1'].forEach(cell => {
    if (!ws[cell]) return;
    ws[cell].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: 'center' }
    };
  });
  XLSX.utils.book_append_sheet(wb, ws, '상환스케줄');
  XLSX.writeFile(wb, '상환스케줄_양식.xlsx');
}

// ── CSV 업로드 파싱
function uploadScheduleCsv(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  parseUploadFile(file, (headers, rows) => {
    const colIdx = {
      date:      headers.findIndex(h => h.includes('날짜') || h.toLowerCase().includes('date')),
      balance:   headers.findIndex(h => h.includes('잔액') || h.toLowerCase().includes('balance')),
      principal: headers.findIndex(h => h.includes('원금') || h.toLowerCase().includes('principal')),
      interest:  headers.findIndex(h => h.includes('이자') || h.toLowerCase().includes('interest')),
    };
    const missing = Object.entries(colIdx).filter(([,v]) => v < 0).map(([k]) => k);
    if (missing.length > 0) { showToast('컬럼을 찾을 수 없어요: ' + missing.join(', '), 'error', 5000); return; }

    const parsed = [];
    rows.forEach(cols => {
      const rawDate = cols[colIdx.date] || '';
      if (!rawDate) return;
      let date;
      if (/^\d{5}$/.test(rawDate)) {
        const d = new Date(Math.round((Number(rawDate) - 25569) * 86400 * 1000));
        date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      } else {
        date = String(rawDate).slice(0,7);
      }
      const balance   = parseInt(String(cols[colIdx.balance]   ||0).replace(/,/g,'')) || 0;
      const principal = parseInt(String(cols[colIdx.principal] ||0).replace(/,/g,'')) || 0;
      const interest  = parseInt(String(cols[colIdx.interest]  ||0).replace(/,/g,'')) || 0;
      if (balance === 0 && principal === 0 && interest === 0) return;
      parsed.push({ date, balance, principal, interest });
    });

    if (parsed.length === 0) { showToast('파싱된 데이터가 없습니다', 'error'); return; }
    parsed.sort((a,b) => a.date.localeCompare(b.date));
    LOAN_SCHEDULE.length = 0;
    parsed.forEach(r => LOAN_SCHEDULE.push(r));
    saveSchedule();
    if (currentView === 'asset') renderView();
    showToast('✅ ' + parsed.length + '개월 데이터 업로드 완료', 'ok', 4000);
    _promptLoanFromSchedule(parsed);
  });
}

function _promptLoanFromSchedule(schedule) {
  const todayStr = new Date().toISOString().slice(0, 7);
  let curRow = schedule.find(r => r.date === todayStr);
  if (!curRow) curRow = [...schedule].reverse().find(r => r.date <= todayStr);
  if (!curRow) return;

  const totalMonths     = schedule.length;
  const remainingMonths = schedule.filter(r => r.date >= todayStr).length;
  const totalInterestPaid = schedule
    .filter(r => r.date <= todayStr)
    .reduce((s, r) => s + (r.interest || 0), 0);

  const fmtN = v => v.toLocaleString() + '원';
  const msg =
    `📋 스케줄 기준으로 대출 정보를 자동 채울까요?\n\n` +
    `• 현재 잔액        ${fmtN(curRow.balance)}\n` +
    `• 이번 달 원금상환  ${fmtN(curRow.principal)}\n` +
    `• 이번 달 이자      ${fmtN(curRow.interest)}\n` +
    `• 남은 개월수      ${remainingMonths}개월\n` +
    `• 전체 개월수      ${totalMonths}개월\n` +
    `• 누적 이자        ${fmtN(totalInterestPaid)}\n\n` +
    `(금리·대출실행일·대출원금은 기존 값 유지)`;

  if (!confirm(msg)) return;

  LOAN.balance             = curRow.balance;
  LOAN.monthlyInterestPaid = curRow.interest;
  LOAN.totalMonths         = totalMonths;
  LOAN.remainingMonths     = remainingMonths;
  LOAN.totalInterestPaid   = totalInterestPaid;
  _loanSyncedMonth = todayStr;
  persistRealEstateSettings(true);
  renderSummary();
  if (currentView === 'asset') renderView();
  showToast('대출 정보가 스케줄 기준으로 업데이트됐어요', 'ok');
}

function clearSchedule() {
  if (!confirm('상환스케줄 데이터를 초기화할까요?')) return;
  LOAN_SCHEDULE.length = 0;
  saveSchedule();
  if (currentView === 'asset') renderView();
}

// ── 상환스케줄 손익 차트 렌더링 (SVG)
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
    <div class="flex-gap6-ai">
      <svg width="28" height="12"><line x1="0" y1="6" x2="28" y2="6" stroke="var(--amber)" stroke-width="2.5" stroke-dasharray="5,3" stroke-linecap="round"/></svg>
      <span class="txt-75-slate">순자산 (시가−잔액)</span>
      ${latestEq != null ? `<span style="font-size:.78rem;font-weight:700;color:var(--amber);margin-left:4px">${yLbl(latestEq)}</span>` : ''}
    </div>` : ''}
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--c-black-20);padding:6px 12px;border-radius:8px">
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

