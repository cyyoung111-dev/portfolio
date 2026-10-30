import assert from 'node:assert/strict';
import {inspectClosingDomesticReadback,runIntegratedReadback}
 from './domestic-eod-integration-readback-20261030.mjs';
const day='2026-10-30';
const date='2026-10-30T09:03:00.000Z';
const types=['KOSPI','KOSDAQ','KOSPI200'],values=[5730.74,724.38,899.78];
const rows=types.map((type,i)=>({
 type,label:type==='KOSPI200'?'KOSPI 200':type,date:day,
 value:values[i],source:'YAHOO_SHINHAN_CROSSCHECKED_EOD',
 priceType:'INDEPENDENT_CROSSCHECKED_EOD',role:'NON_NH_DAILY_INDEX',
 comparisonSource:'SHINHAN_PUBLIC_INDEX',comparisonPublishedAt:date,
 changePercent:null
}));
const result=inspectClosingDomesticReadback(rows);
assert.equal(result.acceptedDomesticCount,3);
assert.equal(result.allThreeMatch,true);
assert.equal(result.allThreeIndependentlyCrosschecked,true);
assert.equal(result.telegramSent,false);
assert.equal(result.nhTokenRequested,false);
assert.equal(result.writesPerformed,0);
assert.ok(!JSON.stringify(result).includes('GAS_ACCESS_TOKEN'));
const mismatch=inspectClosingDomesticReadback(rows.map((r,i)=>i===0?{...r,value:5668.26}:r));
assert.equal(mismatch.allThreeMatch,false);
assert.equal(mismatch.allThreeIndependentlyCrosschecked,true);
assert.equal(inspectClosingDomesticReadback(rows.slice(0,2)).acceptedDomesticCount,2);
assert.equal(inspectClosingDomesticReadback([...rows,rows[0]]).acceptedDomesticCount,2);
const spoof=inspectClosingDomesticReadback(rows.map((r,i)=>i===1?{...r,source:'KRX_OFFICIAL'}:r));
assert.equal(spoof.acceptedDomesticCount,2);
assert.equal(spoof.allThreeIndependentlyCrosschecked,false);
const now=()=>new Date('2026-10-30T18:12:00+09:00');
const before=await runIntegratedReadback({now:()=>new Date('2026-10-30T15:59:00+09:00'),
 fetchDomestic:async()=>{throw Error('must not fetch preclose');}});
assert.equal(before.status,'DOMESTIC_EOD_DIAGNOSTIC_WINDOW_CLOSED');
const future=await runIntegratedReadback({now:()=>new Date('2026-11-02T18:00:00+09:00'),
 fetchDomestic:async()=>{throw Error('must not refetch after target date');}});
assert.equal(future.status,'DOMESTIC_EOD_DIAGNOSTIC_WINDOW_CLOSED');
const previousUrl=process.env.GAS_WEB_APP_URL,previousToken=process.env.GAS_ACCESS_TOKEN;
try{
 process.env.GAS_WEB_APP_URL='https://script.google.com/macros/s/TEST/exec';
 process.env.GAS_ACCESS_TOKEN='never-output-this-token';
 let count=0;
 const live=await runIntegratedReadback({now,fetchDomestic:async(_date,args)=>{
  count++;assert.equal(_date,day);assert.equal(args.now,now);return rows;
 }});
 assert.equal(count,1);
 assert.equal(live.allThreeMatch,true);
 assert.ok(!JSON.stringify(live).includes('never-output-this-token'));
}finally{
 if(previousUrl===undefined)delete process.env.GAS_WEB_APP_URL;
 else process.env.GAS_WEB_APP_URL=previousUrl;
 if(previousToken===undefined)delete process.env.GAS_ACCESS_TOKEN;
 else process.env.GAS_ACCESS_TOKEN=previousToken;
}
console.log('Domestic EOD live closing integration: 3/3 crosschecked and no writes/Telegram PASS');
