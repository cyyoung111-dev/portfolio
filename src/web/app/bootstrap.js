// ════════════════════════════════════════════════════════════════
//  app_bootstrap.js — 앱 초기화 진입점
//  의존: data.js, views_system.js, settings.js, src/web/app/event_delegation.js
//  ★ 반드시 모든 JS 파일 중 맨 마지막에 로드되어야 함
// ════════════════════════════════════════════════════════════════

window.PortfolioApp = window.PortfolioApp || {};
Object.assign(window.PortfolioApp, {
  views: Object.freeze({ renderPlan: renderPlanView, switch: switchView }),
  services: Object.freeze({ requestGsheetActionJson, requestGsheetFormJson }),
  calculations: Object.freeze({ plan: window.PlanCalculations }),
  storage: Object.freeze({ createBackup: getPortfolioBackupState, ensureAccounts: ensureAccountsMaster }),
});

const MARKET_BRIEFING_RUNTIME_SCRIPTS = Object.freeze([
  'domain/market/market_briefing_master.js?v=20260918-1',
  'domain/market/market_briefing_provider_normalizer.js?v=20260918-1',
  'domain/market/market_briefing_snapshot_store.js?v=20260918-1',
  'domain/market/market_briefing_operational_gate.js?v=20260918-1',
  'domain/market/market_briefing_runtime_store.js?v=20260918-1',
  'domain/market/market_briefing_runtime.js?v=20260918-1',
]);

function loadMarketBriefingRuntime() {
  if (window.MarketBriefingRuntime) return Promise.resolve(window.MarketBriefingRuntime);
  return MARKET_BRIEFING_RUNTIME_SCRIPTS.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`market briefing script load failed: ${src}`));
    document.head.appendChild(script);
  })), Promise.resolve()).then(() => {
    if (!window.MarketBriefingRuntime) throw new Error('MarketBriefingRuntime unavailable after load');
    window.PortfolioApp.marketBriefing = window.MarketBriefingRuntime;
    return window.MarketBriefingRuntime;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  const dateInput = $el('quickDateInput');
  if (dateInput) dateInput.value = getDateStr(0);
  syncAcctOrder();
  if (typeof ensureAccountsMaster === 'function') ensureAccountsMaster();
  buildTabBar();
  switchView('acct');

  loadMarketBriefingRuntime().catch((error) => console.warn('[market-briefing] runtime unavailable', error));

  if (typeof syncLoanFromSchedule === 'function') syncLoanFromSchedule();
  setInterval(() => {
    if (typeof syncLoanFromSchedule !== 'function') return;
    const changed = syncLoanFromSchedule();
    if (changed && typeof persistRealEstateSettings === 'function') persistRealEstateSettings(true);
    if (changed) { try { refreshAll(); } catch(e) {} }
  }, 60 * 60 * 1000);
  if (typeof registerGlobalEventDelegation === 'function') registerGlobalEventDelegation();
});
