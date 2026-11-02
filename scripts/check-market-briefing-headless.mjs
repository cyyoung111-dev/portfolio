import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { krxSessionStatus } from './krx-session-calendar.mjs';
import { fetchUsdKrwYahooDaily } from './market-briefing-fx-fallback.mjs';
import { parsePrekospiNight, fetchPrekospiNight } from './prekospi-night-reference.mjs';
import { scheduledWindow, fetchDatedDaily, sendTelegram, runTelegramMorning } from './telegram-morning-briefing.mjs';
import fs from 'node:fs';
import YAML from 'yaml';
import { createRequest, diagnosticFor, headlessSucceeded, maskSecrets, parseArgs, runHeadless, scheduledTradingDate } from './run-market-briefing-headless.mjs';

globalThis.localStorage.clear();
const prekospiHtml = '<div>장 마감 · 마지막 세션</div><section><h1>코스피200 야간선물 · <!-- -->마지막 야간 기록</h1><span class="tabular-nums text-[44px]">872.35</span><div>2026-10-26 18:00 ~ 익일 06:00 · 1분봉 (KST) · 2026. 10. 27. 06:00:00 KST 업데이트</div></section>';
const reference = parsePrekospiNight(prekospiHtml,'2026-10-27','2026-10-27T06:20:00+09:00');
assert.equal(reference.value,872.35);
assert.equal(reference.officialClose,false);
assert.equal(reference.source,'PREKOSPI');
assert.equal(parsePrekospiNight(prekospiHtml,'2026-10-28','2026-10-28T06:20:00+09:00'),null,'stale dates are rejected');
assert.equal(parsePrekospiNight(prekospiHtml.replace('872.35','872.38'),'2026-10-27','2026-10-27T06:20:00+09:00'),null,'invalid tick is rejected');
assert.equal(parsePrekospiNight(prekospiHtml,'2026-10-27','2026-10-27T05:59:00+09:00'),null,'future page update is rejected');
assert.equal(parsePrekospiNight(prekospiHtml.replace('장 마감','장중'),'2026-10-27','2026-10-27T06:20:00+09:00'),null,'live session is not a completed session');
assert.equal(await fetchPrekospiNight('2026-10-27',{fetchImpl:async()=>{throw new Error('offline');}}),null,'network error is not a value');
const fetchedReference = await fetchPrekospiNight('2026-10-27',{fetchImpl:async()=>({ok:true,headers:new Headers({'content-type':'text/html; charset=utf-8'}),text:async()=>prekospiHtml}),now:()=>new Date('2026-10-27T06:25:00+09:00')});
assert.equal(fetchedReference.receivedAt,'2026-10-26T21:25:00.000Z');
assert.deepEqual(diagnosticFor({checkpoint:'MORNING',tradingDate:'2026-10-27',prekospiReference:fetchedReference,decision:{publishable:false}}).nightReference,fetchedReference);
assert.equal(diagnosticFor({checkpoint:'MORNING',tradingDate:'2026-10-27',prekospiReference:fetchedReference,decision:{publishable:false}}).published,false,'reference alone must not be reported as published');
assert.equal(scheduledWindow(new Date('2026-10-28T07:39:59+09:00')).allowed,false);
assert.equal(scheduledWindow(new Date('2026-10-28T07:40:00+09:00')).allowed,true);
assert.equal(scheduledWindow(new Date('2026-10-28T07:59:59+09:00')).allowed,true);
assert.equal(scheduledWindow(new Date('2026-10-28T08:00:00+09:00')).allowed,true);
assert.equal(scheduledWindow(new Date('2026-10-28T08:10:00+09:00')).allowed,false);
const sampleChart={chart:{result:[{meta:{symbol:'^KS11',exchangeTimezoneName:'Asia/Seoul'},timestamp:[Date.parse('2026-10-26T06:30:00Z')/1000,Date.parse('2026-10-27T06:30:00Z')/1000,Date.parse('2026-10-28T00:00:00Z')/1000],indicators:{quote:[{close:[100,110,999]}]}}]}};
const daily=await fetchDatedDaily('KOSPI','^KS11','2026-10-28',{now:new Date('2026-10-28T08:00:00+09:00'),fetchImpl:async()=>({ok:true,json:async()=>sampleChart})});
assert.equal(daily.value,110,'당일 미확정 일봉을 전일 종가로 사용하지 않음');
assert.equal(daily.date,'2026-10-27');
assert.ok(Math.abs(daily.changePercent-10)<1e-9);
let sendCount=0, sentBody='';
const telegramFetch=async(url,options)=>{sendCount++;sentBody=options.body;assert.ok(url.startsWith('https://api.telegram.org/'));return {ok:true,json:async()=>({ok:true})};};
await sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345','시험',{fetchImpl:telegramFetch});
assert.equal(sendCount,1);assert.equal(JSON.parse(sentBody).text,'시험');
await assert.rejects(()=>sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345','시험',{fetchImpl:async()=>{throw new Error('secret leak');}}),/TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY/);
let delivered=0, textSent='';
const testSender=async(_token,_chat,text)=>{delivered++;textSent=text;};
const tomorrow='2026-10-28',fakeRef={source:'NH',contract:'KA016C000',contractMonth:'2026-12',kind:'REFERENCE',tradingDate:tomorrow,value:872.35,officialClose:false,sourceUpdatedAt:`${tomorrow}T06:00:00+09:00`,receivedAt:`${tomorrow}T07:30:00+09:00`};
const morningOptions={now:()=>new Date(`${tomorrow}T07:45:01+09:00`),token:'x',chatId:'x',send:testSender,referenceFetch:async()=>fakeRef,fetchImpl:async()=>({ok:false})};
const morning=await runTelegramMorning(morningOptions);
assert.equal(morning.status,'SENT_REFERENCE');assert.equal(delivered,1);assert.match(textSent,/872\.35/);assert.match(textSent,/NH PLUG 06:00 운영 확정 기준/);
await assert.rejects(()=>runTelegramMorning({...morningOptions,attempt:2}),/TELEGRAM_RETRY_BLOCKED/);
await assert.rejects(()=>runTelegramMorning({...morningOptions,now:()=>new Date(`${tomorrow}T08:10:00+09:00`)}),/TELEGRAM_SCHEDULE_LATE/);
assert.equal(delivered,1,'재시도 및 지연 실행에서 메시지 중복 발송 금지');
const stale=await runTelegramMorning({...morningOptions,referenceFetch:async()=>({...fakeRef,tradingDate:'2026-10-27'})});
assert.equal(stale.status,'SENT_SOURCE_MISSING');assert.match(textSent,/당일 참고값 미확보/);assert.doesNotMatch(textSent,/872\.35/);
const tflRef={...fakeRef,source:'NH',contract:'KA016C000',value:900.05};
const tflMorning=await runTelegramMorning({...morningOptions,referenceFetch:async()=>tflRef});
assert.equal(tflMorning.status,'SENT_REFERENCE');
assert.equal(tflMorning.referenceSource,'NH');assert.equal(tflMorning.referenceDate,tomorrow);assert.equal(tflMorning.referenceContract,'KA016C000');
assert.match(textSent,/NH PLUG 06:00 운영 확정 기준/);assert.match(textSent,/900\.05pt/);
const tflBad=await runTelegramMorning({...morningOptions,referenceFetch:async()=>({...tflRef,contract:''})});
assert.equal(tflBad.status,'SENT_SOURCE_MISSING');assert.doesNotMatch(textSent,/900\.05/);
// The headless calendar consumes the GAS source of truth (including temporary
// domestic closures) rather than approximating every weekday as a trading day.
assert.equal(krxSessionStatus('2026-10-05'),'CLOSED','GAS 확정 휴장일');
assert.equal(krxSessionStatus('2026-10-09'),'CLOSED','한글날 휴장');
assert.equal(krxSessionStatus('2026-10-10'),'CLOSED','토요일 휴장');
assert.equal(krxSessionStatus('2026-10-08'),'OPEN','KRX 정상 거래일');
assert.equal(krxSessionStatus('2026-02-30'),'UNKNOWN','잘못된 날짜');
assert.equal(krxSessionStatus('2028-10-09'),'UNKNOWN','미확인 연도 평일을 단정하지 않음');
const date='2026-09-18', prior='2026-09-17';
assert.equal(scheduledTradingDate('15 0 * * 1-5',new Date('2026-10-19T00:15:30Z')),
  '2026-10-16','T+1 09:15 월요일 확정 재수집은 금요일 거래일을 선택');
assert.equal(scheduledTradingDate('15 0 * * 1-5',new Date('2026-10-13T00:15:30Z')),
  '2026-10-12','T+1 09:15 화요일은 월요일 영업일 선택');
assert.equal(parseArgs(['--checkpoint','NIGHT_FINAL','--schedule','15 0 * * 1-5',
  '--scheduled-at','2026-10-19T00:15:30Z']).tradingDate,
  '2026-10-16','배포 이후 지연된 schedule도 최초 예약일 기준 전영업일 확정');
assert.equal(parseArgs(['--checkpoint','NIGHT_FINAL','--schedule','15 0 * * 1-5',
  '--scheduled-at','2026-10-19T00:15:30Z']).requireKrxOfficialNight,true);
assert.equal(parseArgs(['--checkpoint','NIGHT_FINAL','--schedule','15 21 * * 0-4',
  '--scheduled-at','2026-10-18T21:15:30Z']).requireKrxOfficialNight,false);
assert.equal(parseArgs(['--checkpoint','NIGHT_FINAL','--date',date]).schedule,'',
 'manual NIGHT_FINAL must be distinct from scheduled 06:15');
assert.throws(()=>parseArgs(['--checkpoint','MORNING','--schedule','15 0 * * 1-5']),
  /schedule과 checkpoint/,'NIGHT_FINAL catch-up은 MORNING과 혼동 금지');
assert.equal(scheduledTradingDate('30 22 * * 0-4',new Date('2026-09-22T03:00:00Z')),'2026-09-22','지연 실행도 월요일 22:30 UTC slot의 화요일 거래일 유지');
assert.equal(scheduledTradingDate('30 7 * * 1-5',new Date('2026-09-21T20:00:00Z')),'2026-09-21','장마감 slot은 실행시각이 아니라 cron slot 거래일 사용');
assert.equal(parseArgs(['--checkpoint','MORNING','--date','2026-09-18','--schedule','30 22 * * 0-4']).tradingDate,'2026-09-18','수동 --date가 schedule보다 우선');
const anchoredArgs=['--checkpoint','MORNING','--schedule','30 22 * * 0-4','--scheduled-at','2026-09-21T22:31:00Z'];
assert.equal(parseArgs(anchoredArgs).tradingDate,'2026-09-22','workflow 최초 created_at으로 화요일 거래일 고정');
assert.equal(parseArgs([...anchoredArgs,'--date','2026-09-18']).tradingDate,'2026-09-18','명시적 --date가 scheduled-at보다 우선');
assert.throws(()=>parseArgs(['--checkpoint','MORNING','--schedule','30 22 * * 0-4','--scheduled-at','invalid']),/잘못된 scheduled-at/);
assert.throws(()=>parseArgs(['--checkpoint','MORNING','--date','2026-02-30']),/잘못된 tradingDate/,'실재하지 않는 달력 날짜 거부');
assert.throws(()=>parseArgs(['--checkpoint','EVENING','--schedule','30 22 * * 0-4']),/schedule과 checkpoint/,'cron slot과 checkpoint 불일치 거부');
assert.equal(scheduledTradingDate('30 7 * * 1-5',new Date('2026-10-09T01:00:00Z')),'2026-10-08','16:30 KST 예약보다 앞서 실행된 경우 전일 slot');
assert.equal(maskSecrets('accessToken=secret&next=1 secret',['secret']),'accessToken=***&next=1 ***','diagnostic secret masking');
assert.equal(maskSecrets('auth_key=abc apiKey:def secret=ghi token:jkl'), 'auth_key=*** apiKey:*** secret=*** token:***');
const diagnostic=diagnosticFor({checkpoint:'MORNING',tradingDate:'2026-09-18',sync:{persistence:{saved:2,duplicates:1,rejected:0},errors:{FX:'apiKey=abc'}},persistence:{saved:1,duplicates:0,rejected:0},decision:{publishable:true,status:'READY',data:{snapshot:{values:{USDKRW:{value:1}}},warnings:['W']}}},['abc']);
assert.deepEqual(diagnostic.providerErrors,['FX']);assert.equal(diagnostic.providerErrorDetails.FX,'apiKey=***');assert.equal(diagnostic.readinessSeries.USDKRW.value,1);assert.deepEqual(diagnostic.masterPersistence,{saved:2,duplicates:1,rejected:0});assert.deepEqual(diagnostic.snapshotPersistence,{saved:1,duplicates:0,rejected:0});assert.deepEqual(diagnostic.warnings,['W']);
// Collectors request a finite per-action timeout. The GAS adapter must
// actually pass an AbortSignal instead of ignoring timeoutMs.
const timeoutSignals=[];
const boundedRequest=createRequest('https://example.test','fake-token',async(_url,opts)=>{
  timeoutSignals.push(opts.signal);
  return {ok:true,json:async()=>({status:'ok'})};
});
await boundedRequest('getSettings',{}, {timeoutMs:7500});
await boundedRequest('getSettings');
assert.equal(timeoutSignals.length,2);
assert.ok(timeoutSignals.every(signal=>signal instanceof AbortSignal && !signal.aborted),
  'headless GAS requests require an active bounded timeout signal');

const fxFetch=payload=>async()=>({ok:true,json:async()=>payload});
assert.equal((await createRequest('https://example.test','secret',fxFetch({status:'CONFIRMED',history:[]}))('getExchangeRateHistory')).status,'CONFIRMED');
assert.equal((await createRequest('https://example.test','secret',fxFetch({status:'NO_DATA',history:[]}))('getExchangeRateHistory')).status,'NO_DATA');
await assert.rejects(()=>createRequest('https://example.test','secret',fxFetch({status:'MISSING_SOURCE'}))('getExchangeRateHistory'),/FX_MISSING_SOURCE/);
await assert.rejects(()=>createRequest('https://example.test','secret',fxFetch({status:'INVALID_SCHEMA'}))('getExchangeRateHistory'),/FX_INVALID_SCHEMA/);

const yahooFxPayload={chart:{result:[{
 meta:{symbol:'KRW=X',currency:'KRW',exchangeTimezoneName:'Europe/London'},
 timestamp:[Date.parse('2026-10-07T00:00:00Z')/1000,
            Date.parse('2026-10-08T00:00:00Z')/1000,
            Date.parse('2026-10-09T00:00:00Z')/1000],
 indicators:{quote:[{close:[1339.16,1344.75,0]}]},
}]}};
const fxDaily=await fetchUsdKrwYahooDaily({
 from:'2026-10-07',to:'2026-10-09',
 fetchImpl:async(url,opts)=>{
  assert.equal(new URL(url).hostname,'query1.finance.yahoo.com');
  assert.ok(new URL(url).pathname.endsWith('/KRW%3DX'));
  assert.ok(opts.signal instanceof AbortSignal);
  return {ok:true,json:async()=>yahooFxPayload};
 }});
assert.deepEqual(fxDaily.history.map(r=>r.date),['2026-10-07','2026-10-08'],
 'No fabricated 10/09 FX close; only actual, positive, dated provider candles');
assert.equal(fxDaily.history[0].rate,1339.16);
const fxDst=await fetchUsdKrwYahooDaily({
 from:'2026-10-07',to:'2026-10-08',
 fetchImpl:async()=>({ok:true,json:async()=>({chart:{result:[{
  meta:{symbol:'KRW=X',currency:'KRW',exchangeTimezoneName:'Europe/London'},
  timestamp:[Date.parse('2026-10-07T23:00:00Z')/1000],
  indicators:{quote:[{close:[1412]}]},
 }]}})}),
});
assert.deepEqual(fxDst.history.map(row=>row.date),['2026-10-08'],
 'London DST midnight candle must not be misdated to the prior UTC day');

assert.equal(fxDaily.source,'YAHOO_USDKRW_DELAYED_DAILY');
await assert.rejects(()=>fetchUsdKrwYahooDaily({from:'2026-10-07',to:'2026-10-09',
 fetchImpl:async()=>({ok:true,json:async()=>({chart:{result:[{...yahooFxPayload.chart.result[0],meta:{symbol:'JPY=X',currency:'JPY'}}]}})})}),/INVALID_SCHEMA/);
await assert.rejects(()=>fetchUsdKrwYahooDaily({from:'2026-10-10',to:'2026-10-07',fetchImpl:async()=>{throw Error('SHOULD_NOT_REQUEST');}}),/INVALID_RANGE/);
await assert.rejects(()=>fetchUsdKrwYahooDaily({from:'2026-10-07',to:'2026-10-09',
 fetchImpl:async()=>({ok:false,status:429})}),/FX_YAHOO_HTTP_429/);

let observations=[],snapshots=[],snapshotPosts=0,requestParams={};
const request=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots};
 if(action==='getBenchmarks'){requestParams.getBenchmarks=params;return {status:'ok',series:{KOSPI:[{date:prior,value:1,source:'KRX_OFFICIAL',observedAt:`${prior}T15:30:00+09:00`}],KOSDAQ:[{date:prior,value:1,source:'KRX_OFFICIAL',observedAt:`${prior}T15:30:00+09:00`}],KOSPI200:[{date:prior,value:1}],SP500:[{date:prior,value:1}],NASDAQ100:[{date:prior,value:1}],SOX:[{date:prior,value:1}],VIX:[{date:prior,value:1}]},seriesMeta:{KOSPI:{confirmedClose:true,source:'KRX_OFFICIAL'},KOSDAQ:{confirmedClose:true,source:'KRX_OFFICIAL'}}};}
 if(action==='getKrxK200NightClose'){
  requestParams.getKrxK200NightClose=params;
  const sourceDate=params.date;
  return {status:'ok',observation:{seriesId:'K200_NIGHT',tradingDate:sourceDate,sourceDate,value:350,
   market:'KRX',session:'NIGHT',source:'KRX_OFFICIAL',status:'FINAL',finality:'NIGHT_FINAL',
   observedAt:`${sourceDate}T06:00:00+09:00`,receivedAt:`${date}T06:15:00+09:00`}};
 }
 if(action==='getExchangeRateHistory'){requestParams.getExchangeRateHistory=params;return {status:'ok',history:[{date:prior,value:1380}]};}
 if(action==='getPrices')return {status:'ok',prices:{}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='appendMarketBriefingObservations'){{const rows=JSON.parse(params.data);observations.push(...rows);return {status:'ok',saved:rows.length,duplicates:0,rejected:0};}}
 if(action==='appendMarketBriefingSnapshot'){snapshotPosts++;const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
// Closed domestic session must not fabricate a regular close or mark a
// scheduled workflow as failed. EVENING still collects foreign/FX context.
const holidayRequest=async(action,params)=>{
 if(action==='getBenchmarks'){
   const data=await request(action,params);
   const series={...data.series};
   for(const key of ['SP500','NASDAQ100','SOX','VIX'])
     series[key]=[{date:'2026-10-08',value:1200,source:'YAHOO'}];
   return {...data,series};
 }
 if(action==='getExchangeRateHistory')
   return {status:'ok',history:[{date:'2026-10-08',value:1380}]};
 return request(action,params);
};
const shouldNeverFetch=()=>{throw new Error('CLOSED_KRX_FINAL_MUST_NOT_FETCH');};
const closedFinal=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:'2026-10-09',request:shouldNeverFetch});
assert.equal(closedFinal.skippedDomestic,true);
assert.equal(closedFinal.persistence,null);
assert.equal(diagnosticFor(closedFinal).status,'SKIPPED_DOMESTIC_CLOSED');
const closedEvening=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',request:holidayRequest});
assert.equal(closedEvening.skippedDomestic,true,'KRX 휴장 마감에는 정규장 확정 보고 보류');
assert.ok(closedEvening.sync,'해외/FX 원천 관측은 휴장일에도 계속 수집');
assert.equal(snapshots.length,0,'휴장일 동일 날짜 가짜 국내 마감 스냅샷 없음');
assert.equal(diagnosticFor(closedEvening).published,false);
assert.equal(closedEvening.successful,true,'FX and foreign context captured on domestic holiday');
const failedForeign=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:async(action,params)=>['getBenchmarks','getExchangeRateHistory'].includes(action)
   ? Promise.reject(new Error('SIMULATED_PROVIDER_OUTAGE')):request(action,params)});
