import assert from 'node:assert/strict';
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

// Production saveTrade with synthetic DOM; never sends requests or writes live data.
function run(trades,qty,date='2026-02-23'){
const fields={'te-name':'시험','te-qty':String(qty),'te-date':date,'te-price-krw':'100','te-acct':'계좌','te-code':'005930','te-assettype':'주식','te-memo':''};
const elements=Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{value,style:{}}]));elements['te-error']={style:{},textContent:''};elements['te-fx-wrap']={style:{display:'none'}};
let saved=0; const ctx={window:{_currentTradeType:'sell'},rawTrades:JSON.parse(JSON.stringify(trades)),EDITABLE_PRICES:[{name:'시험',code:'005930',assetType:'주식'}],STOCK_CODE:{},$el:id=>elements[id]||null,normName:x=>x,getEP:()=>({currency:'KRW'}),getAccountId:()=> 'A',genTradeId:()=>999};
vm.runInNewContext(source+'\n_commitTrades=()=>{globalThis.saved=true}; closeTradeEdit=()=>{};saveTrade();',ctx);return {saved:!!ctx.saved,error:elements['te-error'].textContent,trades:ctx.rawTrades};
}
const row=(date,tradeType,qty,ratio)=>({date,tradeType,qty,ratio,name:'시험',code:'005930',acct:'계좌',price:100});
assert.equal(run([row('2026-03-01','buy',10)],1).saved,false,'future buy cannot fund past sale');
assert.equal(run([row('2026-02-01','buy',100),row('2026-03-01','reverse_split',100,10)],20).saved,true,'historical sale before reverse split must use historical quantity');
assert.equal(run([row('2026-02-01','buy',10),row('2026-03-01','sell',8)],4).saved,false,'late sale must not invalidate a later sale');
assert.equal(run([row('2026-02-01','buy',10)],10).saved,true,'exact available quantity is accepted');
assert.equal(run([row('2026-02-01','buy',10)],11).saved,false,'overselling is rejected');
assert.equal(run([row('2026-03-01','buy',100),row('2026-02-01','buy',10)],5).saved,true,'unsorted input uses chronological order');
const renamed=row('2026-02-01','buy',10);renamed.name='이전이름';
assert.equal(run([renamed],5).saved,true,'same-code name changes preserve ownership');
const other=row('2026-02-01','buy',10);other.acct='다른계좌';
assert.equal(run([other],1).saved,false,'other account cannot fund sale');
const rejected=run([row('2026-03-01','buy',10)],1);
assert.equal(rejected.trades.length,1,'rejection must not mutate ledger');
console.log('실제 saveTrade 소급매도·병합·후속매도·계좌·종목코드 검증 PASS');
