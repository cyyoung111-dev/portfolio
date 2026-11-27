import assert from 'node:assert/strict';
import {MORNING_SERIES,expectedMorningDate,formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {inspectMorningMessage} from './telegram-morning-source-coverage.mjs';
import {prepareMorning} from './telegram-morning-workflow.mjs';
import {fillMissingMorningVix} from './telegram-morning-briefing.mjs';
import {readCboeVixReference} from './closing-secondary-index-sources.mjs';

const date='2026-11-02',now=()=>new Date('2026-11-02T07:45:00+09:00');
const rows=MORNING_SERIES.map((item,i)=>({
 label:item.label,symbol:item.symbol,date:expectedMorningDate(item.id,date,now()),
 value:item.id==='UST10Y'?4.92:1000+i+0.75,
 changePercent:0.2,source:'Yahoo Finance 일봉'
}));
const message=formatFullMorningBriefing(date,null,rows,{now:now()});
const coverage=inspectMorningMessage(date,message,{now:now()});
assert.equal(coverage.verified,21);
assert.equal(coverage.total,21);
assert.equal(coverage.status,'MATCHED_FORMATTED_QC');
assert.deepEqual(coverage.missing,[]);
assert.deepEqual(coverage.sourceCounts,{YAHOO_DAILY_REFERENCE:21});
assert.equal(coverage.nhNightReference,'NOT_VERIFIED');
assert.equal(coverage.observedInActualPrepare,true);
assert.ok(!JSON.stringify(coverage).includes('1000.75'),'no market prices in logs');
assert.ok(!('message' in coverage),'not printing Telegram body');
// Thanksgiving Friday uses the prior completed Wednesday US close. Require both
// exact dates, a unique CSV row and a source-specific VIX marker in the QC.
const holiday='2026-11-27',holidayNow=new Date(holiday+'T07:40:00+09:00');
const csv='DATE,OPEN,HIGH,LOW,CLOSE\n11/24/2026,20,21,19,20\n11/25/2026,20,23,19,22\n';
let requests=0;
const fetchCboe=async(url,opts)=>{
 requests++;assert.equal(new URL(url).hostname,'cdn-api.cboe.com');assert.equal(opts.redirect,'error');
 return {ok:true,headers:{get:()=> 'text/csv'},text:async()=>csv};
};
const holidayRows=MORNING_SERIES.map((item,i)=>({label:item.label,symbol:item.symbol,
 date:expectedMorningDate(item.id,holiday,holidayNow),value:item.id==='UST10Y'?4.92:100+i,source:'Yahoo Finance 일봉'}));
assert.equal(await fillMissingMorningVix(holiday,holidayRows,{now:holidayNow,fetchImpl:fetchCboe}),holidayRows);
assert.equal(requests,0,'do not call fallback when exact VIX available');
const missingVix=holidayRows.filter(x=>x.symbol!=='^VIX');
const rescued=await fillMissingMorningVix(holiday,missingVix,{now:holidayNow,fetchImpl:fetchCboe});
assert.equal(requests,1);
assert.equal(rescued.find(r=>r.symbol==='^VIX').source,'CBOE_VIX_DAILY');
assert.equal(rescued.find(r=>r.symbol==='^VIX').date,'2026-11-25');
const cboeMsg=formatFullMorningBriefing(holiday,null,rescued,{now:holidayNow});
assert.match(cboeMsg,/VIX: 22 .*\[2026-11-25 · CBOE 참고\]/);
const cboeCoverage=inspectMorningMessage(holiday,cboeMsg,{now:holidayNow});
assert.equal(cboeCoverage.verified,21);assert.equal(cboeCoverage.status,'MATCHED_FORMATTED_QC');
assert.equal(cboeCoverage.sourceCounts.CBOE_VIX_DAILY,1);
assert.equal(inspectMorningMessage(holiday,cboeMsg.replace(' · Yahoo 참고]',' · CBOE 참고]'),{now:holidayNow}).status,'QC_MISMATCH');
for(const bad of [
 csv.replace('11/25/2026','11/26/2026'),
 csv.replace('11/24/2026','11/23/2026'),
 csv+'11/25/2026,20,23,19,22\n'
]){
 const invalid=await readCboeVixReference(holiday,{fetchImpl:async()=>({ok:true,text:async()=>bad})});
 assert.equal(invalid,null);
}
assert.equal(await fillMissingMorningVix(holiday,missingVix,{now:holidayNow,reader:async()=>({id:'VIX',symbol:'^VIX',label:'VIX',date:'2026-11-24',source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',value:20,changePercent:0})}),missingVix);
const partialMsg=formatFullMorningBriefing(date,null,rows.filter(x=>
 !['MU','BTC','NVDA','SOX','WTI','UST10Y'].some(id=>
 MORNING_SERIES.find(y=>y.id===id)?.symbol===x.symbol)),{now:now()});
const partial=inspectMorningMessage(date,partialMsg,{now:now()});
assert.equal(partial.status,'MATCHED_FORMATTED_QC');
assert.equal(partial.verified,15);
assert.equal(partial.total,21);
assert.deepEqual(new Set(partial.missing.map(x=>x.id)),
 new Set(['MU','BTC','NVDA','SOX','WTI','UST10Y']));
assert.ok(partial.missing.every(x=>x.reason==='NO_VERIFIED_ROW'));
const badYield=rows.map(x=>x.symbol==='^TNX'?{...x,value:49.2}:x);
const yieldMessage=formatFullMorningBriefing(date,null,badYield,{now:now()});
assert.match(yieldMessage,/미 10년물: 미확보 \(금리 단위 검증 필요\)/);
assert.match(yieldMessage,/■ QC: 기준 거래일과 일치한 일봉 20\/21/);
assert.equal(inspectMorningMessage(date,yieldMessage,{now:now()}).verified,20);
assert.deepEqual(inspectMorningMessage(date,yieldMessage,{now:now()}).missing.map(x=>x.id),['UST10Y']);
const mismatchedMessage=message.replace('■ QC: 기준 거래일과 일치한 일봉 21/21',
 '■ QC: 기준 거래일과 일치한 일봉 20/21');
assert.equal(inspectMorningMessage(date,mismatchedMessage,{now:now()}).status,'QC_MISMATCH');
const badSource=message.replace(' · Yahoo 참고]',' · NO_PROOF]');
assert.equal(inspectMorningMessage(date,badSource,{now:now()}).status,'QC_MISMATCH');
assert.equal(inspectMorningMessage(date,badSource,{now:now()}).missing[0].reason,
 'SOURCE_UNVERIFIED');
const wrongDate=message.replace(/\[2026-10-30 · Yahoo 참고\]/,
 '[2026-10-29 · Yahoo 참고]');
if(wrongDate!==message)
 assert.equal(inspectMorningMessage(date,wrongDate,{now:now()}).missing[0].reason,
  'SESSION_DATE_MISMATCH');
assert.equal(inspectMorningMessage(date,'arbitrary text',{now:now()}),null);
let messageCreated=0,providerCalls=0;
const prepared=await prepareMorning({
 now,githubToken:'SYNTHETIC_GITHUB_TOKEN',repository:'cyyoung111-dev/portfolio',
 mode:'rescue',gasUrl:null,gasToken:null,
 fetchImpl:async url=>{
  assert.match(String(url),/api\.github\.com\/repos\/cyyoung111-dev\/portfolio\/actions\/artifacts/);
  return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
 },
 loadReference:async()=>null,recoverReference:async()=>{providerCalls++;throw Error('must not recover after cutoff');},
 run:async({send})=>{
  messageCreated++;
  await send(null,null,partialMsg);
  return {referenceSource:'NONE'};
 }
});
assert.equal(messageCreated,1);
assert.equal(providerCalls,0);
assert.equal(prepared.ready,true);
assert.equal(prepared.coverage.verified,15);
assert.deepEqual(new Set(prepared.coverage.missing.map(x=>x.id)),
 new Set(['MU','BTC','NVDA','SOX','WTI','UST10Y']));
assert.equal(prepared.coverage.status,'MATCHED_FORMATTED_QC');
assert.ok(!JSON.stringify(prepared.coverage).includes('1000.75'));
assert.equal(prepared.referenceOrigin,'NONE');
assert.equal(prepared.status,'PREPARED');
console.log('TELEGRAM_MORNING_COVERAGE_PASS 21/21 15/21 missingIds UST10Y-unit privacy');
