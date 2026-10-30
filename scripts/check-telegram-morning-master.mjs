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
assert.equal(wf.jobs.briefing.environment,undefined,
 'the recurring Telegram workflow must not bypass existing GAS environment permissions');
const prepare=wf.jobs.briefing.steps.find(x=>x.id==='prepare');
assert.equal(prepare.env.GAS_ACCESS_TOKEN,undefined);
assert.equal(prepare.env.GAS_WEB_APP_URL,undefined);
console.log('Morning read-only GAS MARKET_MASTER timestamp/source/provider guards PASS');
