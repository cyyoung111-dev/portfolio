import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/shared/theme.js', 'utf8');
const marker = source.indexOf('const THEME_STORAGE_KEY');
if (marker < 0) throw new Error('THEMES 선언 범위를 찾지 못했습니다.');
const context = {};
vm.runInNewContext(`${source.slice(0, marker)}\nglobalThis.__THEMES__ = THEMES;`, context);

function luminance(hex) {
  const channels = String(hex).slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const failures = [];
for (const [name, theme] of Object.entries(context.__THEMES__)) {
  const vars = theme.vars;
  const pairs = [
    ['본문/카드', vars['--text'], vars['--s1']],
    ['보조문구/카드', vars['--muted'], vars['--s1']],
    ['보조문구/보조카드', vars['--muted'], vars['--s2']],
    theme.mode === 'light'
      ? ['강조버튼/글자', '#ffffff', vars['--gold']]
      : ['강조버튼/글자', '#111827', vars['--amber']],
    ['보라버튼/글자', '#ffffff', vars['--purple-dk']],
  ];
  for (const [label, foreground, background] of pairs) {
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) failures.push(`${name} ${label} ${ratio.toFixed(2)}:1`);
  }
}

if (failures.length) {
  console.error(`❌ 테마 WCAG AA 대비 미달:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`✅ 테마 대비 검사 통과 (${Object.keys(context.__THEMES__).length}개 테마, WCAG AA 4.5:1 이상)`);
