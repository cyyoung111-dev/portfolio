import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {verifiedMorningMaster,loadMorningMaster,mergeMorningSourceRows} from './telegram-morning-master.mjs';
import {readNhStoredMorningStocks,normalizeNhStoredStockCloses} from './nh-morning-stock-history.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
const date='2026-10-30';
const row={seriesId:'KOSPI',value:4100,tradingDate:'2026-10-29',sourceDate:'2026-10-29',
 source:'KRX_OFFICIAL',status:'FINAL',finality:'REGULAR_CLOSE',session:'REGULAR',
 receivedAt:'2026-10-29T16:30:00+09:00'};
assert.equal(verifiedMorningMaster(date,[row]).length,1);
assert.equal(verifiedMorningMaster(date,[{...row,source:'YAHOO'}]).length,0,
 'unverified domestic source must not be shown as official');
assert.equal(verifiedMorningMaster(date,[{...row,receivedAt:'2026-10-30T08:01:00+09:00'}]).length,0,
 'lookahead receipt must be rejected');
assert.equal(verifiedMorningMaster(date,[{...row,sourceDate:date}]).length,0,
 'same-day incomplete domestic close must be rejected');
assert.equal(verifiedMorningMaster(date,[{...row,status:'PARTIAL'}]).length,0);
const yahoo=[{label:'KOSPI',symbol:'^KS11',value:4050,date:'2026-10-29',source:'Yahoo Finance 일봉'}];
const master=verifiedMorningMaster(date,[row]);
assert.equal(mergeMorningSourceRows(yahoo,master)[0].value,4100,'KRX official source wins equal-date Yahoo');
assert.equal(mergeMorningSourceRows([{...yahoo[0],date:'2026-10-30'}],master)[0].value,4050,
 'older official source may not mask newer dated input');
let reads=0;
const fetchImpl=async(url,{body})=>{reads++;assert.equal(new URL(url).hostname,'script.google.com');assert.equal(body.get('action'),'getMarketBriefingMaster');
 assert.equal(body.get('accessToken'),'test-secret');return {ok:true,json:async()=>({status:'ok',observations:[row]})};};
const loaded=await loadMorningMaster(date,{url:'https://script.google.com/macros/s/example/exec',token:'test-secret',fetchImpl});
assert.equal(loaded.length,1);assert.equal(reads,1);
assert.deepEqual(await loadMorningMaster(date,{url:'http://example.com',token:'test-secret',fetchImpl}),[]);
assert.deepEqual(await loadMorningMaster(date,{url:'https://evil.example.com',token:'test-secret',fetchImpl}),[]);
assert.deepEqual(await loadMorningMaster(date,{url:'https://script.google.com/macros/s/example/exec',token:'test-secret',fetchImpl:async()=>{throw Error('PRIVATE') }}),[]);
const wf=YAML.parse(fs.readFileSync('.github/workflows/telegram-morning-briefing.yml','utf8'));
assert.equal(wf.jobs.briefing.environment,'portfolio-production-gas',
 'GAS reads must use the existing protected production environment');
const prepare=wf.jobs.briefing.steps.find(x=>x.id==='prepare');
assert.match(prepare.env.GAS_ACCESS_TOKEN,/^[$][{][{] secrets[.]GAS_ACCESS_TOKEN [}][}]$/);
assert.match(prepare.env.GAS_WEB_APP_URL,/^[$][{][{] vars[.]GAS_WEB_APP_URL [}][}]$/);
assert.equal(wf.jobs.briefing.steps.find(x=>x.name==='Send claimed briefing once').env.GAS_ACCESS_TOKEN,undefined);
const knownDaily=[
 {label:'SOX',symbol:'^SOX',date:'2026-10-29',value:9000,changePercent:1.3,source:'Yahoo Finance 일봉'},
 {label:'VIX',symbol:'^VIX',date:'2026-10-29',value:16.5,changePercent:-1.1,source:'Yahoo Finance 일봉'}
];
const datedMaster=verifiedMorningMaster(date,[
 {...row,seriesId:'SOX',value:9000,source:'NH_INDEX_DAILY'},
 {...row,seriesId:'VIX',value:16.5,source:'NH_INDEX_DAILY'}
]);
const mergedIndicators=mergeMorningSourceRows(knownDaily,datedMaster);
assert.deepEqual(mergedIndicators.map(x=>x.changePercent),[1.3,-1.1],
 'keep same-date Yahoo values and changes together when master lacks prior daily close');
