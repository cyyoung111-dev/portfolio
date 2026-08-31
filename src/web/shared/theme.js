// ════════════════════════════════════════════════════════════════
//  theme.js — 테마 관리 (다크/라이트 + 프리셋)
//  의존: core_storage.js (lsSave / lsGet)
// ════════════════════════════════════════════════════════════════

const THEMES = {
  // ── 다크 프리셋
  ocean: {
    mode: 'dark',
    label: '🌊 오션',
    desc: '기본 네이비',
    vars: {
      '--bg': '#080d18', '--s1': '#0e1726', '--s2': '#141f33', '--border': '#1c2a42',
      '--green': '#10b981', '--red': '#E52E2E', '--blue': '#0057FF', '--amber': '#f59e0b',
      '--purple': '#8b5cf6', '--cyan': '#06b6d4', '--text': '#e2e8f0', '--muted': '#8b9bb2',
      '--gold': '#f59e0b', '--gold2': '#f97316', '--green-lt': '#4ade80', '--green-md': '#34d399',
      '--blue-lt': '#5B8EFF', '--purple-lt': '#a78bfa', '--purple-dk': '#7c3aed', '--red-lt': '#FF6B6B',
    }
  },
  black: {
    mode: 'dark',
    label: '🌑 블랙',
    desc: '차콜 그레이',
    vars: {
      '--bg': '#141414', '--s1': '#1e1e1e', '--s2': '#2a2a2a', '--border': '#3d3d3d',
      '--green': '#10b981', '--red': '#ff5c5c', '--blue': '#4d9fff', '--amber': '#f59e0b',
      '--purple': '#8b5cf6', '--cyan': '#06b6d4', '--text': '#e2e8f0', '--muted': '#a0a0a0',
      '--gold': '#f59e0b', '--gold2': '#f97316', '--green-lt': '#4ade80', '--green-md': '#34d399',
      '--blue-lt': '#5B8EFF', '--purple-lt': '#a78bfa', '--purple-dk': '#7c3aed', '--red-lt': '#FF6B6B',
    }
  },
  amber: {
    mode: 'dark',
    label: '🔥 앰버',
    desc: '브라운 + 골드',
    vars: {
      '--bg': '#1c1000', '--s1': '#2c1a00', '--s2': '#3d2500', '--border': '#6b4200',
      '--green': '#4ade80', '--red': '#ff5c5c', '--blue': '#fb923c', '--amber': '#fbbf24',
      '--purple': '#fcd34d', '--cyan': '#fdba74', '--text': '#fef3c7', '--muted': '#c9821a',
      '--gold': '#fbbf24', '--gold2': '#f97316', '--green-lt': '#86efac', '--green-md': '#4ade80',
      '--blue-lt': '#fed7aa', '--purple-lt': '#fde68a', '--purple-dk': '#92400e', '--red-lt': '#fca5a5',
    }
  },
  purple: {
    mode: 'dark',
    label: '💜 퍼플',
    desc: '딥 퍼플 + 핑크',
    vars: {
      '--bg': '#150a2e', '--s1': '#1f1040', '--s2': '#2c1a56', '--border': '#52349e',
      '--green': '#a78bfa', '--red': '#f43f5e', '--blue': '#818cf8', '--amber': '#e879f9',
      '--purple': '#c084fc', '--cyan': '#a5b4fc', '--text': '#f0e6ff', '--muted': '#b06ef5',
      '--gold': '#e879f9', '--gold2': '#c026d3', '--green-lt': '#d8b4fe', '--green-md': '#c084fc',
      '--blue-lt': '#a5b4fc', '--purple-lt': '#f0abfc', '--purple-dk': '#7c3aed', '--red-lt': '#fb7185',
    }
  },
  forest: {
    mode: 'dark',
    label: '🌿 포레스트',
    desc: '딥 그린 + 에메랄드',
    vars: {
      '--bg': '#081a0e', '--s1': '#0e2a18', '--s2': '#163824', '--border': '#236b3a',
      '--green': '#34d399', '--red': '#ff6b6b', '--blue': '#10b981', '--amber': '#6ee7b7',
      '--purple': '#a7f3d0', '--cyan': '#34d399', '--text': '#e0fdf4', '--muted': '#3db875',
      '--gold': '#6ee7b7', '--gold2': '#34d399', '--green-lt': '#a7f3d0', '--green-md': '#6ee7b7',
      '--blue-lt': '#86efac', '--purple-lt': '#bbf7d0', '--purple-dk': '#047857', '--red-lt': '#fca5a5',
    }
  },
  midnight: {
    mode: 'dark',
    label: '🌃 미드나잇',
    desc: '슬레이트 + 스카이블루',
    vars: {
      '--bg': '#0c1526', '--s1': '#152035', '--s2': '#1f2f48', '--border': '#355480',
      '--green': '#38bdf8', '--red': '#f87171', '--blue': '#60a5fa', '--amber': '#38bdf8',
      '--purple': '#818cf8', '--cyan': '#7dd3fc', '--text': '#e0f2fe', '--muted': '#7a9ec4',
      '--gold': '#38bdf8', '--gold2': '#0ea5e9', '--green-lt': '#7dd3fc', '--green-md': '#38bdf8',
      '--blue-lt': '#93c5fd', '--purple-lt': '#a5b4fc', '--purple-dk': '#4f46e5', '--red-lt': '#fca5a5',
    }
  },
  rose: {
    mode: 'dark',
    label: '🌹 로즈골드',
    desc: '로즈 + 핑크골드',
    vars: {
      '--bg': '#200d14', '--s1': '#30121e', '--s2': '#431a2b', '--border': '#842d48',
      '--green': '#fb7185', '--red': '#ff4d6d', '--blue': '#f43f5e', '--amber': '#fda4af',
      '--purple': '#fb7185', '--cyan': '#fecdd3', '--text': '#fff1f2', '--muted': '#df8298',
      '--gold': '#fda4af', '--gold2': '#f43f5e', '--green-lt': '#fecdd3', '--green-md': '#fda4af',
      '--blue-lt': '#fda4af', '--purple-lt': '#ffb3c1', '--purple-dk': '#be123c', '--red-lt': '#ff8fa3',
    }
  },
  slate: {
    mode: 'dark',
    label: '🧊 슬레이트',
    desc: '고대비 블루그레이',
    vars: {
      '--bg': '#0b1220', '--s1': '#111a2c', '--s2': '#18243a', '--border': '#2d3f5f',
      '--green': '#22c55e', '--red': '#f87171', '--blue': '#60a5fa', '--amber': '#fbbf24',
      '--purple': '#a78bfa', '--cyan': '#22d3ee', '--text': '#e6edf8', '--muted': '#8aa0c2',
      '--gold': '#fbbf24', '--gold2': '#f59e0b', '--green-lt': '#4ade80', '--green-md': '#22c55e',
      '--blue-lt': '#93c5fd', '--purple-lt': '#c4b5fd', '--purple-dk': '#6d28d9', '--red-lt': '#fca5a5',
    }
  },

  aurora: {
    mode: 'dark',
    label: '🌌 오로라',
    desc: '네이비 + 민트/바이올렛',
    vars: {
      '--bg': '#07111d', '--s1': '#0d1b2b', '--s2': '#14263a', '--border': '#284362',
      '--green': '#2dd4bf', '--red': '#fb7185', '--blue': '#60a5fa', '--amber': '#22d3ee',
      '--purple': '#a78bfa', '--cyan': '#67e8f9', '--text': '#e6f1ff', '--muted': '#7f9ab8',
      '--gold': '#22d3ee', '--gold2': '#0ea5e9', '--green-lt': '#5eead4', '--green-md': '#2dd4bf',
      '--blue-lt': '#93c5fd', '--purple-lt': '#c4b5fd', '--purple-dk': '#6d28d9', '--red-lt': '#fda4af',
    }
  },
  cyber: {
    mode: 'dark',
    label: '🕹️ 사이버',
    desc: '네온 블루/핑크 포인트',
    vars: {
      '--bg': '#070b14', '--s1': '#0d1322', '--s2': '#131c31', '--border': '#2a3d66',
      '--green': '#22d3ee', '--red': '#fb7185', '--blue': '#38bdf8', '--amber': '#f472b6',
      '--purple': '#a78bfa', '--cyan': '#67e8f9', '--text': '#e2e8f0', '--muted': '#7f8fb2',
      '--gold': '#f472b6', '--gold2': '#ec4899', '--green-lt': '#67e8f9', '--green-md': '#22d3ee',
      '--blue-lt': '#7dd3fc', '--purple-lt': '#c4b5fd', '--purple-dk': '#7c3aed', '--red-lt': '#fda4af',
    }
  },
  graphite: {
    mode: 'dark',
    label: '🪨 그래파이트',
    desc: '저채도 다크 + 선명 포인트',
    vars: {
      '--bg': '#111317', '--s1': '#171b22', '--s2': '#202733', '--border': '#313b4c',
      '--green': '#34d399', '--red': '#fb7185', '--blue': '#60a5fa', '--amber': '#f59e0b',
      '--purple': '#a78bfa', '--cyan': '#22d3ee', '--text': '#e5e7eb', '--muted': '#94a3b8',
      '--gold': '#f59e0b', '--gold2': '#f97316', '--green-lt': '#6ee7b7', '--green-md': '#34d399',
      '--blue-lt': '#93c5fd', '--purple-lt': '#c4b5fd', '--purple-dk': '#7c3aed', '--red-lt': '#fda4af',
    }
  },
  contrast: {
    mode: 'dark',
    label: '◐ 고대비 다크',
    desc: '검정 배경 + 밝은 글자와 경계',
    vars: {
      '--bg': '#000000', '--s1': '#0a0a0a', '--s2': '#171717', '--border': '#737373',
      '--green': '#4ade80', '--red': '#fb7185', '--blue': '#60a5fa', '--amber': '#facc15',
      '--purple': '#c4b5fd', '--cyan': '#67e8f9', '--text': '#ffffff', '--muted': '#d4d4d4',
      '--gold': '#facc15', '--gold2': '#fb923c', '--green-lt': '#86efac', '--green-md': '#4ade80',
      '--blue-lt': '#93c5fd', '--purple-lt': '#ddd6fe', '--purple-dk': '#6d28d9', '--red-lt': '#fda4af',
    }
  },

  // ── 라이트 프리셋
  light: {
    mode: 'light',
    label: '☀️ 라이트',
    desc: '밝은 기본 테마',
    vars: {
      '--bg': '#f5f7fb', '--s1': '#ffffff', '--s2': '#eef2f8', '--border': '#d1d9e8',
      '--green': '#047857', '--red': '#dc2626', '--blue': '#2563eb', '--amber': '#d97706',
      '--purple': '#7c3aed', '--cyan': '#0891b2', '--text': '#0f172a', '--muted': '#566579',
      '--gold': '#b45309', '--gold2': '#c2410c', '--green-lt': '#047857', '--green-md': '#059669',
      '--blue-lt': '#2563eb', '--purple-lt': '#8b5cf6', '--purple-dk': '#6d28d9', '--red-lt': '#dc2626',
    }
  },
  light_mint: {
    mode: 'light',
    label: '🌿 라이트 민트',
    desc: '그린 포인트 라이트',
    vars: {
      '--bg': '#f4fbf8', '--s1': '#ffffff', '--s2': '#ecf7f1', '--border': '#c7e3d5',
      '--green': '#047857', '--red': '#dc2626', '--blue': '#0f766e', '--amber': '#0d9488',
      '--purple': '#0f766e', '--cyan': '#0891b2', '--text': '#0f172a', '--muted': '#506f65',
      '--gold': '#0f766e', '--gold2': '#0d9488', '--green-lt': '#047857', '--green-md': '#059669',
      '--blue-lt': '#0f766e', '--purple-lt': '#14b8a6', '--purple-dk': '#0f766e', '--red-lt': '#dc2626',
    }
  },
  light_rose: {
    mode: 'light',
    label: '🌸 라이트 로즈',
    desc: '핑크 포인트 라이트',
    vars: {
      '--bg': '#fff7fa', '--s1': '#ffffff', '--s2': '#fff0f5', '--border': '#f3c9d8',
      '--green': '#be185d', '--red': '#e11d48', '--blue': '#db2777', '--amber': '#ec4899',
      '--purple': '#d946ef', '--cyan': '#f472b6', '--text': '#3b0a1f', '--muted': '#8c5068',
      '--gold': '#db2777', '--gold2': '#be185d', '--green-lt': '#be185d', '--green-md': '#db2777',
      '--blue-lt': '#ec4899', '--purple-lt': '#f472b6', '--purple-dk': '#be185d', '--red-lt': '#e11d48',
    }
  },
  light_sand: {
    mode: 'light',
    label: '🏜️ 라이트 샌드',
    desc: '눈부심 낮춘 웜 톤',
    vars: {
      '--bg': '#f8f6f1', '--s1': '#fffdf8', '--s2': '#f3eee3', '--border': '#decfb6',
      '--green': '#166534', '--red': '#b91c1c', '--blue': '#1d4ed8', '--amber': '#b45309',
      '--purple': '#6d28d9', '--cyan': '#0e7490', '--text': '#1f2937', '--muted': '#5d6470',
      '--gold': '#a16207', '--gold2': '#b45309', '--green-lt': '#15803d', '--green-md': '#16a34a',
      '--blue-lt': '#2563eb', '--purple-lt': '#7c3aed', '--purple-dk': '#5b21b6', '--red-lt': '#dc2626',
    }
  },

  light_lavender: {
    mode: 'light',
    label: '🪻 라이트 라벤더',
    desc: '부드러운 퍼플 라이트',
    vars: {
      '--bg': '#f7f5ff', '--s1': '#ffffff', '--s2': '#f1edff', '--border': '#d8cff7',
      '--green': '#0f766e', '--red': '#dc2626', '--blue': '#4f46e5', '--amber': '#7c3aed',
      '--purple': '#7c3aed', '--cyan': '#6366f1', '--text': '#1f2040', '--muted': '#67618f',
      '--gold': '#6d28d9', '--gold2': '#7c3aed', '--green-lt': '#0f766e', '--green-md': '#14b8a6',
      '--blue-lt': '#4f46e5', '--purple-lt': '#8b5cf6', '--purple-dk': '#5b21b6', '--red-lt': '#dc2626',
    }
  },
  light_olive: {
    mode: 'light',
    label: '🫒 라이트 올리브',
    desc: '편안한 올리브 톤',
    vars: {
      '--bg': '#f7f8f2', '--s1': '#ffffff', '--s2': '#eef1e4', '--border': '#d2d9bf',
      '--green': '#3f6212', '--red': '#b91c1c', '--blue': '#1d4ed8', '--amber': '#4d7c0f',
      '--purple': '#6d28d9', '--cyan': '#0f766e', '--text': '#1f2937', '--muted': '#5f6656',
      '--gold': '#4d7c0f', '--gold2': '#65a30d', '--green-lt': '#3f6212', '--green-md': '#4d7c0f',
      '--blue-lt': '#2563eb', '--purple-lt': '#7c3aed', '--purple-dk': '#5b21b6', '--red-lt': '#dc2626',
    }
  },
  light_sky: {
    mode: 'light',
    label: '🌤️ 라이트 스카이',
    desc: '청량한 블루 라이트',
    vars: {
      '--bg': '#f2f8ff', '--s1': '#ffffff', '--s2': '#eaf2ff', '--border': '#c8d9f4',
      '--green': '#065f46', '--red': '#dc2626', '--blue': '#1d4ed8', '--amber': '#0369a1',
      '--purple': '#4338ca', '--cyan': '#0284c7', '--text': '#0f172a', '--muted': '#566579',
      '--gold': '#0369a1', '--gold2': '#0284c7', '--green-lt': '#047857', '--green-md': '#059669',
      '--blue-lt': '#2563eb', '--purple-lt': '#6366f1', '--purple-dk': '#3730a3', '--red-lt': '#dc2626',
    }
  },
  light_contrast: {
    mode: 'light',
    label: '◑ 고대비 라이트',
    desc: '흰 배경 + 짙은 글자와 경계',
    vars: {
      '--bg': '#ffffff', '--s1': '#ffffff', '--s2': '#f3f4f6', '--border': '#4b5563',
      '--green': '#166534', '--red': '#991b1b', '--blue': '#1e40af', '--amber': '#92400e',
      '--purple': '#5b21b6', '--cyan': '#155e75', '--text': '#000000', '--muted': '#374151',
      '--gold': '#92400e', '--gold2': '#9a3412', '--green-lt': '#166534', '--green-md': '#15803d',
      '--blue-lt': '#1d4ed8', '--purple-lt': '#6d28d9', '--purple-dk': '#4c1d95', '--red-lt': '#991b1b',
    }
  }
};

