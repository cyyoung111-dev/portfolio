import assert from 'node:assert/strict';
import {parseTreasuryFredCsv,verifyTreasuryCurve,readTreasuryCurve,formatTreasuryCurve}
 from './closing-us-treasury-curve.mjs';
import {formatClose,prepareClose,deliverClose} from './telegram-close-workflow.mjs';
import {CLOSE_SOURCE_CATALOG,summarizeCloseCoverage} from './briefing-source-coverage.mjs';
import {formatClosingExtra} from './closing-extra-daily-sources.mjs';
const date='2026-11-02',us='2026-10-30',clock=()=>new Date(date+'T17:00:00+09:00');
const samples={
 UST2Y:'observation_date,DGS2\n2026-10-29,4.21\n2026-10-30,4.20\n',
 UST3Y:'observation_date,DGS3\n2026-10-29,4.25\n2026-10-30,4.30\n',
 UST10Y_FRED:'observation_date,DGS10\n2026-10-29,4.55\n2026-10-30,4.60\n'
};
const ids=['UST2Y','UST3Y','UST10Y_FRED'];
const valid=ids.map(id=>parseTreasuryFredCsv(id,us,samples[id]));
assert.ok(valid.every(Boolean));
assert.equal(parseTreasuryFredCsv('UST2Y',us,samples.UST2Y+'2026-10-30,4.90,extra'),null);
assert.equal(parseTreasuryFredCsv('UST2Y',us,'observation_date,DGS2\n2026-10-30'),null);
assert.equal(summarizeCloseCoverage(date,{rates:valid,expectedUsDate:us}).statuses.find(x=>x.id==='UST10Y').status,'VERIFIED');
assert.equal(valid[0].value,4.2);
assert.equal(valid[1].source,'FRED_H15_DAILY');
assert.equal(parseTreasuryFredCsv('UST2Y',us,'observation_date,DGS2\n2026-10-29,4.21'),null);
assert.equal(parseTreasuryFredCsv('UST2Y',us,samples.UST2Y+'2026-10-30,4.19\n'),null,'duplicate exact dates');
assert.equal(parseTreasuryFredCsv('UST2Y',us,'date,DGS2\n2026-10-30,4.2\n'),null);
assert.equal(parseTreasuryFredCsv('UST2Y',us,'observation_date,DGS2\n2026-10-30,.\n'),null);
assert.equal(parseTreasuryFredCsv('UST2Y',us,'observation_date,DGS2\n2026-10-30,31\n'),null);
assert.equal(parseTreasuryFredCsv('UST2Y',us,'observation_date,DGS10\n2026-10-30,4.2\n'),null,'series mismatch');
assert.deepEqual(verifyTreasuryCurve(date,valid),valid);
assert.equal(verifyTreasuryCurve(date,[valid[0],valid[0]]).length,0);
assert.equal(verifyTreasuryCurve(date,valid.map(x=>({...x,date:'2026-10-29'}))).length,0);
assert.match(formatTreasuryCurve(date,valid),/미 국채 2년: 4.20% \[2026-10-30\]/);
assert.match(formatTreasuryCurve(date,valid),/미 국채 3년: 4.30% \[2026-10-30\]/);
assert.match(formatTreasuryCurve(date,valid),/미 국채 10년: 4.60% \[2026-10-30\]/);
assert.match(formatTreasuryCurve(date,valid),/10Y–2Y\): \+40bp \[2026-10-30\]/);
assert.match(formatTreasuryCurve(date,valid.slice(0,2)),/장단기금리차.*자료 미확보/);
let requests=[];
const fetched=await readTreasuryCurve(date,{fetchImpl:async(url,options)=>{
 requests.push({url,options});
 const query=new URL(url),id=query.searchParams.get('id');
 assert.equal(query.hostname,'fred.stlouisfed.org');
 assert.equal(query.pathname,'/graph/fredgraph.csv');
 assert.equal(query.searchParams.get('coed'),us);
 assert.equal(options.redirect,'error');
 return {ok:true,headers:{get:()=> 'text/csv'},text:async()=>samples[ids.find(x=>x==='UST10Y_FRED'&&id==='DGS10'||x==='UST2Y'&&id==='DGS2'||x==='UST3Y'&&id==='DGS3')]};
}});
assert.equal(requests.length,3);
assert.deepEqual(fetched,valid);
const failed=await readTreasuryCurve(date,{fetchImpl:async()=>({ok:false})});
assert.deepEqual(failed,[]);
const fredReasons=[];
assert.deepEqual(await readTreasuryCurve(date,{
 fetchImpl:async()=>({ok:false}),
 onDiagnostic:r=>fredReasons.push(r)
}),[]);
assert.deepEqual(fredReasons,ids.map(id=>({
 kind:'FRED_TREASURY_READ',id,status:'HTTP_UNAVAILABLE'
})));
const partial=await readTreasuryCurve(date,{fetchImpl:async url=>{
 const code=new URL(url).searchParams.get('id');
 return code==='DGS3'?{ok:false}:{ok:true,headers:{get:()=> 'text/csv'},
 text:async()=>code==='DGS2'?samples.UST2Y:samples.UST10Y_FRED};
}});
assert.equal(partial.length,2);
assert.match(formatTreasuryCurve(date,partial),/장단기금리차.*\+40bp/);
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('UST2Y'),false);
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('UST3Y'),false);
assert.equal(CLOSE_SOURCE_CATALOG.notConnected.includes('YIELD_SPREAD'),false);
const coverage=summarizeCloseCoverage(date,{rates:valid,expectedUsDate:us});
assert.equal(coverage.treasury.verified,3);
assert.equal(coverage.statuses.find(x=>x.id==='YIELD_SPREAD').status,'VERIFIED');
assert.equal(summarizeCloseCoverage(date,{expectedUsDate:us}).treasury.verified,0);
assert.doesNotMatch(formatClosingExtra(date,[],[],{omitUs10y:true}),/미 10년물:/);

