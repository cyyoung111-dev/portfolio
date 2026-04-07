// ════════════════════════════════════════════════════════════════
//  app_event_delegation.js — 전역 이벤트 위임 모듈
//  의존: mgmt_*, settings_sync.js
// ════════════════════════════════════════════════════════════════

function registerGlobalEventDelegation() {
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

    // ── 기초정보 탭 버튼
    switch (id) {
      case 'quickFetchBtn':    typeof quickFetchByDate      === 'function' && quickFetchByDate();      break;
      case 'btn-open-editor':  typeof openEditor            === 'function' && openEditor();            break;
      case 'btn-export-data':  typeof exportData            === 'function' && exportData();            break;
      case 'btn-trigger-import': {
        const input = $el('importFileInput');
        if (input) input.click();
        break;
      }
      case 'btn-open-reset-dialog': typeof openResetDialog  === 'function' && openResetDialog();      break;
      case 'fixed-btn-stocks': typeof switchView            === 'function' && switchView('stocks');    break;
      case 'fixed-btn-gsheet': typeof switchView            === 'function' && switchView('gsheet');    break;
      case 'btn-open-tab-settings': typeof openTabSettings  === 'function' && openTabSettings();       break;
      case 'btn-close-tab-settings-top':
      case 'btn-close-tab-settings-footer':
        typeof closeTabSettings === 'function' && closeTabSettings();
        break;
      case 'settingsTabBtn_tab':   typeof switchSettingsTab === 'function' && switchSettingsTab('tab');   break;
      case 'settingsTabBtn_theme': typeof switchSettingsTab === 'function' && switchSettingsTab('theme'); break;
      case 'settingsResetBtn':     typeof resetTabOrder     === 'function' && resetTabOrder();             break;
      case 'btn-close-realestate-editor-top':
      case 'btn-close-realestate-editor-footer':
        typeof closeRealEstateEditor === 'function' && closeRealEstateEditor();
        break;
      case 'btn-apply-realestate': typeof applyRealEstate === 'function' && applyRealEstate(); break;
      case 'btn-close-price-editor-top':
      case 'btn-close-price-editor-footer':
        typeof closeEditor === 'function' && closeEditor();
        break;
      case 'pe-panel-price-footer': typeof applyPrices === 'function' && applyPrices(); break;
      case 'btn-close-loan-editor-top':
      case 'btn-close-loan-editor-footer':
        typeof closeLoanEditor === 'function' && closeLoanEditor();
        break;
      case 'btn-apply-loan': typeof applyLoan === 'function' && applyLoan(); break;
      case 'histModeWeek': typeof _setHistMode === 'function' && _setHistMode('week'); break;
      case 'histModeMonth': typeof _setHistMode === 'function' && _setHistMode('month'); break;
      case 'btn-history-refresh': typeof loadHistoryChart === 'function' && loadHistoryChart(); break;
      case 'btn-clear-gsheet-url': typeof clearGsheetUrl === 'function' && clearGsheetUrl(); break;
      case 'btn-save-gsheet-url': typeof saveGsheetUrlFromUI === 'function' && saveGsheetUrlFromUI(); break;
      case 'btn-acct-add':     typeof acctMgmtAddNew          === 'function' && acctMgmtAddNew();          break;
      case 'btn-acct-confirm': typeof acctMgmtConfirm         === 'function' && acctMgmtConfirm();         break;
      case 'btn-acct-cancel':  typeof acctMgmtCancel          === 'function' && acctMgmtCancel();          break;
      case 'btn-sm-add':       typeof smMgmtAddNew            === 'function' && smMgmtAddNew();            break;
      case 'btn-sm-confirm':   typeof smMgmtConfirm           === 'function' && smMgmtConfirm();           break;
      case 'btn-sm-cancel':    typeof smMgmtCancel            === 'function' && smMgmtCancel();            break;
      case 'btn-sm-template':  typeof smCsvDownloadTemplate   === 'function' && smCsvDownloadTemplate();   break;
      case 'btn-sec-add':      typeof secMgmtAddNew           === 'function' && secMgmtAddNew();           break;
      case 'btn-sec-confirm':  typeof secMgmtConfirm          === 'function' && secMgmtConfirm();          break;
      case 'btn-sec-cancel':   typeof secMgmtCancel           === 'function' && secMgmtCancel();           break;
      case 'btn-sec-template': typeof secCsvDownloadTemplate  === 'function' && secCsvDownloadTemplate();  break;
    }
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
    switch (id) {
      case 'acctMgmtNewInput':
        isEnter ? (typeof acctMgmtConfirm === 'function' && acctMgmtConfirm())
                : (typeof acctMgmtCancel  === 'function' && acctMgmtCancel());
        break;
      case 'smMgmtNewName':
        isEnter ? (typeof smMgmtConfirm === 'function' && smMgmtConfirm())
                : (typeof smMgmtCancel  === 'function' && smMgmtCancel());
        break;
      case 'secMgmtNewName':
        isEnter ? (typeof secMgmtConfirm === 'function' && secMgmtConfirm())
                : (typeof secMgmtCancel  === 'function' && secMgmtCancel());
        break;
      case 'gsheetUrlInput':
        if (isEnter && typeof saveGsheetUrlFromUI === 'function') saveGsheetUrlFromUI();
        break;
    }
  });
}
