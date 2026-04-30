// ════════════════════════════════════════════════════════════════
//  views_system_tabsettings.js — 탭 순서 설정 패널
//  의존: views_system.js (TAB_ORDER/TAB_DEFAULTS/saveTabOrder/buildTabBar/buildMobileNav/currentView/switchView)
// ════════════════════════════════════════════════════════════════

function openTabSettings() {
  renderTabSettingsBody();
  const ov = $el('tabSettingsOverlay');
  if (ov) ov.style.display = 'flex';
  // ★ 탭순서 패널을 기본으로 활성화 (theme.js의 switchSettingsTab 사용)
  if (typeof switchSettingsTab === 'function') switchSettingsTab('tab');
}
function closeTabSettings() {
  const ov = $el('tabSettingsOverlay');
  if (ov) ov.style.display = 'none';
}
function resetTabOrder() {
  TAB_ORDER.length = 0;
  TAB_DEFAULTS.forEach(t => TAB_ORDER.push({ ...t, hidden: false }));
  saveTabOrder();
  buildTabBar();
  buildMobileNav();
  renderTabSettingsBody();
}
function toggleTabHidden(idx) {
  if (TAB_ORDER[idx]) {
    TAB_ORDER[idx].hidden = !TAB_ORDER[idx].hidden;
    // 숨긴 탭이 현재 뷰이면 첫 번째 보이는 탭으로 이동
    if (TAB_ORDER[idx].hidden && currentView === TAB_ORDER[idx].id) {
      const first = TAB_ORDER.find(t => !t.hidden);
      if (first) switchView(first.id);
    }
    saveTabOrder();
    buildTabBar();
    buildMobileNav();
    renderTabSettingsBody();
  }
}
function moveTab(idx, dir) {
  const ni = idx + dir;
  if (ni < 0 || ni >= TAB_ORDER.length) return;
  [TAB_ORDER[idx], TAB_ORDER[ni]] = [TAB_ORDER[ni], TAB_ORDER[idx]];
  saveTabOrder();
  buildTabBar();
  renderTabSettingsBody();
}
function renderTabSettingsBody() {
  const body = $el('tabSettingsBody');
  if (!body) return;
  let html = '';
  TAB_ORDER.forEach((tab, i) => {
    const isFirst = i === 0, isLast = i === TAB_ORDER.length - 1;
    html += `<div class="tab-setting-row" draggable="true" data-idx="${i}"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;background:var(--s2);cursor:grab;transition:background .12s;opacity:${tab.hidden?'.45':'1'}">
      <span style="font-size:.75rem;color:var(--muted);cursor:grab;user-select:none">⠿</span>
      <span style="display:flex;align-items:center;gap:8px;flex:1;font-size:.80rem"><span style="width:16px;height:16px;display:inline-flex;align-items:center">${tab.icon||''}</span>${tab.label}${tab.hidden?'<span style="font-size:.60rem;color:var(--muted);margin-left:4px">(숨김)</span>':''}</span>
      <button onclick="moveTab(${i},-1)" ${isFirst?'disabled':''} class="btn-move-icon">↑</button>
      <button onclick="moveTab(${i},1)" ${isLast?'disabled':''} class="btn-move-icon">↓</button>
      <button onclick="toggleTabHidden(${i})" class="btn-move-icon" title="${tab.hidden?'표시':'숨김'}"
        style="color:${tab.hidden?'var(--muted)':'var(--text)'};border-color:${tab.hidden?'var(--border)':'var(--c-amber-40)'}">
        ${tab.hidden?'🙈':'👁'}
      </button>
    </div>`;
  });
  body.innerHTML = html;

  let dragSrcIdx = null;
  body.querySelectorAll('.tab-setting-row').forEach(row => {
    row.addEventListener('dragstart', e => { dragSrcIdx = parseInt(row.dataset.idx); row.style.opacity = '.4'; });
    row.addEventListener('dragend', () => { row.style.opacity = ''; });
    row.addEventListener('dragover', e => { e.preventDefault(); row.style.background = 'var(--s1)'; });
    row.addEventListener('dragleave', () => { row.style.background = 'var(--s2)'; });
    row.addEventListener('drop', e => {
      e.preventDefault(); row.style.background = 'var(--s2)';
      const toIdx = parseInt(row.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === toIdx) return;
      const [moved] = TAB_ORDER.splice(dragSrcIdx, 1);
      TAB_ORDER.splice(toIdx, 0, moved);
      saveTabOrder(); buildTabBar(); renderTabSettingsBody();
    });
  });
}

