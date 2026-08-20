import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/views/views_tradegroup.js', 'utf8');
const context = {
  rawTrades: [
    { date: '2026-01-01', tradeType: 'buy', acct: 'A계좌', name: '테스트ETF', qty: 10, price: 100 },
    { date: '2026-01-02', tradeType: 'buy', acct: 'B계좌', name: '테스트ETF', qty: 10, price: 1000 },
    { date: '2026-01-03', tradeType: 'sell', acct: 'A계좌', name: '테스트ETF', qty: 10, price: 200 },
  ],
};
vm.runInNewContext(`${source}\n
  globalThis.__buildGroup = _tgBuildGroup;
`, context, { filename: 'src/web/views/views_tradegroup.js' });

const all = context.__buildGroup('테스트ETF', '');
const acctA = all.accounts.find(item => item.acct === 'A계좌');
const acctB = all.accounts.find(item => item.acct === 'B계좌');
if (all.qty !== 10 || all.totalCost !== 10000 || all.realizedPnl !== 1000
    || acctA?.qty !== 0 || acctA?.realizedPnl !== 1000
    || acctB?.qty !== 10 || acctB?.totalCost !== 10000) {
  console.error('❌ 종목별 거래의 계좌별 원가·실현손익 계산이 실패했습니다.');
  process.exit(1);
}

const onlyB = context.__buildGroup('테스트ETF', 'B계좌');
if (onlyB.trades.length !== 1 || onlyB.accounts.length !== 1 || onlyB.qty !== 10 || onlyB.totalCost !== 10000) {
  console.error('❌ 종목별 거래의 계좌 필터 계산이 실패했습니다.');
  process.exit(1);
}

console.log('✅ 종목별 거래 계좌 분리·전체 합계·계좌 필터 검사 통과');
