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

    // ── data-portfolio-action (views_portfolio.js)
    const portfolioAction = e.target.closest('[data-portfolio-action]');
    if (portfolioAction) {
      const action = portfolioAction.dataset.portfolioAction;
      if (action === 'acct-filter' && typeof setAcctFilter === 'function') setAcctFilter(portfolioAction.dataset.value || '전체');
      else if (action === 'type-filter' && typeof setTypeFilter === 'function') setTypeFilter(portfolioAction.dataset.value || '전체');
      else if (action === 'merge-sort' && typeof setMergeSortKey === 'function') setMergeSortKey(portfolioAction.dataset.key || 'eval');
      else if (action === 'merge-detail') {
        if (e.target.closest('[data-portfolio-action="trade-group"]')) return;
        if (typeof toggleMergeDetail === 'function') toggleMergeDetail(portfolioAction.dataset.detailId || '');
      } else if (action === 'trade-group' && typeof goToTradeGroup === 'function') {
        e.stopPropagation();
        goToTradeGroup(portfolioAction.dataset.gname || '');
      }
      return;
    }

    // ── data-theme-action (theme.js)
    const themeAction = e.target.closest('[data-theme-action]');
    if (themeAction) {
      const action = themeAction.dataset.themeAction;
      if (action === 'mode') { if (typeof setThemeMode === 'function') { setThemeMode(themeAction.dataset.mode || 'system'); if (typeof _queueThemeSettingsSync === 'function') _queueThemeSettingsSync(); } }
      else if (action === 'apply') { if (typeof applyTheme === 'function') { applyTheme(themeAction.dataset.themeKey || ''); if (typeof _queueThemeSettingsSync === 'function') _queueThemeSettingsSync(); } }
      return;
    }

    // ── data-asset-action (views_asset.js)
    const assetAction = e.target.closest('[data-asset-action]');
    if (assetAction) {
      const action = assetAction.dataset.assetAction;
      if (action === 'loan-editor' && typeof openLoanEditor === 'function') openLoanEditor();
      else if (action === 'realestate-editor' && typeof openRealEstateEditor === 'function') openRealEstateEditor();
      return;
    }

    // ── data-div-action (views_div_asset.js)
    const divAction = e.target.closest('[data-div-action]');
    if (divAction) {
      const action = divAction.dataset.divAction;
      if (action === 'apply' && typeof applyDivChanges === 'function') applyDivChanges();
      else if (action === 'fetch' && typeof startDivFetch === 'function') startDivFetch();
      else if (action === 'toggle-zero' && typeof _toggleDivHideZero === 'function') _toggleDivHideZero();
      return;
    }

    // ── data-tab-action (views_system_tabsettings.js)
    const tabAction = e.target.closest('[data-tab-action]');
    if (tabAction) {
      const action = tabAction.dataset.tabAction;
      const idx = parseInt(tabAction.dataset.idx || '', 10);
      if (action === 'toggle-hidden' && typeof toggleTabHidden === 'function') toggleTabHidden(idx);
      else if (action === 'move' && typeof moveTab === 'function') moveTab(idx, tabAction.dataset.dir || 'up');
      return;
    }

    // ── data-schedule-action (views_asset_schedule_data.js)
    const scheduleAction = e.target.closest('[data-schedule-action]');
    if (scheduleAction) {
      const action = scheduleAction.dataset.scheduleAction;
      if (action === 'remove-re-value') { if (typeof removeReValue === 'function') removeReValue(parseInt(scheduleAction.dataset.index || '', 10)); }
      else if (action === 'download-template') { if (typeof downloadScheduleTemplate === 'function') downloadScheduleTemplate(); }
      else if (action === 'clear') { if (typeof clearSchedule === 'function') clearSchedule(); }
      else if (action === 'add-re-value') { if (typeof addReValue === 'function') addReValue(); }
      return;
    }

    // ── data-sm-new-type / data-sm-new-sector / data-sm-new-currency (mgmt_stock.js, 종목 추가 폼)
    const smNewType = e.target.closest('[data-sm-new-type]');
    if (smNewType) { if (typeof _smRenderTypeButtons === 'function') _smRenderTypeButtons(smNewType.dataset.smNewType || '주식'); return; }
    const smNewSector = e.target.closest('[data-sm-new-sector]');
    if (smNewSector) { if (typeof _smRenderSecButtons === 'function') _smRenderSecButtons(smNewSector.dataset.smNewSector || '기타'); return; }
    // ★ [환율 연동] 종목 추가 폼 통화 버튼
    const smNewCurrency = e.target.closest('[data-sm-new-currency]');
    if (smNewCurrency) { if (typeof _smRenderCurButtons === 'function') _smRenderCurButtons(smNewCurrency.dataset.smNewCurrency || 'KRW'); return; }

    // ★ [계좌별 taxType] 신규 계좌 구분 버튼
    const acctNewTax = e.target.closest('[data-acct-new-tax]');
    if (acctNewTax) {
      const tx = acctNewTax.dataset.acctNewTax || '일반';
      const hidden = document.getElementById('acctMgmtNewTaxType');
      if (hidden) hidden.value = tx;
      document.querySelectorAll('#acctNewTaxGroup button').forEach(b => b.classList.toggle('active', b.dataset.acctNewTax === tx));
      return;
    }
    // ★ [계좌별 taxType] 계좌 수정 시 구분 버튼 (mgmt_acct.js의 acctEditTaxGroup)
    const acctTax = e.target.closest('[data-acct-tax]');
    if (acctTax) {
      const tx = acctTax.dataset.acctTax || '일반';
      const hidden = document.getElementById('acctEditTaxType');
      if (hidden) hidden.value = tx;
      document.querySelectorAll('#acctEditTaxGroup button').forEach(b => b.classList.toggle('active', b.dataset.acctTax === tx));
      return;
    }

    // ── data-editor-page-section (mgmt_editor.js, 현재가 편집 페이지네이션)
    const pageSectionBtn = e.target.closest('[data-editor-page-section]');
    if (pageSectionBtn) {
      if (typeof _setEditorSectionPage === 'function') {
        _setEditorSectionPage(
          pageSectionBtn.dataset.editorPageSection,
          parseInt(pageSectionBtn.dataset.page || '1', 10),
          parseInt(pageSectionBtn.dataset.totalPages || '1', 10)
        );
      }
      return;
    }

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

  // ── 부동산 미리보기 input 위임
  document.addEventListener('input', function(e) {
    // ★ [통일] 금액 입력창 자동 콤마 서식 — 여러 파일에 흩어져 있던 동일 로직을 이 한 곳으로 통합
    //   (기존: views_asset_schedule_data.js와 views_plan.js에 각각 따로 구현되어 있었음)
    if (e.target && e.target.dataset && e.target.dataset.format === 'number-comma') {
      const pos = e.target.selectionStart;
      const lenBefore = e.target.value.length;
      const raw = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = raw ? Number(raw).toLocaleString() : '';
      const lenAfter = e.target.value.length;
      try {
        const newPos = Math.max(0, (pos || 0) + (lenAfter - lenBefore));
        e.target.setSelectionRange(newPos, newPos);
      } catch(err) {}
      return;
    }
    const id = e.target && e.target.id;
    if (!['re-value', 're-purchase', 're-tax', 're-interior', 're-etc'].includes(id)) return;
    if (typeof updateRePreview === 'function') updateRePreview();
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
