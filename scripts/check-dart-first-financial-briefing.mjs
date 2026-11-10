import assert from 'node:assert/strict';
import {collectAiFinancialEvidence}
 from './collect-ai-financial-evidence-readonly.mjs';
import {formatAiFinancialEvidence,buildAiFinancialEvidence}
 from './briefing-financial-evidence.mjs';
import {prefetchAiFinancialEvidence,verifyFinancialPrefetchArtifact}
 from './prefetch-ai-financial-evidence-readonly.mjs';
import {evaluateSemiconductorCompanyViews}
 from './briefing-semiconductor-company-views.mjs';

const date='2026-11-09',us='2026-11-06',period='2026-06-30';
const now=()=>new Date('2026-11-09T06:20:00+09:00');
const stocks=['005930','000660'];
const names=['삼성전자','SK하이닉스'];
const statuses=['INDICATIVE_MULTICLASS_BPS','VERIFIED_SINGLECLASS_BPS'];
const dart={
 statuses:stocks.map((symbol,i)=>({symbol,status:statuses[i]})),
 rows:stocks.map((symbol,i)=>({
  symbol,corpCode:i===0?'00126380':'00164779',
  period,filingDate:'2026-08-14',
  currency:'KRW',referenceBpsKrw:i===0?80000:100000,
  source:'OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL'
 }))
};
const symbols=['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK'];
let order=[],diagnostic=null;
const dOnly=await collectAiFinancialEvidence({
 now,usSessionDate:us,
 readDart:async()=>{order.push('DART');return dart;},
 readTtm:async()=>{order.push('SEC_TTM');throw Error('SEC network failed with hidden key');},
 readValues:async()=>{order.push('SEC_FY');throw Error('SEC price failed');},
 onSourceStatus:s=>{diagnostic=s;}
});
assert.deepEqual(order,['DART','SEC_TTM','SEC_FY']);
assert.equal(dOnly.coverage.domestic,2);
assert.deepEqual(dOnly.coverage,{ttm:0,fyOnly:0,referencePbr:0,domestic:2});
assert.deepEqual(dOnly.domestic.map(x=>x.evidence?.status),statuses);
assert.ok(dOnly.items.every(x=>x.ttm===null&&x.value===null));
assert.equal(diagnostic.domestic[0].status,statuses[0]);
assert.equal(diagnostic.domestic[1].status,statuses[1]);
assert.ok(diagnostic.ttm.every(x=>x.status==='UNVERIFIED'));
assert.ok(!JSON.stringify(dOnly).includes('hidden key'));

const onlyDomestic=await prefetchAiFinancialEvidence({
 now,collector:opts=>collectAiFinancialEvidence({
  ...opts,readDart:async()=>dart,
  readTtm:async()=>{throw Error('SEC 503');},
  readValues:async()=>{throw Error('SEC Yahoo 429');}
 })
});
assert.equal(onlyDomestic.ready,true,'verified DART cannot be lost to US outage');
assert.equal(onlyDomestic.coverage.domestic,2);
assert.deepEqual(verifyFinancialPrefetchArtifact(date,onlyDomestic.data,{now:now()}),dOnly);
assert.equal(onlyDomestic.data.evidence.domesticSessionDate,null,
 'pre-open DART snapshot must not invent the current Korean closing price');
assert.ok(onlyDomestic.data.evidence.domestic.every(x=>x.evidence.pbrTimes===null));
const short=formatAiFinancialEvidence(onlyDomestic.data.evidence).join('\n');
assert.match(short,/삼성전자 보통·우선 합산 참고 BPS 80,000원 \[2026-06-30 연결\]/);
assert.match(short,/SK하이닉스 단일종류 확인 BPS 100,000원 \[2026-06-30 연결\]/);
assert.match(short,/PBR 종가 미연결/);
assert.ok(short.length<=680);

const closePrice=[
 {symbol:'005930.KS',label:'삼성전자',value:160000,
  source:'NH_REGULAR_CLOSE',date:us},
 {symbol:'000660.KS',label:'SK하이닉스',value:300000,
  source:'NH_REGULAR_CLOSE',date:us}
];
const view=evaluateSemiconductorCompanyViews({
 date,period:'morning',stocks:closePrice,financialEvidence:dOnly
});
assert.deepEqual(view.map(x=>x.book?.pbr),[2,3]);
assert.match(view[0].valueLine,/참고 PBR 2.00배/);
assert.match(view[0].valueLine,/2026-06-30 연결/);
assert.match(view[1].valueLine,/2026-06-30 연결/);
assert.match(view[1].valueLine,/PBR 3.00배/);
const notOfficial=evaluateSemiconductorCompanyViews({
 date,stocks:closePrice.map(x=>({...x,source:'Yahoo Finance 일봉'})),
 financialEvidence:dOnly
});
assert.ok(notOfficial.every(x=>x.book===null));
const stale=evaluateSemiconductorCompanyViews({
 date,stocks:closePrice.map(x=>({...x,date:'2026-11-05'})),
 financialEvidence:dOnly
});
assert.ok(stale.every(x=>x.book===null));
const missing=evaluateSemiconductorCompanyViews({
 date,stocks:[],financialEvidence:dOnly
});
assert.ok(missing.every(x=>x.book===null),'no PBR without dated NH/KRX close');

const ttm={statuses:symbols.map(symbol=>({symbol,status:'FY_ONLY'})),
 reports:symbols.map(symbol=>({
  symbol,periodEnd:'2025-12-31',annualAccession:'mock-10k',
  method:'REPORTED_FY',fields:{operatingCashFlow:50000000000,capex:10000000000}
 }))};
const fyValues={statuses:symbols.map(symbol=>({symbol,status:'VERIFIED_FY_BPS_PBR'})),
 snapshots:symbols.map(symbol=>({
  symbol,source:'SEC_10K_US_GAAP',priceSource:'YAHOO_DAILY_REFERENCE',
  asOf:'2025-12-31',reportedAt:'2026-02-01',priceDate:us,
  bpsUsd:50,splitAdjustedBpsUsd:50,splitSharesPerOldShare:1,
  priceUsd:500,pbrTimes:10
 }))};
const full=buildAiFinancialEvidence({asOfKst:date,usSessionDate:us,
 dart,ttm,fyValues});
assert.deepEqual(full.coverage,{ttm:0,fyOnly:9,referencePbr:9,domestic:2});
const lines=formatAiFinancialEvidence(full);
assert.ok(lines.join('\n').length<=680);
assert.equal(lines[0].startsWith('■ 공시 재무'),true);
assert.ok(lines[2].startsWith('• 국내: '),
 'all 9 SEC US companies may not crowd verified DART 2-company BPS out');
assert.match(lines[2],/2026-06-30 연결/);
assert.ok(lines.some(line=>line.startsWith('• NVDA ')),
 'domestic prioritization does not prevent US financial data if room remains');

const usOnly=await collectAiFinancialEvidence({
 now,usSessionDate:us,
 readDart:async()=>{throw Error('DART service unavailable');},
 readTtm:async()=>ttm,readValues:async()=>fyValues
});
assert.equal(usOnly.coverage.domestic,0);
assert.equal(usOnly.coverage.fyOnly,9);
assert.equal(usOnly.coverage.referencePbr,9);
assert.ok(usOnly.domestic.every(x=>x.evidence===null));
assert.equal(usOnly.portfolioWrites,0);
assert.equal(usOnly.telegramSends,0);
assert.equal(usOnly.gasDeployments,0);
console.log('DART_FIRST_FINANCIAL_BRIEFING_PASS DART2_survives_SEC_failure US9_kept dated_PBR optional_formatter_no_secrets');