assert.equal(failedForeign.successful,false,'all foreign/FX outages must fail the scheduled run');
assert.equal(headlessSucceeded(closedFinal),true,'휴장 KRX_FINAL은 정상 SKIPPED 처리');
assert.equal(headlessSucceeded(closedEvening),true,'해외/FX가 확보된 휴장 EVENING은 정상 성공');
assert.equal(diagnosticFor(failedForeign).status,'FOREIGN_CONTEXT_MISSING');

const vixOnly=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:async(action,params)=>{
   if(action==='getBenchmarks'){
     const original=await holidayRequest(action,params);
     return {...original,series:{VIX:original.series.VIX,SOX:original.series.SOX}};
   }
   return holidayRequest(action,params);
 }});
assert.equal(vixOnly.skippedDomestic,true);
assert.equal(vixOnly.successful,false,
  'VIX/SOX+FX without S&P500/NASDAQ100 must fail the closed-day checkpoint');
assert.equal(headlessSucceeded(vixOnly),false);
assert.equal(diagnosticFor(vixOnly).status,'FOREIGN_CONTEXT_MISSING');

const staleHolidayRequest=async(action,params)=>{
 if(action==='getBenchmarks'){
   const data=await holidayRequest(action,params);
   return {...data,series:{...data.series,
     SP500:[{date:'2026-09-30',value:1200,source:'YAHOO'}],
     NASDAQ100:[{date:'2026-10-01',value:1200,source:'YAHOO'}]}};
 }
 if(action==='getExchangeRateHistory')
   return {status:'ok',history:[{date:'2026-10-02',value:1380}]};
 return holidayRequest(action,params);
};
const staleAll=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',request:staleHolidayRequest});
assert.equal(staleAll.successful,false, 'old positive values cannot satisfy closed-day freshness');
assert.equal(headlessSucceeded(staleAll),false, 'stale US+FX must cause CLI failure');
const staleFx=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:(action,params)=>action==='getExchangeRateHistory'
   ? Promise.resolve({status:'ok',history:[{date:'2026-10-02',value:1380}]})
   : holidayRequest(action,params)});
