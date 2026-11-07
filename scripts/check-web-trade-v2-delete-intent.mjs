// Confirmed trade delete IDs survive local dirty-journal rewrites/reload.
// No web request or financial sheet writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const views=fs.readFileSync('src/web/views/views_trades.js','utf8');
const extract=(src,name)=>{
 const i=src.indexOf('function '+name+'('),j=src.indexOf('\n}',i);
 assert(i>=0&&j>i,'missing function '+name);
 return src.slice(i,j+2);
};
const target='https://gas.example/v2';
const deleted={id:'tr_deleted01',date:'2026-11-06'};
const remaining={id:'tr_kept0001',date:'2026-11-07'};
let backups=0;
const ctx=vm.createContext({JSON,Array,Number,String,Set,Date,Math,
 _currentGsheetSyncTarget:()=>target,
 _portfolioRemoteSyncEpoch:0,
 _portfolioRemoteDirtyByTarget:{},
 rawTrades:[remaining],rawHoldings:[],fundDirect:{},
 _persistPortfolioRemoteDirtyMap:()=>{backups++}
});
vm.runInContext([
 extract(data,'_normalizePortfolioRemoteDirtyEntry'),
 extract(data,'_markPortfolioRemoteDirty')
].join('\n'),ctx);
ctx._markPortfolioRemoteDirty([deleted.id]);
assert.equal(ctx._portfolioRemoteDirtyByTarget[target].tradeV2DeleteIds[0],deleted.id);
ctx.rawTrades=[{...remaining,memo:'edited'}];
ctx._markPortfolioRemoteDirty();
const dirty=ctx._portfolioRemoteDirtyByTarget[target];
assert.deepEqual([...dirty.tradeV2DeleteIds],[deleted.id]);
const restored=ctx._normalizePortfolioRemoteDirtyEntry(JSON.parse(JSON.stringify(dirty)));
assert.deepEqual([...restored.tradeV2DeleteIds],[deleted.id]);
assert.ok(backups>=2,'delete intents must be persisted on each dirty journal update');
ctx.rawTrades=[remaining,deleted];
ctx._markPortfolioRemoteDirty();
assert.equal(ctx._portfolioRemoteDirtyByTarget[target].tradeV2DeleteIds.length,0,
 're-added ID cannot still be explicitly deleted');
const selected=vm.createContext({
 rawTrades:[deleted,remaining],
 document:{querySelectorAll:()=>[{dataset:{id:deleted.id}}]},
 confirm:()=>true,showToast:()=>{},
 _portfolioTradeDateKey:v=>v,
 _commitTrades:options=>{selected.options=options}
});
vm.runInContext(extract(views,'deleteSelectedTrades'),selected);
selected.deleteSelectedTrades();
assert.deepEqual([...selected.options.tradeV2DeleteIds],[deleted.id]);
assert.equal(selected.rawTrades.length,1);
assert.equal(selected.options.allowEmptyTradeSync,false);
console.log('WEB_V2_DURABLE_DELETE_INTENT_PASS '+JSON.stringify({
 localJournalRecoverable:true,onlyConfirmedIds:true,liveGASWrites:0}));
