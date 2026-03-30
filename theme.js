// ════════════════════════════════════════════════════════════════
//  theme.js — 테마 관리 (라이트 / 다크)
//  의존: core_storage.js (lsSave / lsGet)
// ════════════════════════════════════════════════════════════════

const THEMES = {
  dark: {
    label: '🌙 다크',
    desc: '어두운 배경',
    vars: {
      '--bg':        '#080d18',
      '--s1':        '#0e1726',
      '--s2':        '#141f33',
      '--border':    '#1c2a42',
      '--green':     '#10b981',
      '--red':       '#E52E2E',
      '--blue':      '#0057FF',
      '--amber':     '#f59e0b',
      '--purple':    '#8b5cf6',
      '--cyan':      '#06b6d4',
      '--text':      '#e2e8f0',
      '--muted':     '#64748b',
      '--gold':      '#f59e0b',
      '--gold2':     '#f97316',
      '--green-lt':  '#4ade80',
      '--green-md':  '#34d399',
      '--blue-lt':   '#5B8EFF',
      '--purple-lt': '#a78bfa',
      '--purple-dk': '#7c3aed',
      '--red-lt':    '#FF6B6B',
    }
  },
  light: {
    label: '☀️ 라이트',
    desc: '밝은 배경',
    vars: {
      '--bg':        '#f5f7fb',
      '--s1':        '#ffffff',
      '--s2':        '#eef2f8',
      '--border':    '#d1d9e8',
      '--green':     '#047857',
      '--red':       '#dc2626',
      '--blue':      '#2563eb',
      '--amber':     '#d97706',
      '--purple':    '#7c3aed',
      '--cyan':      '#0891b2',
      '--text':      '#0f172a',
      '--muted':     '#64748b',
      '--gold':      '#b45309',
      '--gold2':     '#c2410c',
      '--green-lt':  '#047857',
      '--green-md':  '#059669',
      '--blue-lt':   '#2563eb',
      '--purple-lt': '#8b5cf6',
      '--purple-dk': '#6d28d9',
      '--red-lt':    '#dc2626',
    }
  }
};

const THEME_STORAGE_KEY = 'app_theme';
const LEGACY_DARK_THEMES = ['ocean', 'black', 'amber', 'purple', 'forest', 'midnight', 'rose'];
let _currentTheme = 'dark';

function _normalizeThemeKey(themeKey) {
  if (THEMES[themeKey]) return themeKey;
  if (LEGACY_DARK_THEMES.includes(themeKey)) return 'dark';
  return 'dark';
}

// ── 테마 적용
function applyTheme(themeKey) {
  const normalized = _normalizeThemeKey(themeKey);
  const theme = THEMES[normalized];
  if (!theme) return;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
  _currentTheme = normalized;
  if (typeof lsSave === 'function') lsSave(THEME_STORAGE_KEY, normalized);
  _renderThemeButtons();
}

// ── 저장된 테마 복원 (앱 시작 시 호출)
function loadTheme() {
  const saved = (typeof lsGet === 'function') ? lsGet(THEME_STORAGE_KEY, 'dark') : 'dark';
  applyTheme(saved || 'dark');
}

// ── 외부 렌더 훅 (현재 미사용이지만 호환 위해 유지)
function renderThemeSelector(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = _buildThemeSelectorHTML();
}

function _buildThemeSelectorHTML() {
  const btns = Object.entries(THEMES).map(([key, theme]) => {
    const isActive = key === _currentTheme;
    const bg = theme.vars['--bg'];
    const s1 = theme.vars['--s1'];
    const s2 = theme.vars['--s2'];
    const accent = theme.vars['--amber'];
    const border = theme.vars['--border'];
    return `<button
      onclick="applyTheme('${key}')"
      id="theme-btn-${key}"
      style="
        display:flex;align-items:center;gap:10px;
        width:100%;padding:10px 14px;border-radius:8px;cursor:pointer;
        border:1px solid ${isActive ? accent : border};
        background:${isActive ? 'rgba(255,255,255,.06)' : 'transparent'};
        transition:all .15s;text-align:left;
      ">
      <div style="display:flex;gap:2px;flex-shrink:0;border-radius:5px;overflow:hidden;border:1px solid rgba(0,0,0,.12)">
        <div style="width:12px;height:28px;background:${bg}"></div>
        <div style="width:12px;height:28px;background:${s1}"></div>
        <div style="width:12px;height:28px;background:${s2}"></div>
        <div style="width:16px;height:28px;background:${accent}"></div>
      </div>
      <div style="flex:1">
        <div style="font-size:.82rem;font-weight:600;color:${isActive ? accent : 'var(--text)'}">
          ${theme.label}${isActive ? ' <span style="font-size:.65rem;opacity:.7">(현재)</span>' : ''}
        </div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:2px">${theme.desc}</div>
      </div>
      ${isActive ? `<span style="color:${accent};font-size:.80rem">✓</span>` : ''}
    </button>`;
  }).join('');

  return `
    <div style="margin-bottom:8px">
      <div style="font-size:.70rem;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">
        🎨 테마 선택
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${btns}
      </div>
    </div>`;
}

function _renderThemeButtons() {
  Object.keys(THEMES).forEach(key => {
    const btn = document.getElementById('theme-btn-' + key);
    if (!btn) return;
    const isActive = key === _currentTheme;
    const accent = THEMES[key].vars['--amber'];
    const border = THEMES[key].vars['--border'];
    btn.style.borderColor = isActive ? accent : border;
    btn.style.background = isActive ? 'rgba(255,255,255,.06)' : 'transparent';
  });
}

// ── 앱 시작 시 즉시 실행 (깜빡임 방지)
loadTheme();

// ── 설정 오버레이 탭 전환
function switchSettingsTab(tab) {
  const panels = ['tab', 'theme'];
  panels.forEach(p => {
    const panel = document.getElementById('settingsPanel_' + p);
    const btn = document.getElementById('settingsTabBtn_' + p);
    if (!panel || !btn) return;
    const isActive = p === tab;
    panel.style.display = isActive ? 'block' : 'none';
    btn.style.borderBottom = isActive ? '2px solid var(--amber)' : '2px solid transparent';
    btn.style.background = isActive ? 'var(--c-amber-08)' : 'transparent';
    btn.style.color = isActive ? 'var(--gold)' : 'var(--muted)';
  });
  const resetBtn = document.getElementById('settingsResetBtn');
  if (resetBtn) resetBtn.style.display = tab === 'tab' ? '' : 'none';

  if (tab === 'theme') {
    const container = document.getElementById('themeSettingsBody');
    if (container) {
      container.innerHTML = _buildThemeSelectorHTML();
      _renderThemeButtons();
    }
  }
}

// ── openTabSettings 호출 시 탭순서 패널을 기본으로 초기화
// views_system.js의 openTabSettings가 로드된 후 래핑
document.addEventListener('DOMContentLoaded', function() {
  const _origOpen = window.openTabSettings;
  window.openTabSettings = function() {
    if (typeof _origOpen === 'function') _origOpen();
    switchSettingsTab('tab');
  };
});