assert.equal(staleFx.successful,false, 'fresh US but stale FX must fail');
const staleUs=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:(action,params)=>action==='getBenchmarks'
   ? staleHolidayRequest(action,params) : holidayRequest(action,params)});
assert.equal(staleUs.successful,false, 'stale US but fresh FX must fail');



for (const [mode, expectedStatus] of [
  ['', 0], ['FOREIGN', 1], ['FX', 1], ['BOTH', 1],
]) {
  const cli = spawnSync(process.execPath, [
    '--import', './scripts/mock-briefing-cli-fetch.mjs',
    'scripts/run-market-briefing-headless.mjs',
    '--checkpoint', 'EVENING', '--date', '2026-10-09',
  ], { cwd:process.cwd(), encoding:'utf8', timeout:20000, env:{
    ...process.env, BRIEFING_TEST_FAILURE:mode,
    GAS_WEB_APP_URL:'https://example.test/mock-gas',
    GAS_ACCESS_TOKEN:'test-only-token',
  } });
  assert.equal(cli.error,undefined, 'CLI process failed to launch: '+mode);
  assert.equal(cli.status,expectedStatus,
    'real scheduled CLI must return correct process exit status for '+(mode || 'SUCCESS')+'; stderr='+cli.stderr);
  const lines=cli.stdout.trim().split('\\n').filter(Boolean);
  const report=JSON.parse(lines.at(-1));
  assert.equal(report.status,mode ? 'FOREIGN_CONTEXT_MISSING':'SKIPPED_DOMESTIC_CLOSED');
  assert.equal(report.published,false, 'holiday must never publish false domestic snapshot');
  if (mode === 'FX' || mode === 'BOTH') assert.ok(report.missing.includes('USDKRW'));
  if (mode === 'FOREIGN' || mode === 'BOTH') assert.ok(report.missing.includes('SP500'));
}