const THEME_STORAGE_KEY = 'app_theme';
const THEME_MODE_KEY = 'app_theme_mode';
const FONT_STORAGE_KEY = 'app_font';
const DENSITY_STORAGE_KEY = 'app_density';
const FONT_PRESETS = {
  system: {
    label: '시스템 기본 글꼴',
    desc: '추가 다운로드 없이 운영체제의 기본 UI 글꼴을 사용합니다.',
    family: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif",
  },
  pretendard: {
    label: 'Pretendard Variable',
    desc: '전체 화면에 공통 적용되는 가변 한글 UI 글꼴',
    family: "'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif",
  },
};
let _currentFont = 'pretendard';
let _currentDensity = 'default';
const LEGACY_DARK_THEMES = ['ocean', 'black', 'amber', 'purple', 'forest', 'midnight', 'rose', 'dark'];
const LEGACY_LIGHT_THEMES = ['light'];
const THEME_VISIBLE_PRESETS = {
  dark: ['ocean', 'black', 'midnight', 'slate', 'aurora', 'cyber', 'graphite', 'contrast'],
  light: ['light', 'light_mint', 'light_rose', 'light_sand', 'light_lavender', 'light_olive', 'light_sky', 'light_contrast'],
};
let _currentTheme = 'ocean';
let _themeMode = 'dark';

