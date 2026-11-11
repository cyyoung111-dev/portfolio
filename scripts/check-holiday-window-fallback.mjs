import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
const inner=source.match(/async function _fetchFromGsheetInner\(dateStr, options\) \{[\s\S]*?\n\}/)?.[0];
const wrapper=source.match(/async function fetchFromGsheet\(dateStr, options\) \{[\s\S]*?\n\}/)?.[0];
const target=source.match(/function _isCurrentPriceTarget\(item\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(inner&&wrapper&&target,'production functions available');
assert.doesNotMatch(source,/for \(let d = 1; d <= 5; d\+\+\)/,'no sequential 5-day loop');
assert.equal((source.match(/fetchFromGsheet\(getDateStr\(1\), \{ historyWindowStart: getDateStr\(5\) \}\)/g)||[]).length,2);
assert.ok(source.includes("+'|h='")||source.includes("+ '|h='"),'window must change request identity');
for(const stage of ['load.full-restore','load.full-prices','load.full-render','load.full-update']) assert.ok(source.includes(stage));
const prices={
 '005930':[{date:'2026-11-07',price:100},{date:'2026-11-10',price:130}],
 '000660':[{date:'2026-11-06',price:80},{date:'2026-11-11',price:999}],
 '123456':[{date:'2026-11-03',price:60}],
 'Fund':[{date:'2026-11-08',price:25},{date:'2026-11-11',price:999}]
};
async function load(opts){
 const calls=[];
 const stocks=[{name:'Samsung',code:'005930'},{name:'SK',code:'000660'},{name:'Old',code:'123456'}];
 const ctx=vm.createContext({
  GSHEET_API_URL:'https://example.test/gas',window:{},console:{warn(){},info(){}},
  getGsheetConnectionGeneration:()=>4,isGsheetConnectionCurrent:(_u,g)=>g===4,
  normName:s=>s,normalizeStockCode:s=>s,STOCK_CODE:Object.fromEntries(stocks.map(s=>[s.name,s.code])),
  _gsheetCodeList:[],EDITABLE_PRICES:[...stocks,{name:'Fund',code:''}],
  rawHoldings:stocks.map(s=>({...s,qty:1})),fundDirect:{Fund:{cost:100}},
  getEPWithCode:()=>stocks,getDateStr:()=> '2026-11-11',_kstDateOffset:()=> '2026-08-10',
  requestGsheetActionJson:async(action,params)=>{
   calls.push({action,...params});assert.equal(action,'getPriceHistory');
   const out={};for(const code of params.codes.split(',')){
    out[code]=(prices[code]||[]).filter(e=>e.date>=params.from&&e.date<=params.to);
   }
   return {status:'ok',prices:out};
  }
 });
 vm.runInContext(target+'\n'+wrapper+'\n'+inner,ctx);
 const result=await vm.runInContext(
   "_fetchFromGsheetInner('2026-11-10',"+JSON.stringify({...opts,targetUrl:'https://example.test/gas',generation:4})+")",ctx);
 return {result,calls,ctx};
}
const period=await load({historyWindowStart:'2026-11-06'});
const st=period.calls.find(x=>x.codes==='005930,000660,123456');
assert.ok(st);assert.equal(st.from,'2026-11-06');assert.equal(st.to,'2026-11-10');
assert.equal(period.calls.filter(x=>x.codes==='005930,000660,123456').length,1);
assert.equal(period.result['005930'],130);
assert.equal(period.result['000660'],80);
assert.equal(period.result['123456'],undefined);
assert.equal(period.result.Fund,25,'independent fund NAV query');
assert.equal(period.result.__gsheetPriceMeta['000660'].sourceDate,'2026-11-06');
assert.equal(period.result.__gsheetPriceMeta['000660'].isFallback,true);
assert.equal(period.result.__gsheetResolvedPriceDate,'2026-11-10');
assert.equal(period.ctx.window._gsheetMissingCodes.length,1);
assert.equal(period.ctx.window._gsheetMissingCodes[0].code,'123456');
const exact=await load({});
assert.equal(exact.calls.find(x=>x.codes==='005930,000660,123456').from,'2026-11-10');
assert.equal(exact.result['005930'],130);
assert.equal(exact.result['000660'],undefined);
assert.equal(exact.result.__gsheetPriceMeta['005930'].sourceDate,undefined);
const invalid=await load({historyWindowStart:'2099-01-01'});
assert.equal(invalid.calls.find(x=>x.codes==='005930,000660,123456').from,'2026-11-10');
console.log('PASS: one bounded holiday lookup, exact historical date preserved, dated per-stock fallback, no stale/future carry');