assert.equal(headlessSucceeded(failedForeign),false,'휴장 EVENING 외국시장 또는 환율 수집 실패는 CLI exit 1');

const fxFallbackCalls=[];
const gasNoFx=async (action,params)=>action==='getExchangeRateHistory'
 ? Promise.reject(new Error('FX_MISSING_SOURCE')):holidayRequest(action,params);
const fallbackEvening=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:gasNoFx,fxFallback:async args=>{
  fxFallbackCalls.push(args);
  return {status:'ok',source:'YAHOO_USDKRW_DELAYED_DAILY',history:[{date:'2026-10-08',rate:1344.75,currency:'USD'}]};
 }});
assert.equal(fxFallbackCalls.length,1,'Only missing FX source triggers the fallback');
assert.equal(fxFallbackCalls[0].to,'2026-10-09');
assert.equal(fallbackEvening.sync.errors?.USDKRW,undefined,
 'Verified fallback must be ingested, not silently reported as missing FX');
const noDataFxCalls=[];
const gasEmptyFx=async (action,params)=>action==='getExchangeRateHistory'
 ? {status:'NO_DATA',history:[],source:'환율이력'}:holidayRequest(action,params);
const emptyFxEvening=await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:gasEmptyFx,fxFallback:async args=>{
  noDataFxCalls.push(args);
  return {status:'ok',source:'YAHOO_USDKRW_DELAYED_DAILY',
   history:[{date:'2026-10-08',rate:1344.75,currency:'USD'}]};
 }});
assert.equal(noDataFxCalls.length,1,'An explicitly empty FX ledger must use dated briefing-only fallback');
assert.equal(noDataFxCalls[0].to,'2026-10-09');
assert.equal(emptyFxEvening.sync.errors?.USDKRW,undefined,
 'A verified NO_DATA fallback must be consumed without altering the FX ledger');
let fallbackOnAuth=0;
await runHeadless({checkpoint:'EVENING',tradingDate:'2026-10-09',
 request:async (action,params)=>action==='getExchangeRateHistory'
  ? Promise.reject(new Error('GAS_HTTP_403')):request(action,params),
 fxFallback:async()=>{fallbackOnAuth++;throw Error('MUST_NOT_USE_FALLBACK');}});
assert.equal(fallbackOnAuth,0,'An auth failure must never be hidden by FX Yahoo fallback');

globalThis.localStorage.clear(); observations=[]; snapshots=[]; snapshotPosts=0;
let result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(result.decision.publishable,true,'same-session night final requires actual timely receipt');
assert.equal(requestParams.getKrxK200NightClose.date,date,'MORNING queries the session ending this morning');
const acceptedNight=result.decision.data.snapshot.values.K200_NIGHT;
assert.equal(acceptedNight.tradingDate,date,'briefing applicability date must remain today');
assert.equal(acceptedNight.sourceDate,date,'source BAS_DD must match night end date');
assert.equal(acceptedNight.observedAt,null,'GAS source-day 06:00 does not prove publication');
assert.equal(acceptedNight.timestampQuality,'RECEIVE_ONLY');
assert.equal(acceptedNight.receivedAt,new Date(`${date}T06:15:00+09:00`).toISOString(),
 'keep server receipt without backdating');
assert.equal(requestParams.getBenchmarks.to,prior,'MORNING benchmark는 전일까지 조회');
assert.equal(requestParams.getBenchmarks.fresh,'1','MORNING에서도 직전 KRX 정규장 종가를 강제 조회');
assert.equal(requestParams.getExchangeRateHistory.to,date,'MORNING FX는 당일까지 조회');
assert.equal(snapshots.length,1);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request});
assert.equal(snapshots.length,1,'동일 checkpoint snapshot은 중복 저장되지 않음');
assert.equal(snapshotPosts,2,'서버 immutable endpoint가 재실행을 idempotent 처리');
globalThis.localStorage.clear(); observations=[];snapshots=[];snapshotPosts=0;
const unverifiedTossMorning=async(action,params)=>action==='getBenchmarks'
 ? {status:'ok',series:{KOSPI:[{date:prior,value:3400,source:'TOSS'}],KOSDAQ:[{date:prior,value:900,source:'TOSS'}],KOSPI200:[{date:prior,value:1}],SP500:[{date:prior,value:1}],NASDAQ100:[{date:prior,value:1}],SOX:[{date:prior,value:1}],VIX:[{date:prior,value:1}]}}
 : request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:unverifiedTossMorning});
assert.equal(result.decision.publishable,false,'Toss 과거 미확정 candle로 장전 정규장 확정 종가 발행 금지');
assert.ok(result.decision.data.missing.includes('KOSPI') || result.decision.data.issues.includes('KOSPI:NOT_CONFIRMED_PREVIOUS_REGULAR_CLOSE'), 'Toss 미확정 종가는 누락 또는 확정 실패로 차단');
assert.equal(snapshots.length,0,'비확정 Toss 장전은 snapshot 기록 없음');
globalThis.localStorage.clear(); observations=[];snapshots=[];snapshotPosts=0;
result=await runHeadless({...parseArgs(['--checkpoint','NIGHT_FINAL','--date',date]),request});
assert.equal(result.successful,true,'manual NIGHT_FINAL exact-source collection must succeed');
assert.equal(requestParams.getKrxK200NightClose.date,date,
 'manual NIGHT_FINAL --date must not shift source BAS_DD backwards');
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request,
 schedule:'15 21 * * 0-4'});
assert.equal(requestParams.getKrxK200NightClose.date,date,
 '06:15 scheduled NIGHT_FINAL queries the current session end date');
assert.equal(result.successful,true,'scheduled NIGHT_FINAL must retain the briefing-day identity');
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request,
  requireKrxOfficialNight:true,schedule:'15 0 * * 1-5'});
assert.equal(requestParams.getKrxK200NightClose.date,date,
 '09:15 T+1 catch-up must fetch the requested source BAS_DD');
assert.equal(result.successful,true,'T+1는 요청한 정확한 날짜의 KRX 공식 종가로만 성공');
assert.ok(observations.some(row=>row.seriesId==='K200_NIGHT'&&row.finality==='NIGHT_FINAL'));
assert.equal(snapshotPosts,0,'NIGHT_FINAL은 snapshot을 저장하지 않음');
globalThis.localStorage.clear();observations=[];snapshots=[];
const wrongManualSource=async(action,params={})=>{
 const response=await request(action,params);
 return action==='getKrxK200NightClose'
  ? {...response,observation:{...response.observation,tradingDate:prior,sourceDate:prior}}
  : response;
};
result=await runHeadless({...parseArgs(['--checkpoint','NIGHT_FINAL','--date',date]),
 request:wrongManualSource});