function _themeKeysByMode(mode) {
  const visible = THEME_VISIBLE_PRESETS[mode] || [];
  return visible.filter(key => THEMES[key] && THEMES[key].mode === mode);
}

function _normalizeThemeKey(themeKey) {
  if (THEMES[themeKey]) return themeKey;
  if (themeKey === 'amber' || themeKey === 'purple' || themeKey === 'forest' || themeKey === 'rose') return 'ocean';
  if (LEGACY_DARK_THEMES.includes(themeKey)) return 'ocean';
  if (LEGACY_LIGHT_THEMES.includes(themeKey)) return 'light';
  return 'ocean';
}

function _normalizeThemeMode(mode) {
  return mode === 'light' ? 'light' : 'dark';
}

function applyTheme(themeKey, opts = {}) {
  const normalized = _normalizeThemeKey(themeKey);
  const theme = THEMES[normalized];
  if (!theme) return;

  Object.entries(theme.vars).forEach(([key, val]) => {
    document.documentElement.style.setProperty(key, val);
  });

  _currentTheme = normalized;
  _themeMode = _normalizeThemeMode(theme.mode);
  // CSS에서도 라이트/다크 모드별 대비를 안전하게 조정할 수 있도록 현재 모드를 노출합니다.
  document.documentElement.dataset.themeMode = _themeMode;

  if (typeof lsSave === 'function') {
    lsSave(THEME_STORAGE_KEY, normalized);
    if (!opts.skipModeSave) lsSave(THEME_MODE_KEY, _themeMode);
  }
  _renderThemeButtons();
  _refreshThemeSelectorIfOpen();
}

