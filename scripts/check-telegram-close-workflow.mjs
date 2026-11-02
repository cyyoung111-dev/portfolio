import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';
import {parseReferenceCsv,fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';
import {closeWindow,verifiedNhCloseRows,verifiedDomesticCloseRows,formatClose,fetchDomesticCloseIndexes,prepareClose,deliverClose}
 from './telegram-close-workflow.mjs';
import {isOfficialCloseWindow,selectOfficialDailyIndexRows,fetchOfficialDailyIndexes} from './krx-official-daily-index.mjs';
const day='2026-10-30',now=()=>new Date(day+'T17:00:00+09:00');
assert.equal(closeWindow(new Date(day+'T16:59:59+09:00')).allowed,false);
assert.equal(closeWindow(new Date(day+'T16:45:00+09:00')).allowed,false,'preparation can run early but delivery may not');
assert.equal(closeWindow(now()).allowed,true);
assert.equal(closeWindow(new Date(day+'T17:10:00+09:00')).allowed,true);
assert.equal(closeWindow(new Date(day+'T17:29:59+09:00')).allowed,true);
assert.equal(closeWindow(new Date(day+'T17:30:00+09:00')).allowed,false);
assert.equal(closeWindow(new Date(day+'T18:14:00+09:00')).allowed,false);
assert.equal(closeWindow(new Date(day+'T19:17:00+09:00')).allowed,false);
const rows=[
 {label:'S&P 500',symbol:'^GSPC',date:'2026-10-29',value:7720.39,changePercent:0.5,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:'2026-10-29',value:26184.72,changePercent:1.2,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:'2026-10-29',value:29402.51,changePercent:1.1,source:'NH_INDEX_DAILY'}
];
assert.equal(verifiedNhCloseRows(day,rows).length,3);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],source:'YAHOO_FINANCE'}]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],date:'2026-10-28'}]).length,0);
assert.equal(verifiedNhCloseRows(day,[rows[0],rows[0]]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],value:0}]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],label:'S&P 100'}]).length,0);
const msg=formatClose(day,rows);
assert.match(msg,/NH PLUG\(지원 지수\)/);
assert.match(msg,/S&P 500: 7,720.39.*2026-10-29.*NH/);
assert.match(msg,/NASDAQ: 26,184.72.*NH/);
assert.match(msg,/NASDAQ100: 29,402.51.*NH/);
assert.match(msg,/KOSPI: 검증된 당일 종가 미확보/);
assert.match(msg,/SOX: NH 지수 코드 미검증/);
assert.match(msg,/NH 지수 확인 3\/3/);
const dowCsv='observation_date,DJIA\n2026-10-28,51000\n2026-10-29,51500\n';
const vixCsv='DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,17.8,18.1,17.1,17.5\n10/29/2026,18,19,17,18.25\n';
const soxCsv='observation_date,NASDAQSOX\n2026-10-28,11684.00\n2026-10-29,11518.20\n';
const dow=parseReferenceCsv('DOW','2026-10-29',dowCsv),vix=parseReferenceCsv('VIX','2026-10-29',vixCsv);
const sox=parseReferenceCsv('SOX','2026-10-29',soxCsv);
assert.equal(sox.value,11518.20);assert.equal(sox.source,'FRED_NASDAQSOX');
assert.equal(parseReferenceCsv('SOX','2026-10-30',soxCsv),null);
assert.equal(dow.value,51500);assert.equal(vix.value,18.25);
assert.equal(parseReferenceCsv('DOW','2026-10-30',dowCsv),null);
assert.equal(parseReferenceCsv('VIX','2026-10-29',vixCsv+'10/29/2026,18,19,17,18.4\n'),null);
const supplemental=formatClose(day,rows,[dow,vix,sox]);
assert.match(supplemental,/다우존스: 51,500.*FRED_DJIA 참고 \(NH 아님\)/);
assert.match(supplemental,/VIX: 18.25.*CBOE_VIX_DAILY 참고 \(NH 아님\)/);
assert.match(supplemental,/SOX: 11,518.2.*FRED_NASDAQSOX 참고 \(NH 아님\)/);
assert.match(supplemental,/NH 지수 확인 3\/3/);
let refCalls=0;
const refs=await fetchSecondaryIndexes(day,{fetchImpl:async url=>{
 refCalls++;
 if(url.startsWith('https://fred.stlouisfed.org/graph/fredgraph.csv'))
  return {ok:true,headers:{get:()=> 'text/csv'},text:async()=>url.includes('NASDAQSOX')?soxCsv:dowCsv};
 if(url==='https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv')
  return {ok:true,headers:{get:()=> 'text/csv'},text:async()=>vixCsv};
 throw Error('BAD_SOURCE');
}});
assert.equal(refCalls,3);assert.equal(refs.length,3);
const domestic=[
 {type:'KOSPI',label:'KOSPI',date:day,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',value:5668.26,changePercent:-4.54},
 {type:'KOSDAQ',label:'KOSDAQ',date:day,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',value:723.15,changePercent:-3.99},
 {type:'KOSPI200',label:'KOSPI 200',date:day,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',value:890.07,changePercent:-4.89}
];
const dailyMsg=formatClose(day,rows,[],domestic);
assert.match(dailyMsg,/KOSPI: 5,668.26.*FDR\/KRX 공개 참고 \(NH 아님\)/);
assert.match(dailyMsg,/KOSDAQ: 723.15.*2026-10-30/);
assert.match(dailyMsg,/KOSPI 200: 890.07/);
assert.equal(verifiedDomesticCloseRows(day,domestic).length,3);
for(const invalid of [
  {...domestic[0],date:'2026-10-29'},
  {...domestic[0],source:'YAHOO'},
  {...domestic[0],priceType:'INTRADAY'},
  {...domestic[0],type:'KOSDAQ'},
  {...domestic[0],value:0},
  {...domestic[0],changePercent:Infinity},
  {...domestic[0],role:'NH_OPERATING_CLOSE'}
])assert.deepEqual(verifiedDomesticCloseRows(day,[invalid]),[],
  'unverified domestic row must never authorize delivery');
assert.deepEqual(verifiedDomesticCloseRows(day,[domestic[0],domestic[0]]),[],
  'duplicated domestic close cannot authorize delivery');
assert.match(formatClose(day,rows,[],[domestic[0],domestic[0]]),/KOSPI: 검증된 당일 종가 미확보/,
 'duplicate index references must fail closed');
const domesticFixture='Date,Close,UpDown\n2026-10-29,5937.66,2\n2026-10-30,5668.26,2\n';
const domesticGet=async url=>{
 if(url.includes('raw.githubusercontent.com'))
  return {ok:true,text:async()=>domesticFixture};
 if(url.includes('api.github.com/repos/FinanceData/fdr_krx_data_cache/commits'))
  return {ok:true,json:async()=>[{sha:'b'.repeat(40),commit:{committer:{date:'2026-10-30T10:58:41Z'}}}]};
 throw Error('unexpected index query');
};
const late=()=>new Date(day+'T20:10:00+09:00');
const verifiedDomestic=await fetchDomesticCloseIndexes(day,{fetchImpl:domesticGet,now:late});
assert.equal(verifiedDomestic.length,3);
assert.ok(verifiedDomestic.every(x=>x.source==='FDR_KRX_CACHE'&&x.date===day));
const earlyDomestic=await fetchDomesticCloseIndexes(day,{now,fetchImpl:async url=>url.includes('raw.githubusercontent.com')
 ?{ok:true,text:async()=>domesticFixture}
 :{ok:true,json:async()=>[{sha:'b'.repeat(40),commit:{committer:{date:'2026-10-30T04:19:16Z'}}}]}});
assert.deepEqual(earlyDomestic,[],'intraday published row cannot show as close');
const priorMissing='Date,Close,UpDown\\n2026-10-28,6012.44,1\\n2026-10-30,5668.26,2\\n'.replaceAll('\\n','\n');
const miss=await fetchDomesticCloseIndexes(day,{now:late,fetchImpl:async url=>url.includes('raw.githubusercontent.com')
 ?{ok:true,text:async()=>priorMissing}
 :{ok:true,json:async()=>[{sha:'b'.repeat(40),commit:{committer:{date:'2026-10-30T10:58:41Z'}}}]}});
assert.deepEqual(miss,[],'missing October 29 must not become a 2-day daily change');

const officialPayload={status:'ok',
 series:{KOSPI:[{date:day,value:5668.26,source:'KRX_OFFICIAL'}],
 KOSDAQ:[{date:day,value:723.15,source:'KRX_OFFICIAL',changePercent:-3.99}],
 KOSPI200:[{date:day,value:890.07,source:'YAHOO_UNVERIFIED_DAILY'}]},
 seriesMeta:{KOSPI:{confirmedClose:true,officialDate:day,source:'KRX_OFFICIAL'},
 KOSDAQ:{confirmedClose:true,officialDate:day,source:'KRX_OFFICIAL'},
 KOSPI200:{confirmedClose:false,officialDate:day,source:'YAHOO_UNVERIFIED_DAILY'}}
};
assert.equal(isOfficialCloseWindow(day,new Date(day+'T15:59:59+09:00')),false);
assert.equal(isOfficialCloseWindow(day,new Date(day+'T16:00:00+09:00')),true);
assert.equal(isOfficialCloseWindow('2026-10-31',new Date('2026-10-31T16:30:00+09:00')),false);
const official=selectOfficialDailyIndexRows(day,officialPayload);
assert.deepEqual(official.map(x=>x.type),['KOSPI','KOSDAQ']);
assert.equal(official[0].priceType,'CONFIRMED_REGULAR_CLOSE');
assert.equal(official[0].changePercent,null);
assert.deepEqual(selectOfficialDailyIndexRows(day,{
 ...officialPayload,seriesMeta:{...officialPayload.seriesMeta,
 KOSPI:{...officialPayload.seriesMeta.KOSPI,officialDate:'2026-10-29'},
 KOSDAQ:{...officialPayload.seriesMeta.KOSDAQ,confirmedClose:false}}
}),[]);
assert.deepEqual(selectOfficialDailyIndexRows(day,{
 ...officialPayload,series:{...officialPayload.series,KOSPI:[officialPayload.series.KOSPI[0],
 officialPayload.series.KOSPI[0]]}
}).map(x=>x.type),['KOSDAQ'],'duplicate official daily rows must fail closed');
let officialRequests=0;
const actualOfficial=await fetchOfficialDailyIndexes(day,{
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',token:'TEST-GAS-TOKEN',now,
 fetchImpl:async(url,init)=>{
  officialRequests++;
  const form=new URLSearchParams(init.body);
  assert.equal(form.get('action'),'getBenchmarks');
  assert.equal(form.get('benchmarks'),'KOSPI,KOSDAQ,KOSPI200');
  assert.equal(form.get('fresh'),'1');
  assert.equal(form.get('from'),day);
  assert.equal(form.get('to'),day);
  assert.equal(form.get('accessToken'),'TEST-GAS-TOKEN');
  return {ok:true,json:async()=>officialPayload};
 }});
assert.equal(officialRequests,1);
assert.deepEqual(actualOfficial.map(x=>x.type),['KOSPI','KOSDAQ']);
assert.deepEqual(await fetchOfficialDailyIndexes(day,{url:'http://example.com',token:'X',now,fetchImpl:async()=>{
 throw Error('HTTP must not be called');
}}),[]);
assert.deepEqual(await fetchOfficialDailyIndexes(day,{url:'https://script.google.com/macros/s/ID/exec',token:'X',
 now:()=>new Date(day+'T15:59:59+09:00'),fetchImpl:async()=>{throw Error('too soon')}}),[]);
const priority=await fetchDomesticCloseIndexes(day,{
 now:late,fetchImpl:domesticGet,gasUrl:'https://script.google.com/macros/s/EXAMPLE123/exec',
 gasToken:'TEST-GAS-TOKEN',fetchOfficial:async()=>official
});
assert.deepEqual(priority.map(x=>x.source),['KRX_OFFICIAL','KRX_OFFICIAL','FDR_KRX_CACHE']);
const officialText=formatClose(day,rows,[],priority);
assert.match(officialText,/KOSPI: 5,668.26.*KRX 공식 종가 \(NH 아님\)/);
assert.match(officialText,/KOSDAQ: 723.15.*KRX 공식 종가 \(NH 아님\)/);
assert.match(officialText,/KOSPI 200: 5,668.26.*FDR\/KRX 공개 참고 \(NH 아님\)/);

assert.doesNotMatch(msg,/Yahoo Finance 일봉 기준/);
let fetched=0,sent=0;
const options={now,githubToken:'dummy',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async(target)=>{
  assert.ok(target.includes('api.github.com'),'never call Yahoo or KRX');
  return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
 },
 gasUrl:'https://script.google.com/macros/s/EXAMPLE123/exec',gasToken:'TEST-GAS-TOKEN',
 fetchNh:async(date,opts)=>{
  fetched++;assert.equal(date,day);assert.equal(opts.token,'TEST-GAS-TOKEN');
  assert.equal(opts.url,'https://script.google.com/macros/s/EXAMPLE123/exec');return rows;
 }};
options.fetchSecondary=async()=>[dow,vix];
options.fetchDomestic=async()=>[];
await assert.rejects(prepareClose({...options,now:()=>new Date(day+'T16:59:59+09:00')}),/TELEGRAM_CLOSE_LATE/);
const prepared=await prepareClose(options);
assert.equal(prepared.ready,true);assert.equal(fetched,1);assert.equal(prepared.nhConfirmed,3);
assert.equal(prepared.domesticConfirmed,0);
assert.match(prepared.message,/NH PLUG/);
assert.match(prepared.message,/CBOE_VIX_DAILY 참고/);
const providerDown=await prepareClose({...options,fetchSecondary:async()=>{throw Error('PROVIDER_DOWN');}});
assert.equal(providerDown.ready,true,'non-NH feed failure must never prevent NH message');
assert.match(providerDown.message,/S&P 500: 7,720.39/);
assert.match(providerDown.message,/VIX: NH 지수 코드 미검증 · 별도 참고값 미확보/);
assert.equal((await deliverClose(prepared,{now,send:async()=>{sent++;}})).status,'SENT');
assert.equal(sent,1);
await assert.rejects(deliverClose(prepared,{now,attempt:2,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose({...prepared,date:'2026-10-29'},{now,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose({...prepared,nhConfirmed:0},{now,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose(prepared,{now:()=>new Date(day+'T17:30:00+09:00'),
 send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
assert.equal(sent,1);
const domesticOnly=await prepareClose({...options,
 fetchNh:async()=>{throw Error('NH_TEMPORARILY_UNAVAILABLE');},
 fetchDomestic:async()=>[...domestic],
 fetchSecondary:async()=>[]});
assert.equal(domesticOnly.ready,true,'published domestic EOD must independently authorize report');
assert.equal(domesticOnly.nhConfirmed,0);
assert.equal(domesticOnly.domesticConfirmed,3);
assert.match(domesticOnly.message,/KOSPI: 5,668.26/);
assert.match(domesticOnly.message,/S&P 500: NH 완료 일봉 미확보/);
assert.equal((await deliverClose(domesticOnly,{now,send:async()=>{sent++;}})).status,'SENT');
assert.equal(sent,2);
const officialOnly=await prepareClose({...options,fetchNh:async()=>[],
 fetchDomestic:async()=>[official[0]],fetchSecondary:async()=>[]});
assert.equal(officialOnly.ready,true);
assert.equal(officialOnly.domesticConfirmed,1);
assert.equal(officialOnly.nhConfirmed,0);
assert.match(officialOnly.message,/KOSPI: 5,668.26.*KRX 공식 종가/);
const empty=await prepareClose({...options,fetchNh:async()=>[{...rows[0],source:'KRX_OFFICIAL'}]});
assert.equal(empty.ready,false);assert.equal(empty.status,'NO_VERIFIED_INDEX_CLOSE');
const refOnly=await prepareClose({...options,fetchNh:async()=>[],fetchSecondary:async()=>[dow,vix]});
assert.equal(refOnly.ready,false,'FRED/CBOE-only references cannot authorize report');
assert.equal(refOnly.status,'NO_VERIFIED_INDEX_CLOSE');
const badDomestic=await prepareClose({...options,fetchNh:async()=>[],
 fetchDomestic:async()=>[{...domestic[0],date:'2026-10-29'}]});
assert.equal(badDomestic.ready,false);
await assert.rejects(deliverClose({...domesticOnly,domesticConfirmed:0},{now,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
const claimed=await prepareClose({...options,fetchImpl:async()=>({ok:true,
 json:async()=>({total_count:1,artifacts:[{name:'telegram-close-claim-'+day}]})})});
assert.equal(claimed.ready,false);
await assert.rejects(prepareClose({...options,fetchImpl:async()=>{throw Error('private');}}),/CLAIM_FAILED/);
await assert.rejects(prepareClose({...options,attempt:2}),/CONFIG/);
assert.equal((await prepareClose({...options,now:()=>new Date('2026-10-31T17:00:00+09:00')})).status,'MARKET_CLOSED');
const workflow=YAML.parse(fs.readFileSync('.github/workflows/telegram-close-briefing.yml','utf8'));
assert.equal(workflow.jobs.briefing.environment,'portfolio-production-gas');
const step=workflow.jobs.briefing.steps.find(s=>s.id==='prepare');
assert.match(step.env.GAS_ACCESS_TOKEN,/secrets[.]GAS_ACCESS_TOKEN/);
assert.match(step.env.GAS_WEB_APP_URL,/vars[.]GAS_WEB_APP_URL/);
const send=workflow.jobs.briefing.steps.find(s=>s.name==='Send claimed closing briefing once');
assert.equal(send.env.GAS_ACCESS_TOKEN,undefined);
assert.deepEqual(workflow.on.schedule.map(x=>x.cron),[
 '0 8 * * 1-5','5 8 * * 1-5',
 '10 8 * * 1-5','20 8 * * 1-5'
]);
assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'),
 'guarded manual rescue must be enabled');
// The observed scheduler incident started morning at 11:07 and created no
// closing run. Independent completions may recover only inside each window.
const env={GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',GITHUB_REF:'refs/heads/main',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_run'};
const completion={action:'completed',workflow_run:{name:'gas-deploy',
 path:'.github/workflows/gas-deploy.yml',event:'workflow_run',head_branch:'main',
 head_repository:{full_name:env.GITHUB_REPOSITORY},status:'completed',conclusion:'success',run_attempt:1}};
assert.equal(deliveryTrigger('close',env,completion,true),true);
assert.equal(deliveryTrigger('close',env,completion,false),false);
for(const patch of [{event:'pull_request'},{head_branch:'feature'},
 {head_repository:{full_name:'other/fork'}},{path:'.github/workflows/other.yml'},
 {conclusion:'failure'},{run_attempt:2},{name:'quality-check'}]){
 assert.throws(()=>deliveryTrigger('close',env,{...completion,
  workflow_run:{...completion.workflow_run,...patch}},true),/TRIGGER_INVALID/);
}
for(const patch of [{GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'},
 {GITHUB_REPOSITORY:'other/fork'}]){
 assert.throws(()=>deliveryTrigger('close',{...env,...patch},completion,true),/TRIGGER_INVALID/);
}
const morningCompletion={...completion,workflow_run:{...completion.workflow_run,
 name:'NH night reference capture',path:'.github/workflows/nh-night-capture.yml',event:'schedule'}};
assert.equal(deliveryTrigger('morning',env,morningCompletion,true),true);
assert.equal(deliveryTrigger('morning',env,morningCompletion,false),false);
assert.throws(()=>deliveryTrigger('morning',env,completion,true),/TRIGGER_INVALID/);
assert.equal(deliveryTrigger('close',{...env,GITHUB_EVENT_NAME:'push'},
 {ref:'refs/heads/main',repository:{full_name:env.GITHUB_REPOSITORY}},true),true);
assert.equal(deliveryTrigger('close',{...env,GITHUB_EVENT_NAME:'push'},
 {ref:'refs/heads/main',repository:{full_name:env.GITHUB_REPOSITORY}},false),false,
 'off-hours main workflow push must not enter close preparation or fail TELEGRAM_CLOSE_LATE');
// A scheduled close still gets its own strong date/market/claim gates;
// do not relax the 17:30 cutoff or permit an off-hour send.
assert.equal(deliveryTrigger('close',{...env,GITHUB_EVENT_NAME:'schedule'},
 {},false),true,'schedule reaches guarded prepare; no unconditional send');
assert.throws(()=>deliveryTrigger('close',{...env,GITHUB_EVENT_NAME:'push'},
 {ref:'refs/heads/feature'},true),/TRIGGER_INVALID/);
const triggerSource=fs.readFileSync('scripts/telegram-delivery-trigger.mjs','utf8');
const unsafe=await import('data:text/javascript,'+encodeURIComponent(triggerSource.replace(
 "||run.head_repository?.full_name!==REPO",'')));
assert.throws(()=>assert.throws(()=>unsafe.deliveryTrigger('close',env,{...completion,
 workflow_run:{...completion.workflow_run,head_repository:{full_name:'other/fork'}}},true)),
 'the fork rejection oracle must detect removal of the trust guard');
assert.deepEqual(workflow.on.workflow_run.workflows,['market-briefing-headless','gas-deploy']);
assert.deepEqual(workflow.on.workflow_run.branches,['main']);
assert.equal(workflow.concurrency.group,'telegram-close-briefing');
assert.equal(workflow.concurrency['cancel-in-progress'],false);
const recoveryNow=()=>new Date(day+'T17:20:00+09:00');
const recovered=await prepareClose({...options,now:recoveryNow});
assert.equal(recovered.ready,true,'delayed same-day scheduler can still prepare');
assert.equal((await deliverClose(recovered,{now:recoveryNow,send:async()=>{}})).status,'SENT');
assert.equal((await prepareClose({...options,now:recoveryNow,fetchImpl:async()=>({ok:true,
 json:async()=>({total_count:1,artifacts:[{name:'telegram-close-claim-'+day}]})})})).status,
 'ALREADY_CLAIMED','fallback and schedule must use the same date claim');
await assert.rejects(deliverClose(recovered,{now:()=>new Date('2026-10-31T17:20:00+09:00'),
 send:async()=>assert.fail('cross-date send')}),/PAYLOAD_INVALID/);
// Manual morning rescue is never a bypass for 07:40-08:10 KST, trade date,
 // first-attempt restriction, artifact claim, or genuine SENT confirmation.
const dispatchEnv={...env,GITHUB_EVENT_NAME:'workflow_dispatch'};
assert.equal(deliveryTrigger('morning',dispatchEnv,{},true),true);
for(const patch of [{GITHUB_REF:'refs/heads/feature'},
 {GITHUB_REPOSITORY:'fork/repo'},{GITHUB_RUN_ATTEMPT:'2'}])
 assert.throws(()=>deliveryTrigger('morning',{...dispatchEnv,...patch},{},true),/TRIGGER_INVALID/);
const morningNow=()=>new Date('2026-10-30T07:50:00+09:00');
let manualLookups=0,manualSends=0;
const {prepareMorning,deliverPrepared}=await import('./telegram-morning-workflow.mjs');
const manualPrepared=await prepareMorning({
 now:morningNow,githubToken:'SYNTHETIC_TEST_TOKEN',repository:env.GITHUB_REPOSITORY,
 fetchImpl:async()=>{manualLookups++;return {ok:true,json:async()=>({total_count:0,artifacts:[]})};},
 loadReference:async()=>null,
 run:async({send})=>{await send('','','SYNTHETIC SAFE MORNING REPORT');return {referenceSource:'NONE'};}
});
assert.equal(manualPrepared.ready,true);
assert.equal(manualPrepared.artifactName,'telegram-morning-claim-2026-10-30');
assert.equal(manualLookups,1);
assert.equal((await deliverPrepared(manualPrepared,{now:morningNow,
 send:async()=>{manualSends++;}})).status,'SENT');
assert.equal(manualSends,1);
const already=await prepareMorning({
 now:morningNow,githubToken:'SYNTHETIC_TEST_TOKEN',repository:env.GITHUB_REPOSITORY,
 fetchImpl:async()=>({ok:true,json:async()=>({total_count:1,
 artifacts:[{name:'telegram-morning-claim-2026-10-30'}]})}),
 loadReference:async()=>assert.fail('claimed; must not fetch NH'),
 run:async()=>assert.fail('claimed; must not prepare')});
assert.equal(already.status,'ALREADY_CLAIMED');
await assert.rejects(prepareMorning({now:()=>new Date('2026-10-30T11:07:00+09:00'),
 githubToken:'SYNTHETIC_TEST_TOKEN',repository:env.GITHUB_REPOSITORY,
 fetchImpl:async()=>assert.fail('late; must not query anything')}),/SCHEDULE_LATE/);
await assert.rejects(deliverPrepared(manualPrepared,{
 now:()=>new Date('2026-10-30T08:10:00+09:00'),
 send:async()=>assert.fail('late; must not send')}),/PREPARED_INVALID/);
await assert.rejects(deliverPrepared(manualPrepared,{
 now:morningNow,attempt:2,
 send:async()=>assert.fail('rerun; must not send')}),/PREPARED_INVALID/);
await assert.rejects(deliverPrepared({...manualPrepared,date:'2026-10-29'},{
 now:morningNow,send:async()=>assert.fail('cross-date; must not send')}),/PREPARED_INVALID/);
assert.equal(manualSends,1);
const morningWorkflow=YAML.parse(fs.readFileSync('.github/workflows/telegram-morning-briefing.yml','utf8'));
assert.deepEqual(morningWorkflow.on.workflow_run.workflows,['NH night reference capture']);
assert.equal(morningWorkflow.concurrency.group,'telegram-morning-briefing');
assert.match(morningWorkflow.jobs.briefing.steps.find(s=>s.id==='prepare').if,/workflow_run/);
assert.equal(morningWorkflow.on.workflow_dispatch.inputs.mode.default,'rescue');
assert.deepEqual(morningWorkflow.on.workflow_dispatch.inputs.mode.options,['rescue','connection_test','late_test']);
assert.match(morningWorkflow.jobs.briefing.steps.find(s=>s.id==='prepare').if,/inputs.mode == 'rescue'/);
assert.match(morningWorkflow.jobs.briefing.steps.find(s=>s.name==='Manual connection test only').if,/inputs.mode == 'connection_test'/);
assert.equal(morningWorkflow.jobs.briefing.steps.find(s=>s.name==='Send claimed briefing once').env.TELEGRAM_BOT_TOKEN,'${{ secrets.TELEGRAM_BOT_TOKEN }}');

const morningPrepareStep=morningWorkflow.jobs.briefing.steps.find(s=>s.id==='prepare');
const morningSendStep=morningWorkflow.jobs.briefing.steps.find(s=>s.name==='Send claimed briefing once');
assert.equal(morningPrepareStep.env.TELEGRAM_DISPATCH_MODE,"${{ inputs.mode || '' }}");
assert.equal(morningSendStep.env.TELEGRAM_DISPATCH_MODE,morningPrepareStep.env.TELEGRAM_DISPATCH_MODE,
 'workflow_dispatch rescue must be present on BOTH prepare and send process environments');
assert.equal(morningSendStep.env.GAS_ACCESS_TOKEN,undefined,
 'never pass operational GAS access token to Telegram send');
// Validate the real CLI guard for both prepare and send modes with a synthetic
// GitHub event and intentionally absent payload. No Telegram API is contacted.
const sandbox=fs.mkdtempSync(join(tmpdir(),'telegram-dispatch-guard-'));
try{
 const eventPath=join(sandbox,'event.json');
 fs.writeFileSync(eventPath,JSON.stringify({inputs:{mode:'rescue'}}));
 const baseEnv={...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',
   GITHUB_EVENT_PATH:eventPath,GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',
   GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',
   TELEGRAM_BOT_TOKEN:'INTENTIONALLY_INVALID',TELEGRAM_CHAT_ID:'0'};
 const cli=(mode,dispatch)=>spawnSync(process.execPath,
   ['scripts/telegram-morning-workflow.mjs',mode],
   {encoding:'utf8',env:{...baseEnv,TELEGRAM_DISPATCH_MODE:dispatch}});
 const denied=cli('send','');
 assert.equal(denied.status,1);
 assert.match(denied.stderr,/TELEGRAM_DISPATCH_MODE_INVALID/);
 const deniedTest=cli('send','connection_test');
 assert.equal(deniedTest.status,1);
 assert.match(deniedTest.stderr,/TELEGRAM_DISPATCH_MODE_INVALID/);
 const lateMode=cli('send','late_test');
 assert.equal(lateMode.status,1,'without prepared payload late_test must fail closed');
 assert.doesNotMatch(lateMode.stderr,/TELEGRAM_DISPATCH_MODE_INVALID/);
 const acceptedMode=cli('send','rescue');
 assert.equal(acceptedMode.status,1,'missing payload must fail closed');
 assert.doesNotMatch(acceptedMode.stderr,/TELEGRAM_DISPATCH_MODE_INVALID/,
   'rescue send mode must pass process guard to dated payload verification');
}finally{fs.rmSync(sandbox,{recursive:true,force:true});}

assert.equal(morningWorkflow.jobs.briefing.steps.find(s=>s.name==='Send claimed briefing once').env.GAS_ACCESS_TOKEN,undefined);

assert.doesNotMatch(fs.readFileSync('scripts/telegram-close-workflow.mjs','utf8'),/query1[.]finance[.]yahoo[.]com/);
console.log('Closing Telegram: independent NH/domestic EOD gates, manual-rescue cron and claim guard PASS');
