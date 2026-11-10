import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MORNING_SERIES} from './telegram-morning-report.mjs';
import {CLOSE_SOURCE_CATALOG,MORNING_NOT_CONNECTED,
  summarizeCloseCoverage,formatCloseCoverageSummary,
  closeQualityDecision} from './briefing-source-coverage.mjs';
import {formatClose,prepareClose} from './telegram-close-workflow.mjs';
import {runClosingGapAudit,kstAuditSession} from './audit-briefing-source-gaps-readonly.mjs';
import {compareKrxPriorSession,previousOpenKrxDay}
 from './compare-briefing-krx-prior-readonly.mjs';

const date='2026-10-30',prev='2026-10-29',now=()=>new Date(date+'T17:00:00+09:00');
const nh=[
 {label:'S&P 500',symbol:'^GSPC',date:prev,value:7720.39,changePercent:0.5,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:prev,value:26184.72,changePercent:1.2,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:prev,value:29402.51,changePercent:1.1,source:'NH_INDEX_DAILY'}
];
const domestic=[
 {type:'KOSPI',label:'KOSPI',date,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',
 priceType:'PUBLISHED_EOD_REFERENCE',value:5668.26,changePercent:-4.54},
 {type:'KOSDAQ',label:'KOSDAQ',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',
 priceType:'CONFIRMED_REGULAR_CLOSE',value:723.15,changePercent:-3.99},
 {type:'KOSPI200',label:'KOSPI 200',date,source:'KRX_OFFICIAL',role:'NON_NH_DAILY_INDEX',
 priceType:'CONFIRMED_REGULAR_CLOSE',value:890.07,changePercent:-4.89}
];
const refs=[
 {label:'다우존스',source:'FRED_DJIA',role:'NON_NH_REFERENCE_ONLY',date:prev,value:51500},
 {label:'SOX',source:'FRED_NASDAQSOX',role:'NON_NH_REFERENCE_ONLY',date:prev,value:11518.20},
 {label:'VIX',source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',date:prev,value:18.25}
];
const summary=summarizeCloseCoverage(date,{nh,domestic,secondary:refs,expectedUsDate:prev});
assert.deepEqual(summary.core,{verified:6,total:6,domestic:3,us:3});
assert.deepEqual(summary.reference,{verified:3,total:3});
assert.equal(summary.groupErrors.length,0);
assert.equal(closeQualityDecision(summary).fullCoreCoverage,true);
assert.equal(summary.statuses.filter(x=>x.status==='NOT_CONNECTED').length,
 CLOSE_SOURCE_CATALOG.notConnected.length);
assert.equal(new Set(summary.statuses.map(x=>x.id)).size,summary.statuses.length);
assert.equal(summary.statuses.some(x=>x.id==='VKOSPI'&&x.status==='NO_VERIFIED_ROW'),true);
assert.deepEqual(summary.volatility,{verified:0,total:1});
for(const id of ['SAMSUNG','SKHYNIX','NVDA','MU','USDKRW','DXY','UST10Y'])
 assert.equal(summary.statuses.find(x=>x.id===id)?.status,'NO_VERIFIED_ROW',id);
for(const id of ['WTI','BRENT','GOLD','COPPER','BTC'])
 assert.equal(summary.statuses.find(x=>x.id===id)?.status,'NO_VERIFIED_ROW',id);
assert.deepEqual(summary.markets,{verified:0,total:5});
assert.deepEqual(summary.stocks,{verified:0,total:4});
assert.deepEqual(summary.macros,{verified:0,total:3});
const qc=formatCloseCoverageSummary(summary);
assert.match(qc,/핵심지수 6\/6 \(국내 3\/3 · 미국 3\/3\) · 참고 3\/3/);
assert.match(qc,/미연결 참고지표: \d+개/);
assert.match(qc,/미확보: 삼성전자/);
assert.doesNotMatch(qc,/NO_VERIFIED_ROW|NOT_CONNECTED|FETCH_FAILED/,'internal reason codes must not clutter Telegram');
assert.ok(!qc.includes('7720.39'),'operational log emits only status not provider numbers');
assert.ok(formatClose(date,nh,refs,domestic).includes(qc));

const missing=summarizeCloseCoverage(date,{
 nh:nh.slice(0,1),domestic:domestic.slice(0,1),
 secondary:[{...refs[0],date:'2026-10-28'},refs[1]],
 expectedUsDate:prev,failedGroups:['NH','SECONDARY']
});
assert.deepEqual(missing.core,{verified:2,total:6,domestic:1,us:1});
assert.equal(missing.statuses.find(x=>x.id==='KOSDAQ').status,'NO_VERIFIED_ROW');
assert.equal(missing.statuses.find(x=>x.id==='NASDAQ').status,'FETCH_FAILED');
assert.equal(missing.statuses.find(x=>x.id==='DOW').status,'FETCH_FAILED');
assert.equal(missing.statuses.find(x=>x.id==='SOX').status,'VERIFIED');
assert.equal(closeQualityDecision(missing).fullCoreCoverage,false);
assert.equal(closeQualityDecision(missing).currentDeliveryGateSatisfied,true,
 'coverage instrumentation must not silently alter production delivery policy');
const empty=summarizeCloseCoverage(date,{expectedUsDate:prev});
assert.equal(empty.core.verified,0);
assert.equal(closeQualityDecision(empty).currentDeliveryGateSatisfied,false);
for(const bad of [
 {failedGroups:['PRIVATE_AUTH_TOKEN']},{nh:{},failedGroups:[]},
 {expectedUsDate:'10/29/2026'},{secondary:null}
 ])assert.throws(()=>summarizeCloseCoverage(date,bad),/COVERAGE_INPUT_INVALID/);

// FRED H.15 observations may appear a publication day late. The formatter
// already accepts the immediate prior US weekday and labels its actual date;
// the coverage score must agree, but never mix two different rate dates.
const laggedDate='2026-11-06',expectedUs='2026-11-05';
const priorH15=[
 {id:'UST2Y',label:'미 국채 2년',date:'2026-11-04',value:3.8,source:'FRED_H15_DAILY'},
 {id:'UST3Y',label:'미 국채 3년',date:'2026-11-04',value:3.9,source:'FRED_H15_DAILY'},
 {id:'UST10Y_FRED',label:'미 국채 10년',date:'2026-11-04',value:4.2,source:'FRED_H15_DAILY'}
];
const lagged=summarizeCloseCoverage(laggedDate,{
 expectedUsDate:expectedUs,rates:priorH15
});
assert.deepEqual(lagged.treasury,{verified:3,total:3});
for(const id of ['UST2Y','UST3Y','YIELD_SPREAD'])
 assert.equal(lagged.statuses.find(x=>x.id===id)?.status,'VERIFIED',id);
assert.match(formatCloseCoverageSummary(lagged),/국채금리·스프레드 3\/3/);
const mixedRates=summarizeCloseCoverage(laggedDate,{
 expectedUsDate:expectedUs,
 rates:priorH15.map(x=>x.id==='UST10Y_FRED'?{...x,date:expectedUs}:x)
});
assert.equal(mixedRates.treasury.verified,2,
 'cross-date 10Y-2Y spread must remain unverified');
assert.equal(mixedRates.statuses.find(x=>x.id==='YIELD_SPREAD').status,'NO_VERIFIED_ROW');
const tooOld=summarizeCloseCoverage(laggedDate,{
 expectedUsDate:expectedUs,rates:priorH15.map(x=>({...x,date:'2026-11-03'}))
});
assert.equal(tooOld.treasury.verified,0,'older H.15 cannot be accepted as current');
const repeatedRates=summarizeCloseCoverage(laggedDate,{
 expectedUsDate:expectedUs,rates:[...priorH15,priorH15[0]]
});
assert.equal(repeatedRates.treasury.verified,0,'ambiguous H.15 must fail closed');

const meta=JSON.stringify(summary);
assert.ok(!meta.includes('7720.39')&&!meta.includes('PRIVATE_AUTH_TOKEN'));
assert.equal(MORNING_SERIES.length,21,'morning inventory remains the existing 21 dated series');
for(const id of MORNING_NOT_CONNECTED)assert.ok(!MORNING_SERIES.some(x=>x.id===id),
 'never call a hard-coded placeholder a verified morning source: '+id);
const report=fs.readFileSync('scripts/telegram-morning-report.mjs','utf8');
assert.doesNotMatch(report,/미국 선물 ES\/NQ\/YM\/RTY: 장전 실시간 검증값 미확보/);
assert.doesNotMatch(report,/고객예탁금·신용잔고: 최신 확정치 미연결|FedWatch|Finviz/);

const opts={now,githubToken:'SYNTHETIC_READ_TOKEN',repository:'cyyoung111-dev/portfolio',
  fetchImpl:async url=>{
    assert.match(String(url),/api.github.com/);
    return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
  },fetchNh:async()=>nh.slice(0,1),
  fetchDomestic:async()=>domestic.slice(0,1),fetchSecondary:async()=>{throw Error('PRIVATE_PROVIDER_ERROR');}
};
const partial=await prepareClose(opts);
assert.equal(partial.ready,true);
assert.equal(partial.coverage.core.verified,2);
assert.equal(partial.coverage.reference.verified,0);
assert.deepEqual(partial.coverage.groupErrors,['SECONDARY']);
assert.equal(partial.coverage.statuses.find(x=>x.id==='DOW').status,'FETCH_FAILED');
assert.ok(partial.message.includes('핵심지수 2/6'));
assert.ok(!JSON.stringify(partial).includes('PRIVATE_PROVIDER_ERROR'));
const none=await prepareClose({...opts,fetchNh:async()=>[],fetchDomestic:async()=>[]});
assert.equal(none.ready,false);
assert.equal(none.status,'NO_VERIFIED_INDEX_CLOSE');
assert.equal(none.coverage.core.verified,0);
assert.ok(Array.isArray(none.coverage.statuses),'missing all sources must still have diagnostics');
assert.ok(!('message' in none),'zero verified sources must never create sendable message');

// Real audit is exclusively GET/POST read-only access to existing source
// adapters. Test mocks supply no credentials, financial mutations or quotes
// in the emitted report.
const auditDate='2026-11-06',auditTime=new Date(auditDate+'T17:02:00+09:00');
assert.deepEqual(kstAuditSession(auditTime),{
 date:auditDate,asOfKst:'2026-11-06 17:02',currentSession:true});
const stockRows=[
 {id:'SAMSUNG',label:'삼성전자',symbol:'005930.KS',date:auditDate,
  value:80000,changePercent:0,source:'NH_REGULAR_CLOSE'},
 {id:'SKHYNIX',label:'SK하이닉스',symbol:'000660.KS',date:auditDate,
  value:210000,changePercent:0,source:'KRX_OFFICIAL'},
 {id:'NVDA',label:'엔비디아',symbol:'NVDA',date:'2026-11-05',
  value:200,changePercent:0,source:'YAHOO_DAILY_REFERENCE'},
 {id:'MU',label:'마이크론',symbol:'MU',date:'2026-11-05',
  value:110,changePercent:0,source:'YAHOO_DAILY_REFERENCE'}
];
const treasuryRows=[
 {id:'UST2Y',label:'미 국채 2년',date:'2026-11-05',source:'FRED_H15_DAILY',value:3.8},
 {id:'UST3Y',label:'미 국채 3년',date:'2026-11-05',source:'FRED_H15_DAILY',value:3.9},
 {id:'UST10Y_FRED',label:'미 국채 10년',date:'2026-11-05',source:'FRED_H15_DAILY',value:4.2}
];
const auditMessages=[];
const audit=await runClosingGapAudit({
 now:()=>auditTime,
 stocks:async(_date,{onDiagnostic})=>{
  onDiagnostic({kind:'NH_CLOSE_STOCK_READ',status:'GAS_RESPONSE_OK',
    stocks:[{id:'NVDA',status:'CODE_NOT_RETURNED'}]});
  return stockRows;},
 turnover:async()=>[{market:'KOSPI'},{market:'KOSDAQ'}],
 vkospi:async()=>[{id:'VKOSPI'}],treasury:async()=>treasuryRows,
 report:x=>auditMessages.push(x)
});
assert.deepEqual(audit.stockRows.map(x=>x.status),Array(4).fill('VERIFIED'));
assert.deepEqual(audit.turnoverRows.map(x=>x.status),['VERIFIED','VERIFIED']);
assert.equal(audit.vkospiStatus,'VERIFIED');
assert.deepEqual(audit.treasuryRows.map(x=>x.status),Array(3).fill('VERIFIED'));
assert.deepEqual(audit.failedSourceGroups,[]);
assert.deepEqual(auditMessages,[audit]);
assert.equal(audit.financialWrites,0);
assert.equal(audit.telegramSends,0);
assert.equal(audit.gasDeployments,0);
assert.doesNotMatch(JSON.stringify(audit),/80000|210000|PRIVATE_TOKEN|200000|https:\/\//);
const stale=await runClosingGapAudit({
 now:()=>auditTime,stocks:async()=>[
  {...stockRows[0],date:'2026-11-05'},
  {...stockRows[2],date:'2026-11-04'}],
 turnover:async()=>{throw Error('SECRET_NEVER_LOG');},
 vkospi:async()=>[],treasury:async()=>[]
});
assert.deepEqual(stale.stockRows.map(x=>x.status),
 Array(4).fill('NO_VERIFIED_ROW'));
assert.deepEqual(stale.failedSourceGroups,['TURNOVER']);
assert.doesNotMatch(JSON.stringify(stale),/SECRET_NEVER_LOG/);
// Provider diagnostics must identify transport/schema/exact-date failures without
// leaking any response body, rate, private identifier or credential.
const reasonAudit=await runClosingGapAudit({
 now:()=>auditTime,
 stocks:async()=>[],
 turnover:async(_day,{onDiagnostic})=>{
  onDiagnostic({kind:'KRX_TURNOVER_READ',status:'NO_EXACT_VALID_ROWS',secret:'NEVER_LOG'});
  return [];},
 vkospi:async(_day,{onDiagnostic})=>{
  onDiagnostic({kind:'VKOSPI_READ',status:'HTTP_UNAVAILABLE',secret:'NEVER_LOG'});
  return [];},
 treasury:async(_day,{onDiagnostic})=>{
  onDiagnostic({kind:'FRED_TREASURY_READ',id:'UST2Y',status:'NO_EXACT_VALID_ROW',value:123456});
  onDiagnostic({kind:'FRED_TREASURY_READ',id:'UST3Y',status:'CONTENT_TYPE_INVALID'});
  onDiagnostic({kind:'FRED_TREASURY_READ',id:'SECRET',status:'SECRET'});
  return [];}
});
assert.deepEqual(reasonAudit.diagnostics.map(d=>[d.kind,d.status,d.id||null]),[
 ['KRX_TURNOVER_READ','NO_EXACT_VALID_ROWS',null],
 ['VKOSPI_READ','HTTP_UNAVAILABLE',null],
 ['FRED_TREASURY_READ','NO_EXACT_VALID_ROW','UST2Y'],
 ['FRED_TREASURY_READ','CONTENT_TYPE_INVALID','UST3Y'],
 ['FRED_TREASURY_READ','OTHER_UNVERIFIED',null]
]);
assert.doesNotMatch(JSON.stringify(reasonAudit),/NEVER_LOG|123456|SECRET/);

// Exact-current-vs-prior KRX proof is read-only and never treats the
// previous verified row as a valid current close.
const krxToday='2026-11-06',krxYesterday='2026-11-05';
assert.equal(previousOpenKrxDay(krxToday),krxYesterday);
const compareNow=()=>new Date('2026-11-06T16:49:00+09:00');
const compareCalls=[],published=[];
const priorStockRows=[
 {id:'SAMSUNG',label:'삼성전자',symbol:'005930.KS',date:krxYesterday,
  value:85000,changePercent:null,source:'KRX_OFFICIAL'},
 {id:'SKHYNIX',label:'SK하이닉스',symbol:'000660.KS',date:krxYesterday,
  value:200000,changePercent:null,source:'KRX_OFFICIAL'}
];
const priorTurnover=['KOSPI','KOSDAQ'].map((market,i)=>({
 id:'KRX_TURNOVER_'+market,market,date:krxYesterday,
 valueKrw:10000000000000+i*1000000000000,
 source:'KRX_OFFICIAL_INDEX_DAILY',role:'NON_NH_REFERENCE_ONLY'
}));
const priorVkospi={id:'VKOSPI',label:'VKOSPI',date:krxYesterday,
 value:25.42,source:'KRX_OFFICIAL',role:'NON_NH_REFERENCE_ONLY'};
const compareResult=await compareKrxPriorSession({
 now:compareNow,
 stocks:async(date,{onDiagnostic})=>{
  compareCalls.push('stocks/'+date);
  onDiagnostic({status:date===krxYesterday?'BOTH_VERIFIED':'GAS_EMPTY_ROWS',
   rawResponse:'NEVER_LOG'});
  return date===krxYesterday?priorStockRows:[];},
 turnover:async(date,{onDiagnostic})=>{
  compareCalls.push('turnover/'+date);
  onDiagnostic({status:date===krxYesterday?'BOTH_VERIFIED':'GAS_EMPTY_ROWS'});
  return date===krxYesterday?priorTurnover:[];},
 vkospi:async(date,{onDiagnostic})=>{
  compareCalls.push('vkospi/'+date);
  onDiagnostic({status:date===krxYesterday?'VERIFIED':'GAS_STATUS_ERROR'});
  return date===krxYesterday?[priorVkospi]:[];},
 report:x=>published.push(x)
});
assert.equal(compareCalls.length,6);
assert.deepEqual(published,[compareResult]);
assert.equal(compareResult.currentDate,krxToday);
assert.equal(compareResult.previousDate,krxYesterday);
assert.equal(compareResult.results.length,5);
assert.ok(compareResult.results.every(x=>
 x.current==='NO_VERIFIED_ROW'&&x.previous==='VERIFIED'
 &&x.comparison==='PREVIOUS_ONLY_VERIFIED'));
assert.equal(compareResult.financialWrites,0);
assert.equal(compareResult.telegramSends,0);
assert.doesNotMatch(JSON.stringify(compareResult),/85000|200000|NEVER_LOG|https:\/\//);
const staleComparator=await compareKrxPriorSession({
 now:compareNow,stocks:async()=>priorStockRows,
 turnover:async()=>priorTurnover,
 vkospi:async()=>[{...priorVkospi,date:'2026-11-04'}]
});
assert.equal(staleComparator.results.find(x=>x.id==='VKOSPI').previous,
 'NO_VERIFIED_ROW','stale prior row must not count as previous session');
await assert.rejects(compareKrxPriorSession({
 now:()=>new Date('2026-11-06T15:40:00+09:00'),
 stocks:async()=>assert.fail('preclose external fetch')}),
 /KRX_COMPARISON_BEFORE_CLOSE_WINDOW/);

const auditWorkflow=fs.readFileSync(
 '.github/workflows/nh-close-20261102-diagnostic-readonly.yml','utf8');
assert.match(auditWorkflow,/name: Briefing optional source availability audit/);
assert.match(auditWorkflow,/environment: portfolio-production-gas/);
assert.match(auditWorkflow,/run: node scripts\/audit-briefing-source-gaps-readonly.mjs/);
assert.match(auditWorkflow,/github.ref == 'refs\/heads\/main'/);
assert.doesNotMatch(auditWorkflow,/sendTelegram\(|--apply|price-history\.write|GAS_DEPLOY_DRY_RUN/);

console.log('BRIEFING_SOURCE_COVERAGE_PASS core=6 optional=3 unconnected='
 +CLOSE_SOURCE_CATALOG.notConnected.length+' morningSeries=21 reasonEnums=VERIFIED/FETCH_FAILED/NO_VERIFIED_ROW/NOT_CONNECTED');