function setThemeMode(mode) {
  const nextMode = _normalizeThemeMode(mode);
  _themeMode = nextMode;
  if (typeof lsSave === 'function') lsSave(THEME_MODE_KEY, _themeMode);

  if (THEMES[_currentTheme]?.mode !== nextMode) {
    const firstPreset = _themeKeysByMode(nextMode)[0] || 'ocean';
    applyTheme(firstPreset, { skipModeSave: true });
    return;
  }
  _renderThemeButtons();
  _refreshThemeSelectorIfOpen();
}

function _refreshThemeSelectorIfOpen() {
  const themeContainer = document.getElementById('themeSettingsBody');
  if (themeContainer && themeContainer.closest('#settingsPanel_theme')?.style.display !== 'none') {
    themeContainer.innerHTML = _buildThemeSelectorHTML();
  }
  const fontContainer = document.getElementById('fontSettingsBody');
  if (fontContainer && fontContainer.closest('#settingsPanel_font')?.style.display !== 'none') {
    fontContainer.innerHTML = _buildFontSelectorHTML();
  }
}

function loadTheme() {
  const savedMode = (typeof lsGet === 'function') ? lsGet(THEME_MODE_KEY, 'dark') : 'dark';
  _themeMode = _normalizeThemeMode(savedMode);

  const defaultByMode = _themeMode === 'light' ? 'light' : 'ocean';
  const savedTheme = (typeof lsGet === 'function') ? lsGet(THEME_STORAGE_KEY, defaultByMode) : defaultByMode;
  const normalized = _normalizeThemeKey(savedTheme);

  if (THEMES[normalized].mode !== _themeMode) {
    const firstPreset = _themeKeysByMode(_themeMode)[0] || 'ocean';
    applyTheme(firstPreset, { skipModeSave: true });
    return;
  }
  applyTheme(normalized, { skipModeSave: true });
}

