// ════════════════════════════════════════════════════════════════
//  views_asset_loan.js — 부동산/대출 편집 및 상태
// ════════════════════════════════════════════════════════════════

// ── 상환스케줄 / 부동산 시가이력 전역 변수
// LOAN_SCHEDULE: [{date:'2024-01', balance:356550000, principal:450000, interest:1200000}]
// RE_VALUE_HIST:  [{date:'2024-01', value:480000000}]
// ★ 선언과 동시에 localStorage에서 복원 (IIFE 재할당 패턴 제거)
let LOAN_SCHEDULE = lsGet(LOAN_SCHEDULE_KEY, []);
let RE_VALUE_HIST = lsGet(RE_VALUE_KEY, []);

function saveRealEstate() {
  persistRealEstateSettings(true);
}

function saveSchedule() {
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
  const bal = parseInt($el('le-balance').value.replace(/,/g, ''));
  const rate = parseFloat($el('le-annualRate').value);
  const total = parseInt($el('le-totalMonths').value);
  const remain = parseInt($el('le-remainingMonths').value);
  const orig = parseInt($el('le-originalAmt').value.replace(/,/g, ''));
  const startDate = $el('le-startDate').value || '';
  const interestPaid = parseInt(($el('le-monthlyInterestPaid').value || '0').replace(/,/g, '')) || 0;
  const totalInterestPaid = parseInt(($el('le-totalInterestPaid').value || '0').replace(/,/g, '')) || 0;

  if (!bal || !rate || !total || !remain) {
    showToast('필수 항목을 입력해주세요', 'warn');
    return;
  }

  LOAN.originalAmt = orig || LOAN.originalAmt;
  LOAN.balance = bal;
  LOAN.annualRate = rate;
  LOAN.totalMonths = total;
  LOAN.remainingMonths = remain;
  LOAN.startDate = startDate;

  // 스케줄 있을 때는 스케줄 값 유지 (에디터 입력값으로 덮어쓰지 않음)
  if (LOAN_SCHEDULE.length === 0) LOAN.monthlyInterestPaid = interestPaid;
  LOAN.totalInterestPaid = totalInterestPaid;

  // startYear 도 startDate에서 자동 추출
  if (startDate) LOAN.startYear = parseInt(startDate.slice(0, 4));

  persistRealEstateSettings(true);
  renderSummary();
  renderView();
  closeLoanEditor();
}
