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

  // ── 2. 블랙 (기존 유지)
  black: {
    label: '🌑 블랙',
    desc: '순수 블랙',
    vars: {
      '--bg':        '#000000',
      '--s1':        '#0a0a0a',
      '--s2':        '#111111',
      '--border':    '#222222',
      '--green':     '#10b981',
      '--red':       '#E52E2E',
      '--blue':      '#0057FF',
      '--amber':     '#f59e0b',
      '--purple':    '#8b5cf6',
      '--cyan':      '#06b6d4',
      '--text':      '#e2e8f0',
      '--muted':     '#525252',
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

  // ── 3. 앰버 (완전 재설계 — 배경 계층 강화, 액센트 대비 ↑)
  amber: {
    label: '🔥 앰버',
    desc: '브라운 + 골드',
    vars: {
      '--bg':        '#100900',   // 좀 더 밝게 → s1/s2와 계층 분리
      '--s1':        '#1e1200',   // +어두운 갈색 패널
      '--s2':        '#2a1a00',   // +중간 패널
      '--border':    '#4a3200',   // 테두리 더 밝게 → 잘 보임
      '--green':     '#4ade80',   // 어두운 배경에서 밝은 그린
      '--red':       '#ff5c5c',
      '--blue':      '#fb923c',   // 오렌지 → 앰버 계열 포인트
      '--amber':     '#fbbf24',   // 밝은 골드
      '--purple':    '#fcd34d',
      '--cyan':      '#fdba74',
      '--text':      '#fef3c7',   // 따뜻한 화이트
      '--muted':     '#a16207',   // 더 밝은 뮤트 → 가독성 ↑
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

  // ── 4. 퍼플 (완전 재설계 — 배경 더 밝게, 핑크 액센트 강화)
  purple: {
    label: '💜 퍼플',
    desc: '딥 퍼플 + 핑크',
    vars: {
      '--bg':        '#0d0720',   // 이전보다 밝은 자주
      '--s1':        '#160d30',   // 카드 배경
      '--s2':        '#1e1242',   // 중간 패널
      '--border':    '#3b1f72',   // 테두리 훨씬 밝게
      '--green':     '#a78bfa',
      '--red':       '#f43f5e',
      '--blue':      '#818cf8',   // 인디고 블루
      '--amber':     '#e879f9',   // 밝은 핑크/매그넌타
      '--purple':    '#c084fc',
      '--cyan':      '#a5b4fc',
      '--text':      '#f0e6ff',   // 더 밝은 텍스트
      '--muted':     '#9333ea',   // 더 밝은 뮤트
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

  // ── 5. 포레스트 (완전 재설계 — 배경 계층·에메랄드 대비 강화)
  forest: {
    label: '🌿 포레스트',
    desc: '딥 그린 + 에메랄드',
    vars: {
      '--bg':        '#040f08',
      '--s1':        '#071a0f',   // 카드 배경
      '--s2':        '#0c2818',   // 중간 패널 — s1보다 분명히 밝음
      '--border':    '#165c30',   // 테두리 눈에 띄게
      '--green':     '#34d399',   // 에메랄드 — 배경 대비 충분
      '--red':       '#ff6b6b',
      '--blue':      '#10b981',
      '--amber':     '#6ee7b7',
      '--purple':    '#a7f3d0',
      '--cyan':      '#34d399',
      '--text':      '#e0fdf4',   // 밝은 민트화이트
      '--muted':     '#059669',   // 더 밝은 뮤트
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

  // ── 6. 미드나잇 블루 (신규)
  midnight: {
    label: '🌃 미드나잇',
    desc: '슬레이트 + 스카이블루',
    vars: {
      '--bg':        '#070b14',
      '--s1':        '#0f1624',   // 카드
      '--s2':        '#182033',   // 패널
      '--border':    '#2e4068',   // 밝은 슬레이트 테두리
      '--green':     '#38bdf8',   // 스카이블루 (수익)
      '--red':       '#f87171',
      '--blue':      '#60a5fa',
      '--amber':     '#38bdf8',
      '--purple':    '#818cf8',
      '--cyan':      '#7dd3fc',
      '--text':      '#e0f2fe',   // 스카이 화이트
      '--muted':     '#475569',
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

  // ── 7. 로즈골드 (신규)
  rose: {
    label: '🌹 로즈골드',
    desc: '로즈 + 핑크골드',
    vars: {
      '--bg':        '#120608',
      '--s1':        '#200a10',
      '--s2':        '#2e1018',
      '--border':    '#6b1f30',
      '--green':     '#fb7185',   // 포인트: 로즈
      '--red':       '#ff4d6d',
      '--blue':      '#f43f5e',
      '--amber':     '#fda4af',   // 밝은 핑크골드
      '--purple':    '#fb7185',
      '--cyan':      '#fecdd3',
      '--text':      '#fff1f2',   // 웜 화이트
      '--muted':     '#9f1239',   // 더 밝은 뮤트
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
