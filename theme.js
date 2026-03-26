// ════════════════════════════════════════════════════════════════
//  theme.js — 테마 관리 (5가지 다크 테마)
//  의존: core_storage.js (lsSave / lsGet)
// ════════════════════════════════════════════════════════════════

const THEMES = {
  ocean: {
    label: '🌊 오션',
    desc: '기본 네이비',
    vars: {
      '--bg':       '#080d18',
      '--s1':       '#0e1726',
      '--s2':       '#141f33',
      '--border':   '#1c2a42',
      '--green':    '#10b981',
      '--red':      '#E52E2E',
      '--blue':     '#0057FF',
      '--amber':    '#f59e0b',
      '--purple':   '#8b5cf6',
      '--cyan':     '#06b6d4',
      '--text':     '#e2e8f0',
      '--muted':    '#64748b',
      '--gold':     '#f59e0b',
      '--gold2':    '#f97316',
      '--green-lt': '#4ade80',
      '--green-md': '#34d399',
      '--blue-lt':  '#5B8EFF',
      '--purple-lt':'#a78bfa',
      '--purple-dk':'#7c3aed',
      '--red-lt':   '#FF6B6B',
    }
  },
  black: {
    label: '🌑 블랙',
    desc: '순수 블랙',
    vars: {
      '--bg':       '#000000',
      '--s1':       '#0a0a0a',
      '--s2':       '#111111',
      '--border':   '#222222',
      '--green':    '#10b981',
      '--red':      '#E52E2E',
      '--blue':     '#0057FF',
      '--amber':    '#f59e0b',
      '--purple':   '#8b5cf6',
      '--cyan':     '#06b6d4',
      '--text':     '#e2e8f0',
      '--muted':    '#525252',
      '--gold':     '#f59e0b',
      '--gold2':    '#f97316',
      '--green-lt': '#4ade80',
      '--green-md': '#34d399',
      '--blue-lt':  '#5B8EFF',
      '--purple-lt':'#a78bfa',
      '--purple-dk':'#7c3aed',
      '--red-lt':   '#FF6B6B',
    }
  },
  amber: {
    label: '🔥 앰버',
    desc: '브라운 + 골드',
    vars: {
      '--bg':       '#0f0a00',
      '--s1':       '#1a1100',
      '--s2':       '#221800',
      '--border':   '#3a2c00',
      '--green':    '#10b981',
      '--red':      '#E52E2E',
      '--blue':     '#f97316',
      '--amber':    '#fbbf24',
      '--purple':   '#f59e0b',
      '--cyan':     '#fb923c',
      '--text':     '#fef3c7',
      '--muted':    '#92400e',
      '--gold':     '#fbbf24',
      '--gold2':    '#f59e0b',
      '--green-lt': '#4ade80',
      '--green-md': '#34d399',
      '--blue-lt':  '#fdba74',
      '--purple-lt':'#fcd34d',
      '--purple-dk':'#d97706',
      '--red-lt':   '#FF6B6B',
    }
  },
  purple: {
    label: '💜 퍼플',
    desc: '딥 퍼플 + 핑크',
    vars: {
      '--bg':       '#0a0514',
      '--s1':       '#100820',
      '--s2':       '#160b2c',
      '--border':   '#2d1b4e',
      '--green':    '#a78bfa',
      '--red':      '#f43f5e',
      '--blue':     '#8b5cf6',
      '--amber':    '#c084fc',
      '--purple':   '#e879f9',
      '--cyan':     '#a78bfa',
      '--text':     '#ede9fe',
      '--muted':    '#6b21a8',
      '--gold':     '#c084fc',
      '--gold2':    '#a855f7',
      '--green-lt': '#d8b4fe',
      '--green-md': '#c084fc',
      '--blue-lt':  '#a78bfa',
      '--purple-lt':'#f0abfc',
      '--purple-dk':'#7c3aed',
      '--red-lt':   '#fb7185',
    }
  },
  forest: {
    label: '🌿 포레스트',
    desc: '딥 그린 + 에메랄드',
    vars: {
      '--bg':       '#020f07',
      '--s1':       '#041a0c',
      '--s2':       '#072314',
      '--border':   '#0f3d22',
      '--green':    '#10b981',
      '--red':      '#E52E2E',
      '--blue':     '#059669',
      '--amber':    '#34d399',
      '--purple':   '#6ee7b7',
      '--cyan':     '#10b981',
      '--text':     '#d1fae5',
      '--muted':    '#065f46',
      '--gold':     '#34d399',
      '--gold2':    '#10b981',
      '--green-lt': '#6ee7b7',
      '--green-md': '#34d399',
      '--blue-lt':  '#4ade80',
      '--purple-lt':'#a7f3d0',
      '--purple-dk':'#047857',
      '--red-lt':   '#FF6B6B',
    }
  },
};

const THEME_STORAGE_KEY = 'app_theme';
let _currentTheme = 'ocean';

// ── 테마 적용
function applyTheme(themeKey) {
  const theme = THEMES[themeKey];
  if (!theme) return;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
  _currentTheme = themeKey;
  if (typeof lsSave === 'function') lsSave(THEME_STORAGE_KEY, themeKey);
  // 테마 버튼 active 상태 갱신
  _renderThemeButtons();
}

// ── 저장된 테마 복원 (앱 시작 시 호출)
function loadTheme() {
  const saved = (typeof lsGet === 'function') ? lsGet(THEME_STORAGE_KEY, 'ocean') : 'ocean';
  applyTheme(saved || 'ocean');
}

// ── 테마 선택 버튼 렌더링 (설정 탭 내 삽입용)
function renderThemeSelector(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = _buildThemeSelectorHTML();
}

function _buildThemeSelectorHTML() {
  const btns = Object.entries(THEMES).map(([key, theme]) => {
    const isActive = key === _currentTheme;
    // 미리보기 색상 점
    const bg     = theme.vars['--bg'];
    const accent = theme.vars['--amber'];
    const text   = theme.vars['--text'];
    return `<button
      onclick="applyTheme('${key}')"
      id="theme-btn-${key}"
      style="
        display:flex;align-items:center;gap:10px;
        width:100%;padding:10px 14px;border-radius:8px;cursor:pointer;
        border:1px solid ${isActive ? accent : 'var(--border)'};
        background:${isActive ? 'rgba(255,255,255,.05)' : 'transparent'};
        transition:all .15s;text-align:left;
      ">
      <!-- 미리보기 스와치 -->
      <div style="display:flex;gap:3px;flex-shrink:0">
        <div style="width:14px;height:28px;border-radius:4px 0 0 4px;background:${bg};border:1px solid rgba(255,255,255,.1)"></div>
        <div style="width:14px;height:28px;background:${theme.vars['--s1']};border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1)"></div>
        <div style="width:14px;height:28px;border-radius:0 4px 4px 0;background:${accent};border:1px solid rgba(255,255,255,.1)"></div>
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
  // 이미 렌더링된 버튼들의 active 상태만 갱신
  Object.keys(THEMES).forEach(key => {
    const btn = document.getElementById('theme-btn-' + key);
    if (!btn) return;
    const isActive = key === _currentTheme;
    const accent = THEMES[key].vars['--amber'];
    btn.style.borderColor = isActive ? accent : 'var(--border)';
    btn.style.background  = isActive ? 'rgba(255,255,255,.05)' : 'transparent';
  });
}

// ── 앱 시작 시 즉시 실행 (깜빡임 방지)
loadTheme();
