// ════════════════════════════════════════════════════════════════
//  views_misc.js — 앱 초기화 진입점 (모든 JS 로드 완료 후 실행)
//  의존: data.js, views_system.js, settings.js
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

  // ════════════════════════════════════════════════════════════════
  //  전역 이벤트 위임 — CSP 인라인 핸들러 차단 대응
  //  innerHTML로 동적 생성된 버튼/input을 document 레벨에서 처리
  // ════════════════════════════════════════════════════════════════

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

    const id = btn.id;
    if (!id) return;

    // ── 기초정보 탭 버튼
    switch (id) {
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
    }
  });

});
