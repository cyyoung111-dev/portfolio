// ════════════════════════════════════════════════════════════════
//  app_bootstrap.js — 앱 초기화 진입점
//  의존: data.js, views_system.js, settings.js, src/web/app/event_delegation.js
//  ★ 반드시 모든 JS 파일 중 맨 마지막에 로드되어야 함
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {

  // ── 기본 초기화
  const dateInput = $el('quickDateInput');
  if (dateInput) dateInput.value = getDateStr(0);

  syncAcctOrder();
  buildTabBar();
  switchView('acct');

  // 상환스케줄 기반 LOAN 자동 갱신
  if (typeof syncLoanFromSchedule === 'function') syncLoanFromSchedule();

  // 종가 자동 조회 (GSheet 연동 시)
  if (typeof autoLoadPrices === 'function') autoLoadPrices();

  // ── 전역 이벤트 위임 등록
  if (typeof registerGlobalEventDelegation === 'function') {
    registerGlobalEventDelegation();
  }
});
