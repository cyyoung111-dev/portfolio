import assert from 'node:assert/strict';
import fs from 'node:fs';
const status=fs.readFileSync('docs/market-briefing-provider-status.md','utf8');
assert.match(status,/KOSPI200 \| Yahoo `\^KS200` \| 보조 연결됨/);
assert.match(status,/SOX \| Yahoo `\^SOX` \| 연결됨/);
assert.match(status,/VIX \| Yahoo `\^VIX` \| 보조 연결됨/);
assert.match(status,/K200_NIGHT .* KRX `drv\/fut_bydd_trd` .* 공식 일별 종가 연결됨/);
assert.match(status,/KIS는 선택적 live 입력/);
console.log('브리핑 provider 상태 계약: KOSPI200/SOX/VIX 보조 및 KRX K200 야간 종가 연결 확인');
