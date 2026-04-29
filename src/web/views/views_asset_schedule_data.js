// views_asset_schedule_data.js — 스케줄 데이터/입출력/UI

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
      <div style="display:flex;gap:8px;flex-wrap:wrap">
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
    <div style="display:flex;gap:8px;margin-bottom:14px;align-items:flex-end;flex-wrap:wrap">
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
  dateEl.value = '';
  priceEl.value = '';
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

