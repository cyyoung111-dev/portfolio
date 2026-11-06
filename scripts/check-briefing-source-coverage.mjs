import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MORNING_SERIES} from './telegram-morning-report.mjs';
import {CLOSE_SOURCE_CATALOG,MORNING_NOT_CONNECTED,
  summarizeCloseCoverage,formatCloseCoverageSummary,
  closeQualityDecision} from './briefing-source-coverage.mjs';
import {formatClose,prepareClose} from './telegram-close-workflow.mjs';
import {runClosingGapAudit,kstAuditSession} from './audit-briefing-source-gaps-readonly.mjs';

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

const meta=JSON.stringify(summary);
assert.ok(!meta.includes('7720.39')&&!meta.includes('PRIVATE_AUTH_TOKEN'));
assert.equal(MORNING_SERIES.length,21,'morning inventory remains the existing 21 dated series');
for(const id of MORNING_NOT_CONNECTED)assert.ok(!MORNING_SERIES.some(x=>x.id===id),
 'never call a hard-coded placeholder a verified morning source: '+id);
const report=fs.readFileSync('scripts/telegram-morning-report.mjs','utf8');
assert.match(report,/미국 선물 ES\/NQ\/YM\/RTY: 장전 실시간 검증값 미확보/);
assert.match(report,/고객예탁금·신용잔고: 최신 확정치 미연결/);

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
const auditWorkflow=fs.readFileSync(
 '.github/workflows/nh-close-20261102-diagnostic-readonly.yml','utf8');
assert.match(auditWorkflow,/name: Briefing optional source availability audit/);
assert.match(auditWorkflow,/environment: portfolio-production-gas/);
assert.match(auditWorkflow,/run: node scripts\/audit-briefing-source-gaps-readonly.mjs/);
assert.match(auditWorkflow,/github.ref == 'refs\/heads\/main'/);
assert.doesNotMatch(auditWorkflow,/sendTelegram\(|--apply|price-history\.write|GAS_DEPLOY_DRY_RUN/);

console.log('BRIEFING_SOURCE_COVERAGE_PASS core=6 optional=3 unconnected='
 +CLOSE_SOURCE_CATALOG.notConnected.length+' morningSeries=21 reasonEnums=VERIFIED/FETCH_FAILED/NO_VERIFIED_ROW/NOT_CONNECTED');
