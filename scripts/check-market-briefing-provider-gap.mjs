import assert from 'node:assert/strict';
import fs from 'node:fs';
const status=fs.readFileSync('docs/market-briefing-provider-status.md','utf8');
assert.match(status,/KOSPI200 \| collector 계약 존재 \| 미연결/);
assert.match(status,/SOX \| Yahoo `\^SOX` \| 연결됨/);
assert.match(status,/VIX \| Yahoo `\^VIX` \| 보조 연결됨/);
assert.match(status,/K200_NIGHT .* 런타임 검증 대기/);
console.log('브리핑 provider 미연결 항목을 연결 완료로 오인하지 않는 상태 계약 통과');
