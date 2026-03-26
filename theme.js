// ════════════════════════════════════════════════════════════════
//  theme.js — 테마 관리 (7가지 다크 테마)
//  의존: core_storage.js (lsSave / lsGet)
// ════════════════════════════════════════════════════════════════

const THEMES = {
  // ── 1. 오션 (기존 유지)
  ocean: {
    label: '🌊 오션',
    desc: '기본 네이비',
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

  // ── 2. 블랙
  black: {
    label: '🌑 블랙',
    desc: '순수 블랙',
    vars: {
      '--bg':        '#000000',
      '--s1':        '#0d0d0d',   // bg와 구분되도록 약간 올림
      '--s2':        '#181818',   // s1보다 확실히 밝음
      '--border':    '#333333',   // #222 → #333 (눈에 띄게)
      '--green':     '#10b981',
      '--red':       '#ff5c5c',
      '--blue':      '#4d9fff',
      '--amber':     '#f59e0b',
      '--purple':    '#8b5cf6',
      '--cyan':      '#06b6d4',
      '--text':      '#e2e8f0',
      '--muted':     '#737373',   // #525252 → #737373 (가독성 ↑)
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

  // ── 3. 앰버
  amber: {
    label: '🔥 앰버',
    desc: '브라운 + 골드',
    vars: {
      '--bg':        '#160c00',   // 이전 #100900 → 더 밝게
      '--s1':        '#241500',   // bg보다 확실히 밝음
      '--s2':        '#341f00',   // s1보다 단계적으로 밝음
      '--border':    '#5c3d00',   // #4a3200 → 훨씬 눈에 띄게
      '--green':     '#4ade80',
      '--red':       '#ff5c5c',
      '--blue':      '#fb923c',
      '--amber':     '#fbbf24',
      '--purple':    '#fcd34d',
      '--cyan':      '#fdba74',
      '--text':      '#fef3c7',
      '--muted':     '#c27f1a',   // #a16207 → 밝은 골드 뮤트 (배경 대비 확보)
      '--gold':      '#fbbf24',
      '--gold2':     '#f97316',
      '--green-lt':  '#86efac',
      '--green-md':  '#4ade80',
      '--blue-lt':   '#fed7aa',
      '--purple-lt': '#fde68a',
      '--purple-dk': '#d97706',
      '--red-lt':    '#fca5a5',
    }
  },

  // ── 4. 퍼플
  purple: {
    label: '💜 퍼플',
    desc: '딥 퍼플 + 핑크',
    vars: {
      '--bg':        '#100828',   // 이전 #0d0720 → 밝게
      '--s1':        '#1a1038',   // 계층 차이 확보
      '--s2':        '#25174e',   // s1보다 분명히 밝음
      '--border':    '#4a2d8a',   // #3b1f72 → 훨씬 밝게
      '--green':     '#a78bfa',
      '--red':       '#f43f5e',
      '--blue':      '#818cf8',
      '--amber':     '#e879f9',
      '--purple':    '#c084fc',
      '--cyan':      '#a5b4fc',
      '--text':      '#f0e6ff',
      '--muted':     '#a855f7',   // #9333ea → 더 밝은 라벤더 (확실히 보임)
      '--gold':      '#e879f9',
      '--gold2':     '#c026d3',
      '--green-lt':  '#d8b4fe',
      '--green-md':  '#c084fc',
      '--blue-lt':   '#a5b4fc',
      '--purple-lt': '#f0abfc',
      '--purple-dk': '#7c3aed',
      '--red-lt':    '#fb7185',
    }
  },

  // ── 5. 포레스트
  forest: {
    label: '🌿 포레스트',
    desc: '딥 그린 + 에메랄드',
    vars: {
      '--bg':        '#051209',   // 이전 #040f08 → 밝게
      '--s1':        '#0a2010',   // 카드 — bg보다 확실히 밝음
      '--s2':        '#102e1a',   // 패널 — s1보다 단계적으로 밝음
      '--border':    '#1a5c32',   // #165c30 → 약간 더 선명하게
      '--green':     '#34d399',
      '--red':       '#ff6b6b',
      '--blue':      '#10b981',
      '--amber':     '#6ee7b7',
      '--purple':    '#a7f3d0',
      '--cyan':      '#34d399',
      '--text':      '#e0fdf4',
      '--muted':     '#34a36a',   // #059669 → 더 밝은 민트그린 (배경 대비 확보)
      '--gold':      '#6ee7b7',
      '--gold2':     '#34d399',
      '--green-lt':  '#a7f3d0',
      '--green-md':  '#6ee7b7',
      '--blue-lt':   '#86efac',
      '--purple-lt': '#bbf7d0',
      '--purple-dk': '#047857',
      '--red-lt':    '#fca5a5',
    }
  },

  // ── 6. 미드나잇
  midnight: {
    label: '🌃 미드나잇',
    desc: '슬레이트 + 스카이블루',
    vars: {
      '--bg':        '#080e1c',   // 이전 #070b14 → 약간 밝게
      '--s1':        '#111c30',   // #0f1624 → 계층 차이 확보
      '--s2':        '#1a2a44',   // #182033 → 확실히 밝음
      '--border':    '#2e4a7a',   // #2e4068 → 더 밝고 선명하게
      '--green':     '#38bdf8',
      '--red':       '#f87171',
      '--blue':      '#60a5fa',
      '--amber':     '#38bdf8',
      '--purple':    '#818cf8',
      '--cyan':      '#7dd3fc',
      '--text':      '#e0f2fe',
      '--muted':     '#6b8aad',   // #475569 → 밝은 슬레이트블루 (확실히 보임)
      '--gold':      '#38bdf8',
      '--gold2':     '#0ea5e9',
      '--green-lt':  '#7dd3fc',
      '--green-md':  '#38bdf8',
      '--blue-lt':   '#93c5fd',
      '--purple-lt': '#a5b4fc',
      '--purple-dk': '#4f46e5',
      '--red-lt':    '#fca5a5',
    }
  },

  // ── 7. 로즈골드
  rose: {
    label: '🌹 로즈골드',
    desc: '로즈 + 핑크골드',
    vars: {
      '--bg':        '#180810',   // 이전 #120608 → 밝게
      '--s1':        '#260e1a',   // #200a10 → 계층 차이 확보
      '--s2':        '#381525',   // #2e1018 → 확실히 밝음
      '--border':    '#7a2540',   // #6b1f30 → 더 선명하게
      '--green':     '#fb7185',
      '--red':       '#ff4d6d',
      '--blue':      '#f43f5e',
      '--amber':     '#fda4af',
      '--purple':    '#fb7185',
      '--cyan':      '#fecdd3',
      '--text':      '#fff1f2',
      '--muted':     '#d05a72',   // #9f1239 → 밝은 로즈핑크 (배경 대비 확보)
      '--gold':      '#fda4af',
      '--gold2':     '#f43f5e',
      '--green-lt':  '#fecdd3',
      '--green-md':  '#fda4af',
      '--blue-lt':   '#fda4af',
      '--purple-lt': '#ffb3c1',
      '--purple-dk': '#be123c',
      '--red-lt':    '#ff8fa3',
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
    const bg     = theme.vars['--bg'];
    const s1     = theme.vars['--s1'];
    const s2     = theme.vars['--s2'];
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
      <!-- 미리보기 스와치 — 4칸으로 계층 가시화 -->
      <div style="display:flex;gap:2px;flex-shrink:0;border-radius:5px;overflow:hidden;border:1px solid rgba(255,255,255,.12)">
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
    btn.style.background  = isActive ? 'rgba(255,255,255,.06)' : 'transparent';
  });
}

// ── 앱 시작 시 즉시 실행 (깜빡임 방지)
loadTheme();