assert.equal(result.successful,false,'wrong-date official reply must not satisfy manual recovery');
assert.equal(observations.filter(row=>row.seriesId==='K200_NIGHT').length,0,
 'wrong-date official reply must not be persisted as a confirmed night close');
globalThis.localStorage.clear(); observations=[];snapshots=[];
const missingNight=async(action,params)=>action==='getKrxK200NightClose'?{status:'ok',observation:null}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:missingNight});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'K200_NIGHT 누락 시 false publish 금지');
globalThis.localStorage.clear(); observations=[]; snapshots=[]; snapshotPosts=0;
const lateNight=async (action,params)=>{
 const response=await request(action,params);
 if(action==='getKrxK200NightClose')return {...response,observation:{...response.observation,
  receivedAt:`${date}T08:00:00+09:00`}};
 return response;
};
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:lateNight});
assert.equal(result.decision.publishable,false,'08:00 receipt is future to 07:30');
assert.equal(result.decision.data.missingReasons.K200_NIGHT,'RECEIVED_AFTER_CUTOFF');
assert.ok(result.decision.data.missing.includes('K200_NIGHT') ||
 result.decision.data.issues.some(x=>x.startsWith('K200_NIGHT')),
 'late official close must not retroactively mark 07:30 READY');
globalThis.localStorage.clear(); observations=[];snapshots=[];
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request:missingNight});
assert.equal(result.successful,false,'NIGHT_FINAL 누락은 scheduled CLI 실패 조건');assert.equal(snapshots.length,0);
result=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,
  request:missingNight,requireKrxOfficialNight:true});
assert.equal(result.successful,false,'T+1는 기존 저장된 다른 KIS 종가만으로 성공 금지');
globalThis.localStorage.clear(); observations=[];snapshots=[];
const scheduledFxRequest=async(action,params)=>action==='getExchangeRateHistory'
 ? {status:'ok',history:params.to===date?[{date,value:1390}]:[]}:request(action,params);
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:scheduledFxRequest,receivedAt:`${date}T07:31:00+09:00`});
assert.equal(result.decision.publishable,true);assert.equal(snapshots[0].values.USDKRW.value,1390);assert.equal(snapshots[0].values.USDKRW.receivedAt,'2026-09-17T22:31:00.000Z');
assert.ok(result.decision.data.warnings.includes('USDKRW:SCHEDULED_DELAY_TOLERANCE'));
globalThis.localStorage.clear(); observations=[];snapshots=[];
const finalRequest=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots};
 if(action==='getBenchmarks')return {status:'ok',series:{KOSPI:[{date,value:3400,source:'KRX_OFFICIAL',observedAt:`${date}T15:30:00+09:00`}],KOSDAQ:[{date,value:900,source:'KRX_OFFICIAL',observedAt:`${date}T15:30:00+09:00`}]},seriesMeta:{KOSPI:{confirmedClose:true,source:'KRX_OFFICIAL'},KOSDAQ:{confirmedClose:true,source:'KRX_OFFICIAL'}}};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[{date:prior,value:1380}]};
 if(action==='getPrices')return {status:'ok',prices:{'005930':81000,'000660':190000},priceDates:{'005930':date,'000660':date}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='getKrxOfficialStockCloses')return {status:'ok',closes:{'005930':{code:'005930',price:80500,usedDate:date,source:'KRX_OFFICIAL',receivedAt:`${date}T16:05:00+09:00`},'000660':{code:'000660',price:188000,usedDate:date,source:'KRX_OFFICIAL',receivedAt:`${date}T16:05:00+09:00`}}};
 if(action==='appendMarketBriefingObservations'){{const rows=JSON.parse(params.data);observations.push(...rows);return {status:'ok',saved:rows.length,duplicates:0,rejected:0};}}
 if(action==='appendMarketBriefingSnapshot'){const row=JSON.parse(params.data);if(!snapshots.some(x=>x.tradingDate===row.tradingDate&&x.checkpoint===row.checkpoint))snapshots.push(row);return {status:'ok',saved:1};}
 throw new Error(`unexpected ${action}`);
};
result=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,request:finalRequest,receivedAt:`${date}T16:05:00+09:00`});
assert.equal(result.decision.publishable,true,'가격이력 없이 exact-date KRX 종가로 KRX_FINAL publish 가능');
assert.equal(snapshots[0].values.SAMSUNG.finality,'REGULAR_CLOSE');assert.equal(snapshots[0].values.SKHYNIX.source,'KRX_OFFICIAL');
globalThis.localStorage.clear(); observations=[]; snapshots=[];
const t1CloseDate=date; // Existing 08:45 KRX held probe supplies its prior-OPEN target date.
// A next-morning quote cannot be recorded as if it had been available
// at the previous day's 15:30 immutable snapshot cut-off.
const t1Actions=[];
const t1ReadOnlyRequest=async (action,params={})=>{
 t1Actions.push(action);
 if(action==='getBenchmarks'){
  const base=await finalRequest(action,params);
  return {...base,seriesMeta:Object.fromEntries(['KOSPI','KOSDAQ'].map(key=>[key,
   {...base.seriesMeta[key],source:'KRX_OFFICIAL',officialDate:date}]))};
 }
 if(action==='getKrxOfficialStockCloses'){
  const base=await finalRequest(action,params);
  return {...base,requestedDate:date,closes:Object.fromEntries(
   Object.entries(base.closes).map(([code,row])=>[code,
    {...row,requestedDate:date,providerSource:'KRX'}]))};
 }
 throw new Error('T1_WRITE_OR_UNNECESSARY_READ_FORBIDDEN');
};
result=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:t1CloseDate,request:t1ReadOnlyRequest,
  sourceReadOnlyT1:true,receivedAt:'2026-09-21T09:45:30+09:00'});
assert.equal(result.sourceReadOnly,true,'T+1는 소급 15:30 발행이 아닌 공식 원천 확인');
assert.equal(result.successful,true,'정확일 공식 지수/종목 소스 4개 인증');
assert.deepEqual(t1Actions.sort(),['getBenchmarks','getKrxOfficialStockCloses']);
assert.equal(diagnosticFor(result).published,false,'익일 확인을 전일 발행으로 표시 금지');
assert.equal(diagnosticFor(result).writesPerformed,0,'원본 MASTER/SNAPSHOT 쓰기 금지');
assert.equal(snapshots.length,0,'T+1 소급 Snapshot 생성 금지');
assert.equal(observations.length,0,'T+1 MASTER append 금지');
const staleOfficial=async (action,params)=>{
 const response=await t1ReadOnlyRequest(action,params);
 if(action==='getBenchmarks')
  return {...response,seriesMeta:{...response.seriesMeta,
   KOSPI:{...response.seriesMeta.KOSPI,officialDate:prior}}};
 return response;
};
const staleResult=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,
 request:staleOfficial,sourceReadOnlyT1:true});
assert.equal(staleResult.successful,false,'전일보다 오래된 officialDate를 승인하지 않음');
assert.equal(headlessSucceeded(staleResult),false,'누락 소스는 실패로 남음');
const missingOfficial=async (action,params)=>{
 const response=await t1ReadOnlyRequest(action,params);
 if(action==='getKrxOfficialStockCloses')
  return {...response,closes:{'005930':response.closes['005930']}};
 return response;
};
const incompleteT1=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,
 request:missingOfficial,sourceReadOnlyT1:true});
