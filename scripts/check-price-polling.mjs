import fs from 'node:fs';

const source = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const polling = source.match(/async function pollCurrentPrices\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!polling
    || !/document\.hidden/.test(polling[1])
    || !/persist:\s*false/.test(polling[1])
    || !/저장 이력\/Snapshot 미변경/.test(polling[1])
    || !/마지막 정상값 유지/.test(polling[1])
    || !/setInterval\(pollCurrentPrices,\s*60\s*\*\s*1000\)/.test(source)
    || !/visibilitychange/.test(source)
    || !/startPricePolling\(\)/.test(source)) {
  console.error('❌ 현재가 polling의 hidden 중단·persist=false·실패 시 마지막 정상값 유지 경로가 없습니다.');
  process.exit(1);
}

const fetchBlock = source.match(/async function fetchFromGsheet\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!fetchBlock || !/_fetchFromGsheetInner\(dateStr, options\)/.test(fetchBlock[1])) {
  console.error('❌ polling/수동조회 옵션이 실제 GAS 요청 경로로 전달되지 않습니다.');
  process.exit(1);
}

console.log('✅ 현재가 polling 저장 분리·hidden 완화·실패 보존 검사 통과');
