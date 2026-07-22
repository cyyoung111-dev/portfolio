// ════════════════════════════════════════════════════════════════
//  views_div_asset.js — 배당 뷰 (calcDividends, renderDivView)
//  의존: data.js, settings.js, mgmt_div.js
// ════════════════════════════════════════════════════════════════
// ★ [버그수정] new Date().getMonth() 파일 로드 시 1회 고정 → 함수 호출로 교체
//   calcDividends() / renderDivView() 호출 시점의 KST 월을 정확히 반영
function _getNowMonth() { return _kstNow().getUTCMonth() + 1; }

// ════════════════════════════════════════════════════════════════
//  calcDividends — DIVDATA + rawHoldings 기반 배당 계산
//  반환: [{ name, totalQty, accts, dd, annualDiv }]
// ════════════════════════════════════════════════════════════════
// 수량 0 종목 숨김 상태
let _divHideZeroQty = typeof lsGet === 'function' ? lsGet(DIV_HIDE_ZERO_KEY, false) : false;

function calcDividends() {
  // 보유 종목별 계좌 집계 (펀드 제외)
  const acctMap = {};
  rawHoldings.filter(h => !h.fund && h.name).forEach(h => {
    if (!acctMap[h.name]) acctMap[h.name] = [];
    if (h.acct && !acctMap[h.name].includes(h.acct)) acctMap[h.name].push(h.acct);
  });

  // ★ [버그수정] new Date() 로컬 타임존 → _kstYear() 으로 교체
  const thisYear = _kstYear();

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

    // ★ 실제 배당 이벤트가 있으면 해당 배당 기준일 보유수량 × 실제 주당배당금으로 우선 계산
    //   아직 이벤트가 없는 미래 지급월은 기존 perShare 평균값으로 예상치를 채워 연간 전망을 유지합니다.
    let annualDiv = 0;
    let actualDiv = 0;
    const monthlyDiv = {}; // month → 실제+예상 배당금
    const actualMonths = new Set();
    const events = Array.isArray(dd.events) ? dd.events : [];
    events.forEach(ev => {
      const evDate = String(ev?.date || '').slice(0, 10);
      const amount = Number(ev?.amount || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evDate) || !amount || amount <= 0) return;
      if (Number(evDate.slice(0, 4)) !== thisYear) return;
      const payDate = String(ev?.payDate || '').slice(0, 10);
      const cashflowDate = /^\d{4}-\d{2}-\d{2}$/.test(payDate) ? payDate : evDate;
      const month = Number(cashflowDate.slice(5, 7));
      const qty = (typeof getQtyAtDate === 'function')
        ? getQtyAtDate(name, evDate)
        : rawHoldings.filter(h => h.name === name && !h.fund).reduce((s,h) => s+(h.qty||0), 0);
      if (qty <= 0) return;
      const div = amount * qty;
      actualMonths.add(month);
      actualDiv += div;
      annualDiv += div;
      monthlyDiv[month] = (monthlyDiv[month] || 0) + div;
    });

    dd.months.forEach(month => {
      if (actualMonths.has(Number(month))) return;
      const refDate = getDivRefDate(thisYear, month);
      const qty = (typeof getQtyAtDate === 'function')
        ? getQtyAtDate(name, refDate)
        : rawHoldings.filter(h => h.name === name && !h.fund).reduce((s,h) => s+(h.qty||0), 0);
      if (qty > 0) {
        const div = dd.perShare * qty;
        annualDiv += div;
        monthlyDiv[month] = (monthlyDiv[month] || 0) + div;
      }
    });

    // 현재 보유수량 (표시용)
    const totalQty = rawHoldings.filter(h => h.name === name && !h.fund)
      .reduce((s, h) => s + (h.qty || 0), 0);

    if (annualDiv > 0 || totalQty > 0) {
      result.push({ name, totalQty, accts, dd, annualDiv, monthlyDiv, actualDiv });
    }
  });

  return result;
}