assert.ok(mergedIndicators.every(x=>x.source==='Yahoo Finance 일봉'),
 'source must match the chosen percentage and price');
// Existing GAS getPriceHistory: only exact-date NH_REGULAR_CLOSE is primary.
// No NH OAuth request, financial writes, or unverified carry-forward.
const stored={status:'ok',prices:{
 '005930':[{date:'2026-10-28',price:100,source:'NH_REGULAR_CLOSE'},
   {date:'2026-10-29',price:110,source:'NH_REGULAR_CLOSE'}],
 '000660':[{date:'2026-10-29',price:300,source:'NH_REGULAR_CLOSE'}],
 'NVDA':[{date:'2026-10-28',price:195,source:'NH_REGULAR_CLOSE'},
   {date:'2026-10-29',price:200,source:'NH_REGULAR_CLOSE'}],
 'MU':[{date:'2026-10-29',price:125,source:'NH_REGULAR_CLOSE'}]
}};
const nhStock=normalizeNhStoredStockCloses(date,stored);
assert.equal(nhStock.length,4);
assert.deepEqual(nhStock.map(r=>r.symbol),['005930.KS','000660.KS','NVDA','MU']);
assert.ok(nhStock.every(r=>r.date==='2026-10-29'&&r.source==='NH_REGULAR_CLOSE'));
assert.ok(Math.abs(nhStock[0].changePercent-10)<0.00001);
assert.equal(nhStock[1].changePercent,null,'no invented percent without NH prior close');
const yStock=[{label:'삼성전자',symbol:'005930.KS',date:'2026-10-29',value:999,
 changePercent:9,source:'Yahoo Finance 일봉'}];
const nhFirst=mergeMorningSourceRows(yStock,[],[],[],nhStock);
assert.equal(nhFirst.find(x=>x.symbol==='005930.KS').value,110);
assert.match(formatFullMorningBriefing(date,null,nhFirst),/삼성전자: 110 .*NH PLUG 확정 종가\\(저장 이력\\)/);
const rejected=structuredClone(stored);
rejected.prices.NVDA[1].source='Yahoo Finance 일봉';
rejected.prices.MU[0].date='2026-10-28';
rejected.prices['000660'].push({...rejected.prices['000660'][0]});
assert.deepEqual(normalizeNhStoredStockCloses(date,rejected).map(x=>x.symbol),['005930.KS']);
let stockReads=0;
const acceptedStock=await readNhStoredMorningStocks(date,{
 url:'https://script.google.com/macros/s/example/exec',token:'PRIVATE_GAS_TOKEN',
 fetchImpl:async(url,{method,body})=>{
   stockReads++;
   assert.equal(new URL(url).hostname,'script.google.com');
   assert.equal(method,'POST');
   assert.equal(body.get('action'),'getPriceHistory');
   assert.equal(body.get('codes'),'005930,000660,NVDA,MU');
   assert.equal(body.get('to'),'2026-10-29');
   assert.equal(body.get('accessToken'),'PRIVATE_GAS_TOKEN');
   assert.equal(body.has('NHPLUG_APP_KEY'),false);
   return {ok:true,json:async()=>stored};
 }
});
assert.equal(stockReads,1);
assert.equal(acceptedStock.length,4);
assert.deepEqual(await readNhStoredMorningStocks(date,{
 url:'https://malicious.example.com/exec',token:'PRIVATE_GAS_TOKEN',
 fetchImpl:async()=>assert.fail('no unauthorized endpoint') }),[]);
assert.deepEqual(await readNhStoredMorningStocks(date,{
 url:'https://script.google.com/macros/s/example/exec',token:'PRIVATE_GAS_TOKEN',
 fetchImpl:async()=>({ok:false}) }),[]);
console.log('Morning GAS protected read and exact-day index fallback provenance PASS');