const nh=[{label:'S&P 500',symbol:'^GSPC',date:us,source:'NH_INDEX_DAILY',value:7580.07,changePercent:-1.82}];
const withRates=formatClose(date,nh,[],[],[],[],[],[],clock(),valid);
assert.match(withRates,/미 국채 2년: 4.20%/);
assert.match(withRates,/장단기금리차.*\+40bp/);
assert.match(withRates,/국채금리·스프레드 3\/3/);
assert.ok(withRates.length<4000,'Telegram single-message limit');
let prepared=await prepareClose({now:clock,repository:'cyyoung111-dev/portfolio',githubToken:'dummy',
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:0,artifacts:[]})}),
 fetchNh:async()=>nh,fetchDomestic:async()=>[],fetchSecondary:async()=>[],
 fetchStocks:async()=>[],fetchMacros:async()=>[],fetchMarkets:async()=>[],
 fetchFutures:async()=>[],fetchRates:async()=>valid});
assert.equal(prepared.ready,true);
assert.equal(prepared.ratesCount,3);
assert.equal(prepared.reportInputs.rates.length,3);
let sent='';
await deliverClose(prepared,{now:()=>new Date(date+'T17:42:00+09:00'),
 send:async(_t,_c,message)=>{sent=message;}});
assert.match(sent,/장단기금리차.*\+40bp/);
await assert.rejects(deliverClose({...prepared,reportInputs:{...prepared.reportInputs,
 rates:[{...valid[0],date:'2026-10-29'}]}},{now:clock,send:async()=>assert.fail('unverified yield sent')}),
 /TELEGRAM_CLOSE_PAYLOAD_INVALID/);
console.log('TREASURY_CLOSE_PASS H15 2Y/3Y/10Y exact day, spread BP, 17:42 send, no stale');