function applyFont(fontKey, opts = {}) {
  // 지원하지 않는 기존 저장값만 Pretendard로 정규화한다.
  const normalized = FONT_PRESETS[fontKey] ? fontKey : 'pretendard';
  const preset = FONT_PRESETS[normalized];
  document.documentElement.style.setProperty('--font-ui', preset.family);
  document.documentElement.dataset.appFont = normalized;
  _currentFont = normalized;
  if (!opts.skipSave && typeof lsSave === 'function') lsSave(FONT_STORAGE_KEY, normalized);
  _refreshThemeSelectorIfOpen();
}

function loadFont() {
  const saved = typeof lsGet === 'function' ? lsGet(FONT_STORAGE_KEY, 'pretendard') : 'pretendard';
  applyFont(saved, { skipSave: true });
}

function applyDensity(densityKey, opts = {}) {
  const normalized = densityKey === 'compact' ? 'compact' : 'default';
  document.documentElement.dataset.uiDensity = normalized;
  _currentDensity = normalized;
  if (!opts.skipSave && typeof lsSave === 'function') lsSave(DENSITY_STORAGE_KEY, normalized);
  _refreshThemeSelectorIfOpen();
}

function loadDensity() {
  const saved = typeof lsGet === 'function' ? lsGet(DENSITY_STORAGE_KEY, 'default') : 'default';
  applyDensity(saved, { skipSave: true });
}

