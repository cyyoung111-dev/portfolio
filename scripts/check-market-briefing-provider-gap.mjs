import assert from 'node:assert/strict';
import fs from 'node:fs';
const status=fs.readFileSync('docs/market-briefing-provider-status.md','utf8');
assert.match(status,/KOSPI200 \| Yahoo `\^KS200` \| 보조 연결됨/);
assert.match(status,/SOX \| Yahoo `\^SOX` \| 연결됨/);
assert.match(status,/VIX \| Yahoo `\^VIX` \| 보조 연결됨/);
assert.match(status,/K200_NIGHT .* 런타임 검증 대기/);
console.log('브리핑 provider 상태 계약: KOSPI200/SOX/VIX 보조·연결 상태와 K200 야간 런타임 대기 확인');
