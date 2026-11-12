// #734: source-linked trade edit -> earliest rebuild date -> holdings,
// cost basis, realized P&L, valuation; isolated from actual master Sheet.
// Uses the exact composed deployed GAS 9.292, not a copied replay algorithm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {composeIssue860Gas9292CloseStatePreview} from './compose-issue860-gas9292-close-state-preview.mjs';
const gas=composeIssue860Gas9292CloseStatePreview().source;
const service=fs.readFileSync('src/web/domain/portfolio/portfolio_service.js','utf8');
const extract=(s,name)=>{
 const i=s.indexOf('function '+name+'('),j=s.indexOf('\n}',i);
 assert(i>=0&&j>i,'MISSING_EXECUTABLE_FUNCTION_'+name);
 return s.slice(i,j+2);
};
const g=vm.createContext({_issue507GateInside_:true,
 _normalizeDate:v=>String(v||'').trim().replaceAll('.','-')});
vm.runInContext(extract(gas,'_earliestChangedTradeDate'),g);
const buy={id:'tr_shadowbuy01',date:'2026-11-02',tradeType:'buy',
 acct:'ISA',name:'SHADOW',code:'005930',qty:10,price:100,
 assetType:'주식',memo:''};
const sell={...buy,id:'tr_shadowsell01',date:'2026-11-04',
 tradeType:'sell',qty:4,price:130};
const original=[buy,sell];
const toSheet=rows=>rows.map(t=>[t.date,t.tradeType,t.acct,t.name,
 t.code,t.qty,t.price,t.assetType,t.memo,t.ratio||'',t.fractionalCash||'']);
function firstAffected(before,after){
 return g._earliestChangedTradeDate(toSheet(before),toSheet(after));
}
function recompute(trades,closePrice=140){
 const ctx=vm.createContext({
  rawTrades:structuredClone(trades),rawHoldings:[],EDITABLE_PRICES:[],
  STOCK_CODE:{},fundDirect:{},migrateLegacyTrades:()=>{},
  getEP:()=>({name:'SHADOW',assetType:'주식'}),
  getEPType:()=> '주식',
  getAccountId:()=> 'ISA',getAcctTaxType:()=> 'ISA',
  epPush:()=>{},Date,JSON,Number,String,Math,Object
 });
 vm.runInContext(['_portfolioTradeDateKey','syncHoldingsFromTrades',
   'calcRealizedPnl'].map(name=>extract(service,name)).join('\n'),ctx);
 ctx.syncHoldingsFromTrades({clearWhenEmpty:true});
 const holding=ctx.rawHoldings[0]||null;
 const pnl=ctx.calcRealizedPnl();
 const evalAmt=holding?holding.qty*closePrice:0;
 const cost=holding?.costAmt||0;
 return {qty:holding?.qty||0,cost,evalAmt,unrealized:evalAmt-cost,
  realized:pnl.totalPnl,realizedBasis:pnl.totalCost};
}
const old=recompute(original);
assert.deepEqual(old,{qty:6,cost:600,evalAmt:840,unrealized:240,
 realized:120,realizedBasis:400});
assert.equal(firstAffected(original,original),'',
 'identical full ledger must not need historical replay');
const increased=[{...buy,qty:12,price:110},sell];
const changed=recompute(increased);
assert.equal(firstAffected(original,increased),'2026-11-02',
 'changing old buy must rebuild from original date');
assert.deepEqual(changed,{qty:8,cost:880,evalAmt:1120,unrealized:240,
 realized:80,realizedBasis:440});
assert.equal(changed.evalAmt-changed.cost,changed.unrealized);
const moved=[{...buy,date:'2026-11-03'},sell];
assert.equal(firstAffected(original,moved),'2026-11-02',
 'move date must include both old and new dates in replay');
assert.deepEqual(recompute(moved),old);
const laterSale=[buy,{...sell,date:'2026-11-05'}];
assert.equal(firstAffected(original,laterSale),'2026-11-04',
 'moving sale into future preserves old impact date');
const removedSale=[buy];
assert.equal(firstAffected(original,removedSale),'2026-11-04',
 'partial delete must rebuild starting the deleted sale date');
assert.deepEqual(recompute(removedSale),{qty:10,cost:1000,
 evalAmt:1400,unrealized:400,realized:0,realizedBasis:0});
const extraSale=[buy,sell,{...sell,id:'tr_shadowsell02',date:'2026-11-05',qty:2}];
assert.equal(firstAffected(original,extraSale),'2026-11-05',
 'new sale must rebuild starting at its first impact');
assert.deepEqual(recompute(extraSale),{qty:4,cost:400,
 evalAmt:560,unrealized:160,realized:180,realizedBasis:600});
const reordered=[sell,buy];
assert.equal(firstAffected(original,reordered),'2026-11-02',
 'sequencing changes must not be skipped solely because row multiset is same');
const split={...buy,id:'tr_shadowsplit01',date:'2026-11-04',
 tradeType:'split',qty:10,price:0,ratio:2};
const sameDateBefore=[buy,split,sell];
const sameDateAfter=[buy,sell,split];
assert.equal(firstAffected(sameDateBefore,sameDateAfter),'2026-11-04',
 'same-date split/sale order changes require conservative replay');
const empty=recompute([]);
assert.deepEqual(empty,{qty:0,cost:0,evalAmt:0,unrealized:0,
 realized:0,realizedBasis:0});
const handler=extract(gas,'handleSyncTrades');
for(const guard of [
 '_earliestChangedTradeDate(previousRows, intendedRows)',
 '_setPendingTradeSnapshotRebuild(affectedFrom)',
 '_markTradeLedgerWriteUnverified_()',
 'rebuildDailySnapshots(affectedFrom, affectedTo',
 '_recordTradeLedgerFingerprint_(ss)',
 '_clearPendingTradeSnapshotRebuild()'
])assert(handler.includes(guard),'GAS_REBUILD_GUARD_MISSING_'+guard);
assert(handler.indexOf('_setPendingTradeSnapshotRebuild(affectedFrom)')<
 handler.indexOf('sh.clearContents()'),
 'durable pending replay checkpoint must precede ledger mutation');
assert(handler.includes([
 'if (affectedFrom || pendingSnapshotRebuild) {',
 '      _recordTradeLedgerFingerprint_(ss);',
 '      _clearPendingTradeSnapshotRebuild();'
 ].join('\\n')),
 'rebuild cannot clear pending checkpoint before recording its fingerprint');
console.log(JSON.stringify({kind:'ISSUE734_TRADE_RECALC_SHADOW_PASS',
 originalPnl:old.realized,editedPnl:changed.realized,
 earliestEditedBuy:firstAffected(original,increased),
 earliestDeletedSale:firstAffected(original,removedSale),
 exactDeployedGasVersion:'9.292',sourceLinked:true,
 historicalRebuildCheckpointProtected:true,
 scenarios:9,realFinancialWrites:0,remoteCalls:0}));