assert.equal(incompleteT1.successful,false,'한 종목 공식 숫자 누락 시 실패');
assert.equal(snapshots.length,0,'실패 이후에도 소급 발행 금지');
await assert.rejects(()=>runHeadless({checkpoint:'MORNING',tradingDate:date,
 request:t1ReadOnlyRequest,sourceReadOnlyT1:true}),/T1_KRX_CHECKPOINT_MISMATCH/,
 'T+1 source read-only cannot be invoked under other checkpoint');
assert.throws(()=>parseArgs(['--checkpoint','KRX_FINAL','--schedule','45 0 * * 1-5']),
 /schedule과 checkpoint가 일치하지 않습니다/,'중복된 T+1 09:45 slot은 완전히 삭제');
assert.doesNotMatch(fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8'),
 /cron: '45 0 \* \* 1-5'/,'기존 08:45 재사용, 신규 09:45 cron 금지');
result=await runHeadless({checkpoint:'EVENING',tradingDate:date,request:finalRequest,receivedAt:`${date}T20:15:30+09:00`});
assert.equal(result.decision.publishable,true);assert.equal(snapshots.find(row=>row.checkpoint==='EVENING').values.SAMSUNG.value,80500);
globalThis.localStorage.clear(); observations=[];snapshots=[];
const oneStockMissing=async(action,params)=>action==='getKrxOfficialStockCloses'?{status:'ok',closes:{'005930':{code:'005930',price:80500,usedDate:date,source:'KRX_OFFICIAL'}}}:finalRequest(action,params);
result=await runHeadless({checkpoint:'KRX_FINAL',tradingDate:date,request:oneStockMissing,receivedAt:`${date}T16:05:00+09:00`});
assert.equal(result.decision.publishable,false);assert.equal(snapshots.length,0,'한 종목 공식 종가 실패 시 snapshot 차단');
result=await runHeadless({checkpoint:'EVENING',tradingDate:date,request:oneStockMissing,receivedAt:`${date}T20:15:30+09:00`});
assert.equal(result.decision.publishable,false,'EVENING NOT_READY도 scheduled CLI 실패 조건');

// hydrate 이후에는 이번 collect가 추가한 observation만 POST하고 실패 시 hydrate 상태로 되돌린다.
const hydrated=Array.from({length:100},(_,index)=>({seriesId:`SERVER_${index}`,tradingDate:date,value:index+1,market:'TEST',session:'REGULAR',source:'SERVER',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:`${date}T00:00:00.000Z`,receivedAt:`${date}T00:${String(index%60).padStart(2,'0')}:${String(Math.floor(index/60)).padStart(2,'0')}.000Z`}));
const fivePayload={KOSPI:{value:1,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},KOSDAQ:{value:2,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},KOSPI200:{value:3,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},SP500:{value:4,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'},NASDAQ100:{value:5,tradingDate:prior,sourceDate:prior,status:'FINAL',finality:'REGULAR_CLOSE'}};
let postedRows=[];
const persistenceRequest=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations:hydrated};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots:[]};
 if(action==='getBenchmarks')return {status:'ok',series:Object.fromEntries(Object.entries(fivePayload).map(([key,row])=>[key,[{date:row.tradingDate,value:row.value}]]))};
 if(action==='getExchangeRateHistory')return {status:'ok',history:[]};
 if(action==='getPrices')return {status:'ok',prices:{}};
 if(action==='getPriceHistory')return {status:'ok',prices:{}};
 if(action==='appendMarketBriefingObservations'){postedRows=JSON.parse(params.data);return {status:'ok',saved:postedRows.length-2,duplicates:2,rejected:0};}
 throw new Error(`unexpected ${action}`);
};
globalThis.localStorage.clear();
const collected=await globalThis.MarketBriefingRuntime.collectExistingProvider(persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.ok(Array.isArray(collected.observations),'collectAndIngest observations는 배열');
assert.equal(collected.state.version,1,'collectAndIngest state는 전체 runtime state');
assert.equal('rows' in collected,false,'state 객체를 rows로 노출하지 않음');
globalThis.localStorage.clear();
await globalThis.MarketBriefingRuntime.syncServerMaster(persistenceRequest,persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.equal(postedRows.length,5,'hydrate 100건은 제외하고 신규 5건만 POST');
assert.equal(JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations.length,105,'duplicates 포함 정상 POST는 성공');
const pending=globalThis.MarketBriefingMaster.normalizeObservation({seriesId:'PENDING',tradingDate:date,value:7,market:'TEST',session:'REGULAR',source:'LOCAL',status:'PARTIAL',observedAt:`${date}T10:00:00+09:00`,receivedAt:`${date}T10:00:01+09:00`});
const outside=globalThis.MarketBriefingMaster.normalizeObservation({seriesId:'OUTSIDE',tradingDate:'2026-09-01',value:8,market:'TEST',session:'REGULAR',source:'LOCAL',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:'2026-09-01T10:00:00+09:00',receivedAt:'2026-09-01T10:00:01+09:00'});
const seedPending=()=>globalThis.MarketBriefingRuntimeStore.save(globalThis.localStorage,{version:1,observations:[pending,outside],snapshots:[]});
const partialReject=async(action,params)=>action==='appendMarketBriefingObservations'?{status:'ok',saved:5,duplicates:0,rejected:1}:persistenceRequest(action,params);
globalThis.localStorage.clear();seedPending();
await assert.rejects(()=>globalThis.MarketBriefingRuntime.syncServerMaster(partialReject,partialReject,date,{checkpoint:'EVENING',from:prior}),/부분 저장 실패/);
let rolledBack=JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations;
assert.equal(rolledBack.length,102,'부분 reject 시 신규 5건만 rollback');
assert.ok(rolledBack.some(row=>row.seriesId==='PENDING'),'기존 pending observation 보존');
await globalThis.MarketBriefingRuntime.syncServerMaster(persistenceRequest,persistenceRequest,date,{checkpoint:'EVENING',from:prior});
assert.equal(postedRows.length,6,'서버 100건 + pending 1건 + 신규 5건은 6건 POST');
assert.ok(postedRows.some(row=>row.seriesId==='PENDING'),'다음 정상 sync에서 pending 재시도');
assert.ok(!postedRows.some(row=>row.seriesId==='OUTSIDE'),'sync 범위 밖 local observation은 POST 제외');
const postFailure=async(action,params)=>action==='appendMarketBriefingObservations'?Promise.reject(new Error('POST_DOWN')):persistenceRequest(action,params);
globalThis.localStorage.clear();seedPending();
await assert.rejects(()=>globalThis.MarketBriefingRuntime.syncServerMaster(postFailure,postFailure,date,{checkpoint:'EVENING',from:prior}),/POST_DOWN/);
rolledBack=JSON.parse(globalThis.localStorage.getItem('portfolio.marketBriefing.v1')).observations;
assert.equal(rolledBack.length,102,'POST 실패 시 신규 5건 rollback 및 hydrate 상태 유지');
assert.ok(rolledBack.some(row=>row.seriesId==='PENDING'),'POST 실패 후 pending 보존');

// cold-start에서도 서버의 NIGHT_FINAL을 우선 보존하여 공급자 재조회 실패를 견딘다.
const storedNight={seriesId:'K200_NIGHT',tradingDate:date,sourceDate:date,value:351,
 market:'KRX',session:'NIGHT',source:'KRX_OFFICIAL',status:'FINAL',
 finality:'NIGHT_FINAL',observedAt:null,receivedAt:`${date}T06:01:00+09:00`,
 fallback:false,quality:'KRX_NIGHT_ACTUAL_RECEIPT'};
const coldStart=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations:[storedNight]};
 if(action==='getMarketBriefingSnapshots')return {status:'ok',snapshots:[]};
 if(action==='getKrxK200NightClose')throw new Error('KRX_RETRY_DOWN');
 return request(action,params);
};
globalThis.localStorage.clear();observations=[];snapshots=[];
result=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:coldStart});
assert.equal(result.decision.publishable,true,'서버 저장 K200_NIGHT는 재조회 실패 후에도 사용');
// Credentialed MARKET_MASTER / MARKET_SNAPSHOTS publishing must be
// restricted to main's scheduled/manual invocation. A feature branch can
// otherwise use workflow_dispatch with production GAS credentials.
const workflow=fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8');
const guard="github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')";
const schedules=['30 7 * * 1-5','15 11 * * 1-5'];
const fnv32=str=>{
 let h=2166136261;
 for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619)>>>0;
 return h.toString(16).padStart(8,'0');
};
function validateBriefingWorkflow(source){
 const doc=YAML.parseDocument(source,{uniqueKeys:true,version:'1.2'});
 assert.equal(doc.errors.length,0,'Briefing YAML parses without duplicate keys');
 const wf=doc.toJS({maxAliasCount:0});
 assert.deepEqual(wf.on.workflow_dispatch.inputs.mode.options,['rescue','connection_test','late_test']);
 assert.deepEqual(wf.on.schedule.map(x=>x.cron),schedules,'NH-only night: KRX headless night cron removed');
 assert.ok(Object.hasOwn(wf.on,'workflow_dispatch'),'manual route preserved');
 assert.deepEqual(wf.on.workflow_dispatch.inputs.checkpoint.options,
   ['KRX_FINAL','EVENING'],'no manual KRX night revalidation');
 assert.ok(!String(source).includes('checkpoint=NIGHT_FINAL'),'no KRX night cron mapping');
 assert.ok(!Object.hasOwn(wf.on,'push'),'no push event with production credentials');
 assert.equal(wf.permissions.contents,'read');
 assert.equal(wf.permissions.actions,'read');
 assert.deepEqual(Object.keys(wf.jobs),['briefing'],'no unguarded credentialed job');
 const job=wf.jobs.briefing;
 assert.equal(job.if,guard,'production GAS job must be main schedule/manual only');
 assert.equal(job.env,undefined,'no job-wide credential propagation');
 assert.equal(job.steps.length,3,'no additional unaudited steps');
 const credentialed=job.steps.filter(step=>
   String(step.env?.GAS_ACCESS_TOKEN||'').includes('secrets.GAS_ACCESS_TOKEN'));
 assert.equal(credentialed.length,1,'one credentialed market briefing step');
 const step=credentialed[0];
 assert.deepEqual(Object.keys(step.env).sort(),
  ['GAS_ACCESS_TOKEN','GAS_WEB_APP_URL','GH_API_URL','GH_REPOSITORY',
   'GH_RUN_ID','GH_TOKEN','MANUAL_CHECKPOINT','MANUAL_DATE','RUN_SCHEDULE'].sort(),
  'no unapproved recovery/apply configuration');
 const dollar=String.fromCharCode(36);
 assert.equal(step.env.GAS_ACCESS_TOKEN,dollar+'{{ secrets.GAS_ACCESS_TOKEN }}');
 assert.equal(step.env.GAS_WEB_APP_URL,dollar+'{{ vars.GAS_WEB_APP_URL }}');
 assert.equal(step.env.GH_TOKEN,dollar+'{{ github.token }}');
 // Regression fingerprint for the exact reviewed shell block, including
 // safe cron-to-checkpoint mapping and a single headless execution command.
 // Any added recovery command must fail this offline contract.
 assert.equal(fnv32(String(step.run||'').trim()),'193064af',
  'single approved briefing shell script only');
}
validateBriefingWorkflow(workflow);
for(const weaker of [
 "github.event_name == 'workflow_dispatch'",
 "github.ref == 'refs/heads/main'",
 "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')"
]){
 const changed=workflow.replace(guard,weaker);
 assert.notEqual(changed,workflow,'guard mutation must alter actual YAML');
 assert.throws(()=>validateBriefingWorkflow(changed),/main schedule\/manual only/);
}
const approvedShellEnd='node scripts/run-market-briefing-headless.mjs "${args[@]}"';
const mutation=workflow.replace(approvedShellEnd,approvedShellEnd+
 '\n          node scripts/run-krx-targeted-recovery.mjs');
