// #734: production bulk account-transfer UI must preserve full chronology.
// All cases are pure VM/shadow tests. No GAS, Sheets, DOM browser or finance writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/web/views/views_trades.js','utf8');
const start=source.indexOf('function _validateTradeBulkAccountTransfer(');
const ending=source.indexOf('\n}',source.indexOf('function changeSelectedTradesAcct('))+2;
assert(start>=0&&ending>start,'BULK_TRANSFER_FUNCTIONS_NOT_FOUND');
const code=source.slice(start,ending);
const dateKey=value=>String(value||'').replaceAll('.','-');
const row=(id,date,type,acct,qty,extra={})=>({
 id,date,tradeType:type,acct,name:'SHADOW',code:'005930',
 assetType:'주식',qty,price:100,accountId:'OLD',...extra
});
const buy=row('tr_buy00001','2026-01-02','buy','A',10);
const sale=row('tr_sell0001','2026-01-03','sell','A',6);

function setup(initial,selected,{target='B',confirmResult=true}={}){
 const rows=structuredClone(initial),toast=[],saves=[];
 let confirmations=0;
 const ctx=vm.createContext({
  rawTrades:rows,
  $el:()=>({value:target}),
  document:{querySelectorAll:()=>selected.map(id=>({dataset:{id}}))},
  showToast:(message,kind)=>toast.push({message,kind}),
  confirm:()=>{confirmations++;return confirmResult;},
  _portfolioTradeDateKey:dateKey,
  _commitTrades:()=>saves.push(structuredClone(rows)),
  getAccountId:acct=>'acct-'+acct
 });
 vm.runInContext(code+'\n globalThis.__bulk=changeSelectedTradesAcct;',ctx);
 ctx.__bulk();
 return {rows,saves,toast,confirmations};
}
const stable=JSON.stringify([buy,sale]);
for(const selected of [['tr_buy00001'],['tr_sell0001'],['tr_missing'],['tr_buy00001','tr_missing']]){
 const result=setup([buy,sale],selected);
 assert.equal(result.saves.length,0,'failed/stale transfer must never commit');
 assert.equal(JSON.stringify(result.rows),stable,'invalid move cannot mutate original ledger');
 assert.equal(result.confirmations,0,'invalid account transfer must fail before confirm');
}
const paired=setup([buy,sale],['tr_buy00001','tr_sell0001']);
assert.equal(paired.saves.length,1,'paired valid transfer must commit once');
assert.deepEqual(paired.rows.map(x=>x.acct),['B','B']);
assert.deepEqual(paired.rows.map(x=>x.accountId),['acct-B','acct-B']);
assert.match(paired.toast.at(-1).message,/서버 저장 확인 중/,
 'local store success must not be presented as remote CAS receipt confirmation');
const declined=setup([buy,sale],['tr_buy00001','tr_sell0001'],
 {confirmResult:false});
assert.equal(declined.confirmations,1);
assert.equal(declined.saves.length,0);
assert.equal(JSON.stringify(declined.rows),stable,'decline must not mutate');
const duplicate=setup([buy,sale],['tr_buy00001','tr_buy00001']);
assert.equal(duplicate.saves.length,0);
const noop=setup([buy,sale],['tr_buy00001'],{target:'A'});
assert.equal(noop.saves.length,0);
const otherDate=[buy,row('tr_other0001','2026-01-02','sell','B',4)];
assert.equal(setup(otherDate,['tr_buy00001']).saves.length,1,
 'destination account sale after or on valid buy is fundable');
const earlier=[buy,row('tr_other0002','2026-01-01','sell','B',4)];
assert.equal(setup(earlier,['tr_buy00001']).saves.length,0,
 'destination sale before moved buy must remain rejected');
const split=[buy,row('tr_split001','2026-01-03','reverse_split','A',10,{ratio:10}),
 row('tr_sale0002','2026-01-04','sell','A',1)];
assert.equal(setup(split,['tr_buy00001']).saves.length,0,
 'cannot move original buy away from a later reverse-split and sale');
const pairedSplit=setup(split,['tr_buy00001','tr_split001','tr_sale0002']);
assert.equal(pairedSplit.saves.length,1);
assert(pairedSplit.rows.every(t=>t.acct==='B'));
console.log(JSON.stringify({kind:'ISSUE734_BULK_ACCOUNT_ATOMIC_SHADOW_PASS',
 cases:10,realFinanceWrites:0,liveGasRequests:0,source:'PRODUCTION_VIEW_FUNCTION'}));
