const pColor = v => v >= 0 ? 'var(--green)' : 'var(--red)';
const pSign  = v => v >= 0 ? '+' : '';

// ─────────────────────────────────────────────────────────────
// resolveColor: CSS 변수 → Canvas/HTML 실제 색상값 변환
//
// ★ 규칙 (절대 변경 금지) ★
//  1. Canvas fillStyle/strokeStyle 에는 반드시 resolveColor() 통과값만 사용
//  2. ctx.fillStyle = 'var(--xxx)'  ← 직접 전달 절대 금지
//  3. ctx.fillStyle = resolveColor('var(--xxx)')  ← 항상 이 형태
//  4. 이 함수 자체와 _CSS_VAR_MAP 을 수정할 때는 donut 렌더링 전체를 테스트할 것
// ─────────────────────────────────────────────────────────────

// CSS 변수 → hex 고정 매핑 (getComputedStyle 의존 제거 — 항상 올바른 색상 보장)
const _CSS_VAR_MAP = {
  '--bg':         '#080d18',
  '--s1':         '#0e1726',
  '--s2':         '#141f33',
  '--border':     '#1c2a42',
  '--green':      '#10b981',
  '--red':        '#E52E2E',
  '--blue':       '#0057FF',
  '--amber':      '#f59e0b',
  '--purple':     '#8b5cf6',
  '--cyan':       '#06b6d4',
  '--pink':       '#ec4899',
  '--text':       '#e2e8f0',
  '--muted':      '#64748b',
  '--gold':       '#f59e0b',
  '--gold2':      '#f97316',
  '--red-lt':     '#FF6B6B',
  '--green-lt':   '#4ade80',
  '--green-md':   '#34d399',
  '--blue-lt':    '#5B8EFF',
  '--purple-lt':  '#a78bfa',
  '--purple-dk':  '#7c3aed',
};

const _colorCache = {};
function resolveColor(c) {
  if (!c || typeof c !== 'string') return 'var(--muted)';
  const cs = c.trim();
  // 이미 hex / rgb / rgba → 그대로
  if (cs.startsWith('#') || cs.startsWith('rgb')) return cs;
  // var(--xxx) 형식
  if (cs.startsWith('var(--')) {
    if (_colorCache[cs]) return _colorCache[cs];
    const varName = cs.slice(4, -1).trim(); // '--green'
    // 1순위: 고정 매핑
    if (_CSS_VAR_MAP[varName]) {
      _colorCache[cs] = _CSS_VAR_MAP[varName];
      return _colorCache[cs];
    }
    // 2순위: getComputedStyle (사용자 커스텀 변수 대응)
    try {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (resolved && !resolved.startsWith('var(')) {
        _colorCache[cs] = resolved;
        return _colorCache[cs];
      }
    } catch(e) { console.warn('[resolveColor]', e.message); }
    // fallback
    _colorCache[cs] = 'var(--muted)';
    return 'var(--muted)';
  }
  // 그 외 (named color 등) → 그대로
  return cs;
}
