// ════════════════════════════════════════════════════════════════
//  views_misc.js — 앱 초기화 진입점 (모든 JS 로드 완료 후 실행)
//  의존: data.js, views_system.js, settings.js
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
  const dateInput = $el('quickDateInput');
  if (dateInput) dateInput.value = getDateStr(0);

  syncAcctOrder();
  buildTabBar();
  switchView('acct');

  if (typeof initGsheet === 'function') initGsheet();
});
