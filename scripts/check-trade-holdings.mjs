import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/domain/portfolio/portfolio_service.js', 'utf8');
const context = {
  rawTrades: [],
  rawHoldings: [{ acct: '기존', name: '잔존값', qty: 1 }],
  migrateLegacyTrades() {},
  getEP() { return null; },
  getEPType(_ep, fallback) { return fallback || '주식'; },
  getAcctTaxType() { return '일반'; },
  EDITABLE_PRICES: [],
  fundDirect: {},
  STOCK_CODE: {},
  epPush() {},
};
vm.runInNewContext(source, context, { filename: 'src/web/domain/portfolio/portfolio_service.js' });

context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 0) {
  console.error('❌ 마지막 거래 삭제 후 보유현황이 비워지지 않았습니다.');
  process.exit(1);
}

context.rawHoldings.push({ acct: '기존', name: '잔존값', qty: 1 });
context.rawTrades.push(
  { date: '2026-01-01', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 10, price: 1000, assetType: '주식' },
  { date: '2026-01-02', tradeType: 'sell', acct: '계좌1', name: '테스트', qty: 10, price: 1100, assetType: '주식' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 0) {
  console.error('❌ 전량 매도 후 과거 보유현황이 남았습니다.');
  process.exit(1);
}

context.rawTrades.length = 0;
context.rawTrades.push(
  { date: '2026-01-03', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 3, price: 1200, assetType: '주식' },
  { date: '2026-01-04', tradeType: 'buy', acct: '계좌1', name: '테스트', qty: 2, price: 1201, assetType: '주식' },
);
context.syncHoldingsFromTrades({ clearWhenEmpty: true });
if (context.rawHoldings.length !== 1
    || context.rawHoldings[0].qty !== 5
    || context.rawHoldings[0].cost !== 1200
    || context.rawHoldings[0].costAmt !== 6002) {
  console.error('❌ 거래 저장 후 보유수량·평균단가·실제 매입금액 계산이 실패했습니다.');
  process.exit(1);
}

console.log('✅ 거래 저장·전량 매도·마지막 거래 삭제의 보유현황 반영 검사 통과');
