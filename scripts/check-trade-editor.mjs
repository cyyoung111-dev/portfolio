import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/trade/editor/mgmt_trade.js', 'utf8');
const elements = {
  'te-name-btns': { innerHTML: '' },
  'te-no-ep-hint': { style: {} },
  'te-name': { value: '' },
  'te-code': { value: '' },
  'te-selected-name': { style: {}, textContent: '' },
};
const context = {
  window: {},
  rawTrades: [{ id: 101, acct: '계좌1', name: '주식종목' }],
  EDITABLE_PRICES: [
    { name: '주식종목', assetType: '주식' },
    { name: 'ETF종목', assetType: 'ETF' },
  ],
  STOCK_CODE: {},
  $el(id) { return elements[id] || null; },
  getEPType(item, fallback) { return item?.assetType || fallback; },
  _escapeHtml(value) { return String(value); },
  _fBtnClass(active) { return active ? 'active' : ''; },
};

vm.runInNewContext(`${source}\n
  globalThis.__testRefresh = _refreshTeCodeList;
  globalThis.__testEdit = editTrade;
  globalThis.__setOpen = fn => { openAddTrade = fn; };
`, context, { filename: 'src/web/features/trade/editor/mgmt_trade.js' });

let selectedTrade = null;
context.__setOpen(trade => { selectedTrade = trade; });
context.__testEdit('101');
if (!selectedTrade || selectedTrade.id !== 101) {
  console.error('❌ 문자열 dataset ID로 숫자형 기존 거래를 선택하지 못했습니다.');
  process.exit(1);
}

context.__testRefresh('', '', '계좌1', 'ETF');
if (!elements['te-name-btns'].innerHTML.includes('ETF종목') || elements['te-name-btns'].innerHTML.includes('주식종목')) {
  console.error('❌ 거래 유형 선택에 따라 종목 목록이 필터링되지 않았습니다.');
  process.exit(1);
}

if (source.includes("f('te-price').value")) {
  console.error('❌ 존재하지 않는 기존 단가 입력 필드를 참조하고 있습니다.');
  process.exit(1);
}

console.log('✅ 기존 거래 선택·필드 복원·유형별 종목 필터 검사 통과');
