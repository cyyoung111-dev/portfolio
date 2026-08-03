import fs from 'node:fs';
import vm from 'node:vm';

const path = 'src/gas/apps_script.gs';
const source = fs.readFileSync(path, 'utf8');

// Apps Script 전역 객체는 실행하지 않고 JavaScript 구문만 컴파일합니다.
new vm.Script(source, { filename: path });

// 주석과 문자열을 제외한 뒤 `_`로 시작하는 내부 헬퍼 호출이 실제 선언되어 있는지 확인합니다.
const scrubbed = source
  .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const declared = new Set([
  ...scrubbed.matchAll(/\bfunction\s+(_[A-Za-z$][\w$]*)\s*\(/g),
  ...scrubbed.matchAll(/\bvar\s+(_[A-Za-z$][\w$]*)\s*=\s*function\s*\(/g),
].map(match => match[1]));
const called = new Set([...scrubbed.matchAll(/\b(_[A-Za-z$][\w$]*)\s*\(/g)].map(match => match[1]));
const missing = [...called].filter(name => !declared.has(name)).sort();

if (missing.length) {
  console.error(`❌ GAS 내부 헬퍼 선언 누락: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`✅ GAS syntax/internal helper check passed (${declared.size} helpers)`);
