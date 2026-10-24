import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('src/gas/apps_script.gs','utf8');
function fn(n){let a=src.indexOf('function '+n+'('),b=src.indexOf('\n}',a);assert.ok(a>=0&&b>a);return src.slice(a,b+2);}
const values=new Map(),props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v)};
let date='2026-10-19',result={attempted:false,deferred:true,reason:'BACKFILL_BUSY'};
const ctx=vm.createContext({
  Date:{now:()=>Date.now()},today:()=>date,
  PropertiesService:{getScriptProperties:()=>props},
  _portfolioFundAtomic_:callback=>callback(props),
  _runPendingKrxBackfillWithLease_:(p,d,fromClose,hist)=>{
    assert.equal(p,props);assert.equal(d,date);assert.equal(fromClose,false);assert.equal(hist,true);
    return typeof result==='function'?result():result;
  }
});
for(const n of ['_runHistoricalBackfillWithCheckpoint_','runPortfolioHistoricalBackfill2240',
  'runPortfolioHistoricalBackfill0010'])vm.runInContext(fn(n),ctx);
const read=k=>JSON.parse(props.getProperty('portfolio_close_historical_'+k+'_checkpoint_v1'));
ctx.runPortfolioHistoricalBackfill2240();assert.equal(read('2310').state,'DEFERRED');
assert.equal(read('2310').reason,'BACKFILL_BUSY');assert.equal(read('0030'),null);
result={attempted:true,ok:true,date:'2026-10-16',remaining:2};
ctx.runPortfolioHistoricalBackfill0010();assert.equal(read('0030').state,'SUCCEEDED');
assert.equal(read('2310').state,'DEFERRED');assert.equal(read('0030').ok,true);
result={attempted:false,remaining:0};
ctx.runPortfolioHistoricalBackfill2240();assert.equal(read('2310').state,'NO_WORK');
result=()=>{throw new Error('PRIVATE_ACCOUNT')};
assert.throws(()=>ctx.runPortfolioHistoricalBackfill0010(),/PRIVATE_ACCOUNT/);
assert.equal(read('0030').state,'FAILED');
assert.equal(read('0030').reason,'EXCEPTION');
assert.doesNotMatch(JSON.stringify([...values.values()]),/PRIVATE_ACCOUNT/);
assert.match(src,/state:'RUNNING'/);
assert.match(src,/historical2310Checkpoint: parseProperty/);
assert.match(src,/historical0030Checkpoint: parseProperty/);
console.log('GAS historical slot independent checkpoints VM regression PASS');