function _buildFontSelectorHTML() {
  const sample = '총 평가금액 987,654,321원 · 수익률 +12.48%';
  const buttons = Object.entries(FONT_PRESETS).map(([key, preset]) => {
    const active = key === _currentFont;
    return `<button type="button" data-theme-action="font" data-font-key="${_escapeHtml(key)}"
      style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ${active ? 'var(--amber)' : 'var(--border)'};
             background:${active ? 'var(--c-amber-08)' : 'var(--s1)'};color:var(--text);cursor:pointer;text-align:left;font-family:${preset.family}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:.80rem;font-weight:700">${preset.label}</span>
        ${active ? '<span style="color:var(--gold);font-size:.68rem;font-weight:700">현재 적용</span>' : ''}
      </div>
      <div style="font-size:.66rem;color:var(--muted);margin-top:2px">${preset.desc}</div>
      <div style="font-size:.76rem;font-weight:600;margin-top:6px;font-variant-numeric:tabular-nums">${sample}</div>
    </button>`;
  }).join('');
  const densityButtons = [
    ['default', '기본', '현재 가독성과 여백을 유지합니다.'],
    ['compact', '컴팩트', '최소 12px을 유지하며 본문과 컨트롤 밀도를 낮춥니다.'],
  ].map(([key, label, desc]) => {
    const active = key === _currentDensity;
    return `<button type="button" data-theme-action="density" data-density-key="${key}"
      style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ${active ? 'var(--amber)' : 'var(--border)'};
             background:${active ? 'var(--c-amber-08)' : 'var(--s1)'};color:var(--text);cursor:pointer;text-align:left">
      <div style="font-size:.80rem;font-weight:700">${label}${active ? ' <span style="color:var(--gold);font-size:.68rem">현재 적용</span>' : ''}</div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:2px">${desc}</div>
    </button>`;
  }).join('');
  return `<div>
    <div style="font-size:.70rem;font-weight:700;color:var(--muted);letter-spacing:.08em;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">🔤 글꼴 선택</div>
    <div style="font-size:.65rem;color:var(--muted);margin-bottom:8px">모든 기기와 화면에 Pretendard Variable을 동일하게 적용합니다.</div>
    <div style="display:flex;flex-direction:column;gap:6px">${buttons}</div>
    <div style="font-size:.75rem;font-weight:700;color:var(--muted);letter-spacing:.08em;margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">↔ 화면 밀도</div>
    <div style="display:flex;flex-direction:column;gap:6px">${densityButtons}</div>
  </div>`;
}

