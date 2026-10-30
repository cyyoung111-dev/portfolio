import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {verifyNhIndexResponse} from './nh-index-primary-readback.mjs';
const s=fs.readFileSync('src/gas/apps_script.gs','utf8');
const code=s.slice(s.indexOf('// Proven NH index codes from GAS probe'));
assert.ok(code.length>1000);
const calls=[],cache=new Map(),fallbacks=[];
const ctx={_nhCredentials_:()=>({key:'k',secret:'s'}),
 _foreignMarketRegularCloseCutoff_:()=> '2026-10-29',
 _nhCloseDate_:d=>String(d||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),
 _nhPost_:(path,input)=>{
   calls.push({path,input});
   return {Output_0:{iem_cd:input.iem_cd,iem_nm:'S&P500'},
     Output_1:[{bsop_date:'20261022',ovrs_prpr:'7600.12'},{bsop_date:'20261029',ovrs_prpr:'7720.39'}]};
 },
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
 fetchYahooIndexSeries:(type)=>{fallbacks.push(type);return {symbol:'^GSPC',points:[{date:'2026-10-29',value:7700}]};},
 Logger:{log:()=>{}}
};
vm.createContext(ctx);vm.runInContext(code,ctx);
const ok=ctx.fetchIndexPrimarySeries('SP500','2026-10-22','2026-10-29');
assert.equal(ok.source,'NH_INDEX_DAILY');assert.equal(ok.points.at(-1).value,7720.39);
assert.equal(ok.points.at(-1).sourceDate,'2026-10-29');assert.equal(ok.current.source,'NH_INDEX_DAILY');
assert.equal(calls[0].path,'/gbstock/quote/v1/symbolIndexFxPeriod');
assert.equal(calls[0].input.gubun,'1');assert.equal(calls[0].input.xtick,'001');assert.equal(calls[0].input.array_cnt,'0400');
assert.equal(fallbacks.length,0);
ctx._nhPost_=()=>({Output_0:{iem_cd:'WRONG',iem_nm:'S&P500'},Output_1:[]});
const miss=ctx.fetchIndexPrimarySeries('SP500','2026-10-21','2026-10-29');
assert.equal(miss.source,'YAHOO_FINANCE');assert.equal(miss.points[0].source,'YAHOO_UNVERIFIED_DAILY');
const reject=verifyNhIndexResponse({status:'ok',series:{SP500:[{date:'2026-10-29',value:7720.39,source:'YAHOO_FINANCE'}]},seriesMeta:{SP500:{source:'YAHOO_FINANCE'}}});
assert.equal(reject.confirmed,0);
const good=verifyNhIndexResponse({status:'ok',series:Object.fromEntries([['SP500','SPX',7720.39],['NASDAQ','COMP',26184.72],['NASDAQ100','NDX',29402.51]].map(([type,code,price])=>[type,[{date:'2026-10-29',value:price,source:'NH_INDEX_DAILY'}]])),seriesMeta:{SP500:{source:'NH_INDEX_DAILY',providerCode:'SPX'},NASDAQ:{source:'NH_INDEX_DAILY',providerCode:'COMP'},NASDAQ100:{source:'NH_INDEX_DAILY',providerCode:'NDX'}}});
assert.equal(good.confirmed,3);
assert.match(s,/benchmarks_v9281_/);
console.log('NH verified US indexes: production series date, identity, source and fallback PASS');
