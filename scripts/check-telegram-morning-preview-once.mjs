import assert from 'node:assert/strict';
import {prepare,send,makeManualPreviewMessage} from './telegram-morning-preview-once.mjs';
import {AI_EVENT_WATCH,selectAiEventHighlights} from './briefing-ai-event-watch.mjs';
import {parseNasdaqDailyHistorical,readNasdaqDailyHistorical}
 from './briefing-nasdaq-daily-reference.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
const date='2026-11-12',usDate='2026-11-11';
const nasdaqPayload={data:{tradesTable:{rows:[
 {date:'11/11/2026',close:'$245.50'},
 {date:'11/10/2026',close:'$210.00'}
]}}};
const usNow=new Date('2026-11-12T11:20:00+09:00');
const nasdaq=parseNasdaqDailyHistorical('NBIS',usDate,nasdaqPayload,usNow);
assert.equal(nasdaq?.source,'NASDAQ_DAILY_REFERENCE');
assert.equal(nasdaq?.value,245.5);
assert.ok(nasdaq.changePercent>10);
assert.equal(parseNasdaqDailyHistorical('NBIS',usDate,
 {data:{tradesTable:{rows:[{date:'11/10/2026',close:'$225.50'}]}}},usNow),null);
assert.equal(parseNasdaqDailyHistorical('NBIS',usDate,nasdaqPayload,
 new Date('2026-11-11T12:00:00-05:00')),null);
const row=await readNasdaqDailyHistorical('NBIS',usDate,{
 now:usNow,fetchImpl:async url=>{
  assert.match(String(url),/api[.]nasdaq[.]com\/api\/quote\/NBIS\/historical/);
  return {ok:true,json:async()=>nasdaqPayload};
 }});
assert.equal(row?.value,245.5);
const picked=selectAiEventHighlights({expectedUsDate:usDate,prices:[{
 symbol:'NBIS',label:'네비우스',date:usDate,unit:'USD',...nasdaq
}]});
assert.equal(picked.length,1);
assert.equal(picked[0].source,'NASDAQ_DAILY_REFERENCE');

const now=()=>new Date(date+'T11:20:00+09:00');
const env={GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',GITHUB_REF:'refs/heads/main',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_RUN_ID:'99001',
 GITHUB_TOKEN:'TEST_GITHUB_TOKEN',TELEGRAM_PREVIEW_AUTHORIZED:'true',
 TELEGRAM_BOT_TOKEN:'DUMMY',TELEGRAM_CHAT_ID:'123456'};
const files=new Map();
const fakeFetch=async url=>{
 assert.match(url,/\/actions\/artifacts\?name=telegram-morning-ai-preview-claim-2026-11-12/);
 return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
};
const fetchDaily=async (label,symbol)=>({
 label,symbol,date:usDate,value:120,
 changePercent:symbol==='MU'?11:symbol==='CRWV'?12:1,
 source:'Yahoo Finance 일봉'
});
const rows=[
 {label:'S&P 500',symbol:'^GSPC',date:usDate,value:7600,changePercent:1},
 {label:'NASDAQ100',symbol:'^NDX',date:usDate,value:28000,changePercent:2,
  source:'NH_INDEX_DAILY'},
 {label:'SOX',symbol:'^SOX',date:usDate,value:10000,changePercent:4},
 {label:'VIX',symbol:'^VIX',date:usDate,value:18,changePercent:-2}
];
const fakeCore=async options=>{
 const body=formatFullMorningBriefing(date,null,rows,{
  now:now(),watchEvidence:options.watchEvidence});
 await options.send(null,null,body);
 return {status:'CAPTURED_ONLY'};
};
const prepared=await prepare({now,env,fetchImpl:fakeFetch,fetchDaily,readCapture:async()=>null,
 collectCore:fakeCore,mkdir:()=>{},
 writeFile:(path,value)=>{assert.ok(!files.has(path));files.set(path,value);}});
assert.equal(prepared.ready,true);
assert.equal(prepared.verifiedAi,38);
assert.equal(prepared.totalAi,38);
assert.equal(prepared.highlighted,2);
const message=files.get('.telegram-runtime/manual-preview-message.txt');
assert.match(message,/^\[수동 검증 테스트 · 2026-11-12/);
assert.match(message,/AI 밸류체인 주요 변동/);
assert.match(message,/코어위브/);
assert.match(message,/마이크론/);
assert.match(message,/AI 추적 확인: 38\/38개사/);
assert.match(message,/11:20 KST/);
assert.ok(message.length<=4096);
let dispatched='';
const proof=await send({now,env,readFile:path=>files.get(path),
 writeFile:(path,value)=>{files.set(path,value);},
 sendMessage:async(_t,_c,value)=>{dispatched=value;}});
assert.equal(dispatched,message);
assert.equal(proof.status,'SENT');
assert.equal(proof.verifiedAi,38);
assert.equal(proof.kind,'AI_MANUAL_PREVIEW');
const duplicate=await prepare({now,env,fetchImpl:async()=>({ok:true,
 json:async()=>({total_count:1,artifacts:[{name:'telegram-morning-ai-preview-claim-'+date}]})}),
 fetchDaily:async()=>{throw Error('must not query prices on duplicate');}});
assert.equal(duplicate.ready,false);
assert.equal(duplicate.status,'ALREADY_PREVIEW_CLAIMED');
await assert.rejects(()=>prepare({now,env:{...env,GITHUB_REF:'refs/heads/feature'},
 fetchImpl:fakeFetch}),/AUTH_OR_WINDOW_DENIED/);
await assert.rejects(()=>prepare({now:()=>new Date(date+'T12:05:00+09:00'),env,
 fetchImpl:fakeFetch}),/AUTH_OR_WINDOW_DENIED/);
await assert.rejects(()=>prepare({now,env,fetchImpl:fakeFetch,
 fetchDaily:async()=>null}),/AI_COVERAGE_INSUFFICIENT/);
assert.throws(()=>makeManualPreviewMessage(date,'fake',null,now()),
 /CORE_BODY_INVALID/);
console.log('38-company real-data manual preview separate claim/send test: PASS');