function renderDivView(area, skipFetch) {
  // GS 연동 시 탭 진입마다 자동 fetch → 완료 후 재렌더 (skipFetch=true 시 생략 — 재귀 방지)
  if (GSHEET_API_URL && !skipFetch) _autoFetchDiv(area);

  // ★ [버그수정] NOW_MONTH(파일 로드 시 고정값) 대신 렌더링 시점의 KST 월/연도 사용
  const nowMonth  = _getNowMonth();
  const nowYear   = _kstYear();

  // 수량 0 숨김 적용
  const allDivRows = calcDividends();
  const divRows = _divHideZeroQty ? allDivRows.filter(r => r.totalQty > 0) : allDivRows;
  const totalAnnual   = divRows.reduce((s,r)=>s+r.annualDiv,0);
  const totalActual   = divRows.reduce((s,r)=>s+(r.actualDiv||0),0);
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
  const receivedSoFar = monthly.slice(0, nowMonth - 1).reduce((s,v)=>s+v, 0);
  const remainingYear = monthly.slice(nowMonth - 1).reduce((s,v)=>s+v, 0);

  const publicKeySaved = (typeof lsGet === 'function') ? String(lsGet('public_data_api_key', '') || '') : '';

  let html = `

  <!-- ── 배당 재동기화 + 배당금 불러오기 ── -->
  <div style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:10px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="font-size:.70rem;font-weight:700;color:var(--text)">🔄 수동 재동기화</div>
        <span id="sync-badge-div" style="font-size:.68rem;color:var(--muted)"></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${GSHEET_API_URL ? `<button id="divFetchBtn" data-div-action="fetch" class="btn-amber-sm">🔄 배당금 불러오기</button>` : ''}
        <button data-sync-tab="div" id="sync-btn-div" class="btn-purple-sm" ${GSHEET_API_URL ? '' : 'disabled'}>🔄 재동기화</button>
      </div>
    </div>
    <div style="font-size:.65rem;color:var(--muted);margin-top:4px;padding:0 2px">
      ${GSHEET_API_URL ? '탭 진입 시 공공데이터 우선 조회 · 누락 종목은 GOOGLEFINANCE fallback/수동 입력값 유지' : '재동기화 설정 필요'}
    </div>
  </div>

  <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <div style="font-size:.70rem;font-weight:700;color:var(--text)">🧾 공공데이터포털 배당 API</div>
        <div style="font-size:.62rem;color:var(--muted);margin-top:2px">무료 API 키가 있으면 주식배당정보를 먼저 조회하고, 실패/누락분만 GOOGLEFINANCE로 보완합니다.</div>
      </div>
      <span style="font-size:.62rem;color:${publicKeySaved ? 'var(--green-lt)' : 'var(--amber)'};border:1px solid var(--border);border-radius:999px;padding:3px 8px;background:var(--s1)">${publicKeySaved ? '키 저장됨' : '키 미설정'}</span>
    </div>
    <div style="display:flex;gap:6px;align-items:stretch;flex-wrap:wrap">
      <input id="divPublicKeyInput" type="password" value="${publicKeySaved.replace(/"/g,'&quot;')}" placeholder="공공데이터포털 Encoding 인증키"
        style="flex:1;min-width:220px;background:var(--s1);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:.72rem" />
      <button data-div-action="save-public-key" class="btn-purple-sm">키 저장</button>
    </div>
  </div>

  <!-- ── 수량 0 숨김 토글 ── -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <button data-div-action="toggle-zero" class="btn-sort-toggle${_divHideZeroQty?' active':''}" style="font-size:.70rem">
      ${_divHideZeroQty ? '👁 전체 보기' : '🙈 수량 0 숨김'}
    </button>
  </div>

  <!-- ── 요약 카드 5개 — PC: 1줄, 모바일: 2×2+1 ── -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px" class="div-summary-grid">
    <div class="div-stat-card">
      <div class="div-stat-label">💸 연간 예상 (세전)</div>
      <div class="div-stat-value" style="color:var(--cyan)">${fmtW(Math.round(totalAnnual))}</div>
      <div class="div-stat-sub">확정 ${fmtW(Math.round(totalActual))} · ${divRows.length}개</div>
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
      <div class="div-stat-label">✅ 올해 수령 (${nowMonth-1}월까지)</div>
      <div class="div-stat-value c-green">${fmtW(Math.round(receivedSoFar))}</div>
      <div class="div-stat-sub">남은 예상 ${fmtW(Math.round(remainingYear))}</div>
    </div>
  </div>

  <!-- ── 월별 바 차트 ── -->
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
      <div>
        <div style="font-size:.85rem;font-weight:700">📅 ${nowYear}년 월별 배당</div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:2px">확정+예상 · 현재월 <span style="color:var(--cyan)">${nowMonth}월</span></div>
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
          const isPast    = (i + 1) < nowMonth;
          const isCurrent = (i + 1) === nowMonth;
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
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.65rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
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
      <td style="padding:9px 8px;text-align:right;font-size:.82rem;font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}</td>
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
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.65rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
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
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">연간(세전)</div>
          <div style="font-weight:700;color:var(--cyan);font-variant-numeric:tabular-nums">${fmtW(Math.round(r.annualDiv))}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">월(세전)</div>
          <div style="font-weight:600;color:var(--green);font-variant-numeric:tabular-nums">${fmtW(monthlyDiv)}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">주당 배당금</div>
          <div style="font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">수익률</div>
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
      <button data-div-action="apply" class="btn-amber-sm">💾 저장</button>
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
function _toggleDivHideZero() {
  _divHideZeroQty = !_divHideZeroQty;
  if (typeof lsSave === 'function') lsSave(DIV_HIDE_ZERO_KEY, _divHideZeroQty);
  const area = $el('view-area');
  if (area) renderDivView(area, true);
}