assert.notEqual(mutation,workflow,'writer injection mutation must alter workflow');
assert.throws(()=>validateBriefingWorkflow(mutation),
 /single approved briefing shell script only/);
const credentials='          GAS_ACCESS_TOKEN: '+String.fromCharCode(36)+
 '{{ secrets.GAS_ACCESS_TOKEN }}';
const injectedEnv=workflow.replace(credentials,credentials+'\n          RECOVERY_APPLY: "true"');
assert.notEqual(injectedEnv,workflow,'recovery env mutation must alter workflow');
assert.throws(()=>validateBriefingWorkflow(injectedEnv),
 /no unapproved recovery\/apply configuration/);
const runner=fs.readFileSync('scripts/run-market-briefing-headless.mjs','utf8');assert.doesNotMatch(runner,/console\.log\([^\n]*(?:token|url)/i);
for(const field of ['masterPersistence','snapshotPersistence','readinessSeries']) assert.match(runner,new RegExp(field),'최종 diagnostic 필드 복원: '+field);
console.log('브리핑 headless hydrate·collect·readiness·immutable snapshot 회귀검사 통과');

// Old-session BAS_DD must never become this morning's confirmed night close.
globalThis.localStorage.clear();observations=[];snapshots=[];
const wrongMorning=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:wrongManualSource});
assert.equal(wrongMorning.decision.publishable,false);
assert.equal(wrongMorning.decision.data.missingReasons.K200_NIGHT,'EXACT_NIGHT_SESSION_NOT_AVAILABLE');
assert.equal(snapshots.length,0);

// Feed the actual production NIGHT_FINAL output into a cold MORNING run.
globalThis.localStorage.clear();observations=[];snapshots=[];
const earlyNight=await runHeadless({checkpoint:'NIGHT_FINAL',tradingDate:date,request,schedule:'15 21 * * 0-4'});
assert.equal(earlyNight.successful,true);
const earlyRows=observations.filter(row=>row.seriesId==='K200_NIGHT').map(row=>({...row}));
assert.equal(earlyRows.length,1);
assert.equal(earlyRows[0].quality,'KRX_NIGHT_ACTUAL_RECEIPT');
assert.equal(earlyRows[0].sourceDate,date);
globalThis.localStorage.clear();observations=[];snapshots=[];
const earlyColdRequest=async(action,params={})=>{
 if(action==='getMarketBriefingMaster')return {status:'ok',observations:earlyRows};
 if(action==='getKrxK200NightClose')throw Error('SOURCE_TEMPORARILY_DOWN');
 return request(action,params);
};
const earlyColdMorning=await runHeadless({checkpoint:'MORNING',tradingDate:date,request:earlyColdRequest});
assert.equal(earlyColdMorning.decision.publishable,true,'timely production NIGHT_FINAL survives a failed MORNING re-fetch');
assert.equal(earlyColdMorning.decision.data.snapshot.values.K200_NIGHT.receivedAt,earlyRows[0].receivedAt);

