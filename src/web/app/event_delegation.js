// ════════════════════════════════════════════════════════════════
//  app_event_delegation.js — 전역 이벤트 위임 모듈
//  의존: mgmt_*, settings_sync.js
// ════════════════════════════════════════════════════════════════

function registerGlobalEventDelegation() {
  const clickHandlers = {
    // action bar / fixed tab
    quickFetchBtn:          () => typeof quickFetchByDate === 'function' && quickFetchByDate(),
    'btn-open-editor':      () => typeof openEditor === 'function' && openEditor(),
    'btn-export-data':      () => typeof exportData === 'function' && exportData(),
    'btn-trigger-import':   () => { const input = $el('importFileInput'); if (input) input.click(); },
    'btn-open-reset-dialog':() => typeof openResetDialog === 'function' && openResetDialog(),
    'fixed-btn-stocks':     () => typeof switchView === 'function' && switchView('stocks'),
    'fixed-btn-gsheet':     () => typeof switchView === 'function' && switchView('gsheet'),
    'btn-open-tab-settings':() => typeof openTabSettings === 'function' && openTabSettings(),

    // settings modal
    'btn-close-tab-settings-top':    () => typeof closeTabSettings === 'function' && closeTabSettings(),
    'btn-close-tab-settings-footer': () => typeof closeTabSettings === 'function' && closeTabSettings(),
    settingsTabBtn_tab:              () => typeof switchSettingsTab === 'function' && switchSettingsTab('tab'),
    settingsTabBtn_theme:            () => typeof switchSettingsTab === 'function' && switchSettingsTab('theme'),
    settingsResetBtn:                () => typeof resetTabOrder === 'function' && resetTabOrder(),

    // editors
    'btn-close-realestate-editor-top':    () => typeof closeRealEstateEditor === 'function' && closeRealEstateEditor(),
    'btn-close-realestate-editor-footer': () => typeof closeRealEstateEditor === 'function' && closeRealEstateEditor(),
    'btn-apply-realestate':               () => typeof applyRealEstate === 'function' && applyRealEstate(),
    'btn-close-price-editor-top':         () => typeof closeEditor === 'function' && closeEditor(),
    'btn-close-price-editor-footer':      () => typeof closeEditor === 'function' && closeEditor(),
    'pe-panel-price-footer':              () => typeof applyPrices === 'function' && applyPrices(),
    'btn-close-loan-editor-top':          () => typeof closeLoanEditor === 'function' && closeLoanEditor(),
    'btn-close-loan-editor-footer':       () => typeof closeLoanEditor === 'function' && closeLoanEditor(),
    'btn-apply-loan':                     () => typeof applyLoan === 'function' && applyLoan(),

    // history / gsheet
    histModeWeek:          () => typeof _setHistMode === 'function' && _setHistMode('week'),
    histModeMonth:         () => typeof _setHistMode === 'function' && _setHistMode('month'),
    'btn-history-refresh': () => typeof loadHistoryChart === 'function' && loadHistoryChart(),
    'btn-clear-gsheet-url':() => typeof clearGsheetUrl === 'function' && clearGsheetUrl(),
    'btn-save-gsheet-url': () => typeof saveGsheetUrlFromUI === 'function' && saveGsheetUrlFromUI(),

    // management
    'btn-acct-add':        () => typeof acctMgmtAddNew === 'function' && acctMgmtAddNew(),
    'btn-acct-confirm':    () => typeof acctMgmtConfirm === 'function' && acctMgmtConfirm(),
    'btn-acct-cancel':     () => typeof acctMgmtCancel === 'function' && acctMgmtCancel(),
    'btn-sm-add':          () => typeof smMgmtAddNew === 'function' && smMgmtAddNew(),
    'btn-sm-confirm':      () => typeof smMgmtConfirm === 'function' && smMgmtConfirm(),
    'btn-sm-cancel':       () => typeof smMgmtCancel === 'function' && smMgmtCancel(),
    'btn-sm-template':     () => typeof smCsvDownloadTemplate === 'function' && smCsvDownloadTemplate(),
    'btn-sec-add':         () => typeof secMgmtAddNew === 'function' && secMgmtAddNew(),
    'btn-sec-confirm':     () => typeof secMgmtConfirm === 'function' && secMgmtConfirm(),
    'btn-sec-cancel':      () => typeof secMgmtCancel === 'function' && secMgmtCancel(),
    'btn-sec-template':    () => typeof secCsvDownloadTemplate === 'function' && secCsvDownloadTemplate(),
  };

  const enterEscapeHandlers = {
    acctMgmtNewInput: (isEnter) => isEnter
      ? (typeof acctMgmtConfirm === 'function' && acctMgmtConfirm())
      : (typeof acctMgmtCancel  === 'function' && acctMgmtCancel()),
    smMgmtNewName: (isEnter) => isEnter
      ? (typeof smMgmtConfirm === 'function' && smMgmtConfirm())
      : (typeof smMgmtCancel  === 'function' && smMgmtCancel()),
    secMgmtNewName: (isEnter) => isEnter
      ? (typeof secMgmtConfirm === 'function' && secMgmtConfirm())
      : (typeof secMgmtCancel  === 'function' && secMgmtCancel()),
    gsheetUrlInput: (isEnter) => isEnter && typeof saveGsheetUrlFromUI === 'function' && saveGsheetUrlFromUI(),
  };

  // ── 클릭 위임
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    // 재동기화 버튼 (data-sync-tab 속성)
    const syncTab = btn.dataset.syncTab;
    if (syncTab) {
      e.preventDefault();
      if (typeof manualSyncByTab === 'function') manualSyncByTab(syncTab);
      return;
    }
    const action = btn.dataset.action;
    if (action === 'toggle-hist-debug') {
      const dt = btn.dataset.date || '';
      if (typeof _toggleHistDebug === 'function') _toggleHistDebug(dt);
      return;
    }

    const id = btn.id;
    if (!id) return;
    const run = clickHandlers[id];
    if (typeof run === 'function') run();
  });

  // ── 파일 input change 위임
  document.addEventListener('change', function(e) {
    const inp = e.target;
    if (!inp) return;
    if (inp.id === 'importFileInput' && typeof importData === 'function') importData(inp);
    if (inp.id === 'smCsvFileInput'  && typeof smCsvImport  === 'function') smCsvImport(inp);
    if (inp.id === 'secCsvFileInput' && typeof secCsvImport === 'function') secCsvImport(inp);
  });

  // ── keydown 위임 (Enter / Escape)
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const id = e.target && e.target.id;
    if (!id) return;
    const isEnter = e.key === 'Enter';
    const run = enterEscapeHandlers[id];
    if (typeof run === 'function') run(isEnter);
  });
}
