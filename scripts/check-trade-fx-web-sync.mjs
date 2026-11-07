import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const load=fs.readFileSync('src/web/features/settings/settings.js','utf8');
const legacy=fs.readFileSync('src/web/features/settings/settings_legacy_recovery.js','utf8');
const extract=(text,name)=>{
 const at=text.indexOf('function '+name+'(');
 assert.ok(at>=0,'missing production function '+name);
 const asyncPrefix=text.slice(Math.max(0,at-6),at)==='async ';
 const tail=text.slice(asyncPrefix?at-6:at),end=tail.indexOf('\n}');
 assert.ok(end>=0,'unclosed function '+name);
 return tail.slice(0,end+2);
};
const funcs=[
 extract(sync,'_normalizeSyncCode'),
 extract(sync,'_hasTradeFxMetadataProtocol'),
 extract(sync,'syncTradesToGsheet'),
 'globalThis.save=syncTradesToGsheet;'
].join('\n');
const sourceTrade={
 id:99,date:'2026-10-30',tradeType:'buy',acct:'해외계좌',
 name:'해외주식',code:'AAPL',qty:4,price:209925,
 assetType:'주식',memo:'실제 FX 입력',priceRaw:155.5,fxRateAtBuy:1350,
 ratio:0,fractionalCash:0
};
const split={
 date:'2026-10-31',tradeType:'reverse_split',acct:'해외계좌',
 name:'해외주식',code:'AAPL',qty:4,price:0,assetType:'주식',
 ratio:10,fractionalCash:25.5
};
async function execute(supported,serverReply,rows=[sourceTrade,split]){
 const requests=[],toasts=[];
 const ctx={
  window:{_tradeFxMetadataTargets:{'https://gas.sample/':supported}},
  GSHEET_API_URL:'https://gas.sample/',rawTrades:structuredClone(rows),
  getGsheetConnectionGeneration:()=>7,
  isGsheetPortfolioWriteReady:()=>true,
  STOCK_CODE:{'해외주식':'AAPL'},
  getEPByCode:()=>({name:'해외주식',code:'AAPL',assetType:'주식'}),
  getEP:()=>({name:'해외주식',code:'AAPL',assetType:'주식'}),
  getEPType:(item,fallback)=>item?.assetType||fallback,
  normalizeStockCode:code=>String(code||''),
  isCodeLessDirectFundTrade:()=>false,
  showToast:(...args)=>{toasts.push(args)},
  _syncWarn:()=>{},
  requestGsheetFormJson:async(action,params)=>{requests.push({action,params});return serverReply},
  _hasPortfolioReceiptProtocol:()=>false,
  _requestPortfolioRecoveryWrite:async()=>{throw Error('unexpected')},
  syncIssuesToGsheet:async()=>null,
 };
 vm.createContext(ctx);
 vm.runInContext(funcs,ctx);
 const response=await ctx.save({targetUrl:'https://gas.sample/'});
 return {requests,toasts,response};
}
const good=await execute(true,{
 status:'ok',synced:2,saveState:'success',tradeFxMetadataVersion:1
});
assert.equal(good.response.status,'ok');
assert.equal(good.requests.length,1);
const sent=JSON.parse(good.requests[0].params.data);
assert.equal(sent[0].priceRaw,155.5);
assert.equal(sent[0].fxRateAtBuy,1350);
assert.equal(sent[0].price,209925);
assert.equal(sent[1].ratio,10,'corporate action split ratio must survive transport');
assert.equal(sent[1].fractionalCash,25.5,'fractional cash must survive transport');
const blocked=await execute(false,{status:'ok'});
assert.equal(blocked.requests.length,0,'legacy GAS must never accept FX-bearing ledger');
assert.equal(blocked.response.errorCode,'TRADE_FX_METADATA_UNSUPPORTED');
assert.equal(blocked.response.saveState,'failed');
const missingAck=await execute(true,{status:'ok',synced:2,saveState:'success'});
assert.equal(missingAck.response.errorCode,'TRADE_FX_METADATA_ACK_MISSING');
assert.equal(missingAck.response.saveState,'partial');
assert.equal(missingAck.requests.length,1);
const domestic=await execute(false,{status:'ok',synced:1,saveState:'success'},[
 {...sourceTrade,name:'국내종목',code:'005930',price:100,
  priceRaw:undefined,fxRateAtBuy:undefined}
]);
assert.equal(domestic.requests.length,1,'legacy 11-column GAS can still write KRW-only trades');
assert.equal(domestic.response.status,'ok');
const actual=extract(legacy,'_legacyTradeTuple');
const account=new Map([['A','해외계좌']]);
const legacyCtx=vm.createContext({Map});
vm.runInContext(actual+'\nglobalThis.tuple=_legacyTradeTuple;',legacyCtx);
const fxTuple=legacyCtx.tuple(sourceTrade,account);
assert.ok(Array.isArray(fxTuple));
assert.deepEqual([...fxTuple.slice(-2)],[155.5,1350]);
assert.equal(legacyCtx.tuple({...sourceTrade,fxRateAtBuy:undefined},account),null);
assert.equal(legacyCtx.tuple({...sourceTrade,fxRateAtBuy:1351},account),null);
const oldTuple=legacyCtx.tuple({...sourceTrade,priceRaw:undefined,fxRateAtBuy:undefined},account);
assert.deepEqual([...oldTuple.slice(-2)],[0,0]);
assert.notDeepEqual([...fxTuple],[...oldTuple],
 'a legacy 11-col server row cannot prove the FX source for a dirty local trade');
assert.match(load, /_tradeFxMetadataTargets[\s\S]*data\.tradeFxMetadataVersion === 1/);
console.log('TRADE_FX_WEB_ROUNDTRIP_PASS live sync serializer 2/2 extra fields, old GAS denied, ACK required, legacy compare');