// Repeated schedule opportunities share a durable, pre-send delivery claim.
{
 const {prepareMorning,deliverPrepared}=await import('./telegram-morning-workflow.mjs');
 const now=()=>new Date('2026-10-28T07:50:00+09:00');let preparations=0,sends=0;
 const options={now,githubToken:'SECRET',repository:'cyyoung111-dev/portfolio',run:async({send})=>{preparations++;await send(null,null,'시장 요약');return {status:'SENT_SOURCE_MISSING'};}};
 const mock=(count,artifacts=[])=>async(url,opts)=>{assert.match(url,/api.github.com\/repos\/cyyoung111-dev\/portfolio\/actions\/artifacts/);assert.equal(opts.headers.authorization,'Bearer SECRET');return {ok:true,json:async()=>({total_count:count,artifacts})};};
 const prepared=await prepareMorning({...options,fetchImpl:mock(0)});
 assert.equal(prepared.ready,true);assert.equal(prepared.artifactName,'telegram-morning-claim-2026-10-28');
 const captured={...tflRef,receivedAt:'2026-10-28T07:30:30+09:00'};
 let consumed;
 const preparedWithCapture=await prepareMorning({...options,fetchImpl:mock(0),loadReference:async()=>captured,
   run:async({send,referenceFetch})=>{consumed=await referenceFetch();await send(null,null,'시장 요약');return {status:'SENT_REFERENCE',referenceSource:consumed.source};}});
 assert.equal(consumed,captured);assert.equal(preparedWithCapture.referenceSource,'NH');
 const skipped=await prepareMorning({...options,fetchImpl:mock(1,[{name:prepared.artifactName}])});
 assert.equal(skipped.status,'ALREADY_CLAIMED');assert.equal(preparations,1,'fallback schedule must not rebuild or send after a claim');
 await assert.rejects(()=>prepareMorning({...options,fetchImpl:async()=>{throw Error('SECRET');}}),/TELEGRAM_CLAIM_LOOKUP_FAILED/);
 await assert.rejects(()=>prepareMorning({...options,attempt:2,fetchImpl:mock(0)}),/TELEGRAM_WORKFLOW_CONFIG/);
 const fallbackNow=()=>new Date('2026-10-28T08:00:00+09:00');
 assert.equal((await prepareMorning({...options,now:fallbackNow,fetchImpl:mock(1,[{name:prepared.artifactName}])})).status,'ALREADY_CLAIMED');
 assert.equal((await prepareMorning({...options,now:fallbackNow,fetchImpl:mock(0)})).ready,true,'no first claim permits fallback');
 await assert.rejects(()=>prepareMorning({...options,now:()=>new Date('2026-10-28T08:10:00+09:00'),fetchImpl:mock(0)}),/TELEGRAM_SCHEDULE_LATE/);
 await assert.rejects(()=>prepareMorning({...options,fetchImpl:mock(1,[])}),/TELEGRAM_CLAIM_SCHEMA/);
 assert.equal((await deliverPrepared(prepared,{now,send:async()=>{sends++;}})).status,'SENT');assert.equal(sends,1);
 await assert.rejects(()=>deliverPrepared({...prepared,date:'2026-10-27'},{now,send:async()=>{sends++;}}),/TELEGRAM_PREPARED_INVALID/);
 await assert.rejects(()=>deliverPrepared(prepared,{now,attempt:2,send:async()=>{sends++;}}),/TELEGRAM_PREPARED_INVALID/);
 await assert.rejects(()=>deliverPrepared(prepared,{now:()=>new Date('2026-10-28T08:10:00+09:00'),send:async()=>{sends++;}}),/TELEGRAM_PREPARED_INVALID/);
 assert.equal(sends,1,'late or stale payload cannot send');
 // Full-message late test is explicitly selected and cannot relax the regular schedule.
 const {lateTestWindow}=await import('./telegram-morning-briefing.mjs');
 const lateNow=()=>new Date('2026-10-28T09:40:00+09:00');
 assert.equal(lateTestWindow(lateNow()).allowed,true);
 assert.equal(lateTestWindow(new Date('2026-10-28T08:09:59+09:00')).allowed,false);
 assert.equal(lateTestWindow(new Date('2026-10-28T12:00:00+09:00')).allowed,false);
 assert.equal(lateTestWindow(new Date('2026-11-01T09:40:00+09:00')).allowed,false);
 const lateOpts={...options,now:lateNow,mode:'late_test',loadReference:async()=>null,
   run:async({allowLateTest,send})=>{assert.equal(allowLateTest,true);await send(null,null,'검증용 시장 요약');return {status:'SENT_SOURCE_MISSING'};}};
 const late=await prepareMorning({...lateOpts,fetchImpl:mock(0)});
 assert.equal(late.ready,true);assert.equal(late.mode,'late_test');
 assert.equal(late.artifactName,prepared.artifactName,'late test shares the dated production claim');
 assert.match(late.message,/^\\[수동 지연 발송 테스트/);
 assert.equal((await prepareMorning({...lateOpts,fetchImpl:mock(1,[{name:late.artifactName}])})).status,'ALREADY_CLAIMED');
 await assert.rejects(()=>prepareMorning({...options,now:lateNow,fetchImpl:mock(0)}),/TELEGRAM_SCHEDULE_LATE/);
 await assert.rejects(()=>prepareMorning({...lateOpts,now:()=>new Date('2026-10-28T12:00:00+09:00'),fetchImpl:mock(0)}),/TELEGRAM_SCHEDULE_LATE/);
 await assert.rejects(()=>deliverPrepared(late,{now:lateNow,send:async()=>assert.fail('missing mode must not send')}),/TELEGRAM_PREPARED_INVALID/);
 await assert.rejects(()=>deliverPrepared(prepared,{now:lateNow,mode:'late_test',send:async()=>assert.fail('normal payload must not be retagged')}),/TELEGRAM_PREPARED_INVALID/);
 let lateSends=0;
 assert.equal((await deliverPrepared(late,{now:lateNow,mode:'late_test',send:async()=>{lateSends++;}})).status,'SENT');
 await assert.rejects(()=>deliverPrepared(late,{now:()=>new Date('2026-10-28T12:00:00+09:00'),mode:'late_test',send:async()=>{lateSends++;}}),/TELEGRAM_PREPARED_INVALID/);
 assert.equal(lateSends,1);
 const wf=YAML.parse(fs.readFileSync('.github/workflows/telegram-morning-briefing.yml','utf8'));
 assert.deepEqual(wf.on.schedule.map(x=>x.cron),['40 22 * * 0-4','49 22 * * 0-4','57 22 * * 0-4','0 23 * * 0-4','5 23 * * 0-4']);
 const captureWf=YAML.parse(fs.readFileSync('.github/workflows/nh-night-capture.yml','utf8'));
 assert.deepEqual(captureWf.on.schedule.map(x=>x.cron),['31 22 * * 0-4','39 22 * * 0-4','47 22 * * 0-4','55 22 * * 0-4']);
 assert.equal(captureWf.permissions.contents,'read');
 assert.equal(captureWf.permissions.actions,'read');
 const priorStep=captureWf.jobs.capture.steps.find(x=>x.id==='prior');
 assert.match(priorStep.run,/actions\/artifacts\?name=nh-night-reference-/);
 assert.match(priorStep.run,/run_capture=false/);
 assert.match(priorStep.run,/run_capture=true/);
 assert.equal(captureWf.jobs.capture.steps.find(x=>x.id==='capture').if,"steps.prior.outputs.run_capture == 'true'");
 assert.match(captureWf.jobs.capture.if,/github\.ref == 'refs\/heads\/main'/);
 assert.equal(captureWf.jobs.capture.steps.at(-1).with['include-hidden-files'],true);
 assert.equal(wf.concurrency['cancel-in-progress'],false);
 const steps=wf.jobs.briefing.steps,claim=steps.findIndex(s=>s.uses==='actions/upload-artifact@v4'),send=steps.findIndex(s=>s.run==='node scripts/telegram-morning-workflow.mjs send');
 assert.ok(claim>0&&send>claim);assert.equal(steps[claim].with['if-no-files-found'],'error');assert.equal(steps[claim].with['retention-days'],14);
 assert.equal(steps[claim].with['include-hidden-files'],true);
 assert.ok(!String(steps[send].if).includes('always'),'a failed claim upload must block delivery');
}
