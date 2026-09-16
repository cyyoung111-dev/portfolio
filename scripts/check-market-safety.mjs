import fs from 'node:fs';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const trade = fs.readFileSync('src/web/features/trade/editor/mgmt_trade.js', 'utf8');

const priceFn = gas.match(/function\s+fetchPricesGoogleFinance\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!priceFn || /GOOGLEFINANCE\s*\(/.test(priceFn[1])) {
  console.error('❌ 주식·ETF 가격 provider 함수에 GOOGLEFINANCE 호출이 남아 있습니다.');
  process.exit(1);
}
if (!/fetchHistoricalPricesToss/.test(priceFn[1]) || !/fetchPricesKrx/.test(priceFn[1]) || !/return prices/.test(priceFn[1])) {
  console.error('❌ 가격 fallback이 Toss → KRX → 저장값 보존 구조가 아닙니다.');
  process.exit(1);
}
if (!/persist:\s*false/.test(web) || !/visibilitychange/.test(web)) {
  console.error('❌ polling 저장 분리 또는 hidden 처리 계약이 없습니다.');
  process.exit(1);
}
if (!/te-action-wrap/.test(trade) || !/trade\.ratio\s*=\s*ratio/.test(trade)
    || !/trade\.fractionalCash/.test(trade) || !/tradeType === 'split'/.test(trade)) {
  console.error('❌ SPLIT/REVERSE_SPLIT 입력·검증·단주정산 경로가 없습니다.');
  process.exit(1);
}
if (!/비율.*단주정산/.test(gas) || !/row\[9\]/.test(gas) || !/fractionalCash/.test(gas)) {
  console.error('❌ 거래 원장의 Corporate Action 확장 컬럼 또는 읽기 경로가 없습니다.');
  process.exit(1);
}

const forbidden = /(TOSS_CLIENT_SECRET|TOSS_CLIENT_ID)\s*[:=]\s*['"][^'"]{12,}['"]/;
if (forbidden.test(gas) || forbidden.test(web)) {
  console.error('❌ Toss 인증정보가 소스에 하드코딩되어 있습니다.');
  process.exit(1);
}
console.log('✅ 가격 provider·polling·Corporate Action·Secret 노출 안전성 검사 통과');