function renderThemeSelector(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = _buildThemeSelectorHTML();
}

function renderFontSelector(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = _buildFontSelectorHTML();
}

function _buildThemeSelectorHTML() {
  const modeBtn = (mode, label) => {
    const active = _themeMode === mode;
    return `<button data-theme-action="mode" data-mode="${_escapeHtml(mode)}" id="theme-mode-${mode}"
      style="padding:6px 10px;border-radius:7px;border:1px solid ${active ? 'var(--amber)' : 'var(--border)'};
             background:${active ? 'var(--c-amber-08)' : 'transparent'};color:${active ? 'var(--gold)' : 'var(--muted)'};
             font-size:.70rem;font-weight:700;cursor:pointer">${label}</button>`;
  };

  const btns = _themeKeysByMode(_themeMode).map((key) => {
    const theme = THEMES[key];
    const isActive = key === _currentTheme;
    const bg = theme.vars['--bg'];
    const s1 = theme.vars['--s1'];
    const s2 = theme.vars['--s2'];
    const accent = theme.vars['--amber'];
    const border = theme.vars['--border'];
    return `<button data-theme-action="apply" data-theme-key="${_escapeHtml(key)}" id="theme-btn-${key}"
      style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border-radius:8px;cursor:pointer;
             border:1px solid ${isActive ? accent : border};background:${isActive ? 'rgba(255,255,255,.06)' : 'transparent'};
             transition:all .15s;text-align:left;">
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

  return `<div style="margin-bottom:8px">
    <div style="font-size:.70rem;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">🎨 테마 선택</div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      ${modeBtn('dark', '🌙 다크')}
      ${modeBtn('light', '☀️ 라이트')}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${btns}</div>
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

  ['dark', 'light'].forEach(mode => {
    const btn = document.getElementById('theme-mode-' + mode);
    if (!btn) return;
    const active = _themeMode === mode;
    btn.style.borderColor = active ? 'var(--amber)' : 'var(--border)';
    btn.style.background = active ? 'var(--c-amber-08)' : 'transparent';
    btn.style.color = active ? 'var(--gold)' : 'var(--muted)';
  });
}

loadTheme();
loadFont();
loadDensity();

function switchSettingsTab(tab) {
  const panels = ['tab', 'theme', 'font'];
  panels.forEach(p => {
    const panel = document.getElementById('settingsPanel_' + p);
    const btn = document.getElementById('settingsTabBtn_' + p);
    if (!panel || !btn) return;
    const isActive = p === tab;
    panel.style.display = isActive ? 'block' : 'none';
    btn.classList.toggle('is-active', isActive);
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
  if (tab === 'font') {
    const container = document.getElementById('fontSettingsBody');
    if (container) container.innerHTML = _buildFontSelectorHTML();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const _origOpen = window.openTabSettings;
  window.openTabSettings = function() {
    if (typeof _origOpen === 'function') _origOpen();
    switchSettingsTab('tab');
  };
});


function _queueThemeSettingsSync() {
  if (typeof saveSettings === 'function') saveSettings(false);
}
