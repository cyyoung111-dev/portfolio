import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CNN_FEAR_GREED_URL,readFearGreed,parseFearGreed,verifyFearGreed,formatFearGreed}
  from './briefing-fear-greed.mjs';
import {formatFullMorningBriefing,MORNING_SERIES,expectedMorningDate}
  from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';

const morning=new Date('2026-11-04T07:40:00+09:00');
const close=new Date('2026-11-04T17:00:00+09:00');
const sample={fear_and_greed:{score:23.4,rating:'extreme fear',
  timestamp:'2026-11-03T21:32:00+00:00',previous_close:25.2,
  previous_1_week:31.2}};
const valid=parseFearGreed(sample,{now:morning});
assert.equal(valid.score,23.4);
assert.equal(valid.rating,'extreme fear');
assert.equal(valid.observedAt,'2026-11-03T21:32:00.000Z');
assert.equal(valid.weekAgo,31.2);
assert.match(formatFearGreed(valid,{now:morning}),
  /CNN 미국주식 공포·탐욕: 23\.4\/100 \(극단적 공포\) · 1주 -7\.8p \[11\/04 06:32 KST\]/);
assert.match(formatFearGreed(valid,{now:close}),/23\.4\/100/);
for(const bad of [
  {fear_and_greed:{...sample.fear_and_greed,score:101}},
  {fear_and_greed:{...sample.fear_and_greed,score:'23.4'}},
  {fear_and_greed:{...sample.fear_and_greed,score:-1}},
  {fear_and_greed:{...sample.fear_and_greed,rating:'unverified'}},
  {fear_and_greed:{...sample.fear_and_greed,timestamp:'2026-11-04 01:00:00'}},
  {fear_and_greed:{...sample.fear_and_greed,timestamp:'2026-11-04T20:00:00Z'}},
  {fear_and_greed:{...sample.fear_and_greed,timestamp:'2026-10-18T00:00:00Z'}},
]){
  assert.equal(parseFearGreed(bad,{now:morning}),null);
}
assert.equal(verifyFearGreed({...valid,observedAt:'2026-10-01T00:00:00Z'},{now:close}),null);
assert.match(formatFearGreed(null,{now:morning}),/미확보/);
assert.match(formatFearGreed({...valid,score:NaN},{now:morning}),/미확보/);
let requested=0;
const fakeFetch=async(url,opts)=>{
  requested++;
  assert.equal(url,CNN_FEAR_GREED_URL);
  assert.equal(opts.redirect,'error');
  assert.match(opts.headers.referer,/cnn\.com\/markets\/fear-and-greed/);
  return {ok:true,headers:{get:()=>null},json:async()=>sample};
};
assert.deepEqual(await readFearGreed({fetchImpl:fakeFetch,now:()=>morning}),valid);
assert.equal(requested,1);
assert.equal(await readFearGreed({fetchImpl:async()=>({ok:false}),now:()=>morning}),null);
assert.equal(await readFearGreed({fetchImpl:async()=>{throw Error('CNN_UNAVAILABLE')},now:()=>morning}),null);
assert.equal(await readFearGreed({fetchImpl:async()=>({ok:true,json:async()=>({})}),now:()=>morning}),null);

const morningReport=formatFullMorningBriefing('2026-11-04',null,[],
  {now:morning,fearGreed:valid});
assert.match(morningReport,/CNN 미국주식 공포·탐욕: 23\.4\/100/);
assert.ok(morningReport.indexOf('CNN 미국주식')>morningReport.indexOf('■ 5. 환율'));
assert.ok(morningReport.indexOf('CNN 미국주식')<morningReport.indexOf('■ 6. 원자재'));
assert.ok(morningReport.length<=3900);
assert.match(formatFullMorningBriefing('2026-11-04',null,[],{now:morning,fearGreed:null}),/CNN 미국주식 공포·탐욕: 미확보/);
const closeReport=formatClose('2026-11-04',[],[],[],[],[],[],[],close,[],[],valid);
assert.match(closeReport,/CNN 미국주식 공포·탐욕: 23\.4\/100/);
assert.ok(closeReport.indexOf('CNN 미국주식')>closeReport.indexOf('■ 글로벌 참고 지표'));
assert.ok(closeReport.length<4000);
assert.match(formatClose('2026-11-04',[],[],[],[],[],[],[],close,[],[],null),/CNN 미국주식 공포·탐욕: 미확보/);

// Report-length contract: CNN is optional and may never break scheduled delivery.
const denseRows=MORNING_SERIES.map(item=>({
  label:item.label,symbol:item.symbol,
  date:expectedMorningDate(item.id,'2026-11-04',morning),
  value:item.id==='UST10Y'?4.2:25000.12,changePercent:0.12,
  source:'Yahoo Finance 일봉'
}));
const denseMorning=formatFullMorningBriefing('2026-11-04',null,denseRows,{now:morning,fearGreed:valid});
assert.ok(denseMorning.length<=3900);
assert.match(denseMorning,/CNN 미국주식 공포·탐욕: 23\\.4\\/100/,
  'all 21 morning series still need room for Fear & Greed');
for(const file of ['scripts/telegram-morning-briefing.mjs','scripts/telegram-close-workflow.mjs']){
 const source=fs.readFileSync(file,'utf8');
 assert.match(source,/readFearGreed\(/,file+' must fetch optional CNN source');
}
const closeSource=fs.readFileSync('scripts/telegram-close-workflow.mjs','utf8');
assert.match(closeSource,/reportInputs:\{[^\n]*fearGreed/);
assert.match(closeSource,/verifyFearGreed\(r\.fearGreed,\{now:now\(\)\}\)/,
  'SEND time must revalidate CNN provenance and age');
console.log('BRIEFING_CNN_FEAR_GREED_PASS source validation, KST, fallback, AM/PM, payload budget');
