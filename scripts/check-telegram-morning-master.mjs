import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {verifiedMorningMaster,loadMorningMaster,mergeMorningSourceRows} from './telegram-morning-master.mjs';
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
console.log('Morning GAS protected read and exact-day index fallback provenance PASS');
