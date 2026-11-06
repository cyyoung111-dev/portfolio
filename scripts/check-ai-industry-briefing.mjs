import assert from 'node:assert/strict';
import {formatAiIndustryCloseLens} from './briefing-ai-industry-lens.mjs';
import {formatClose} from './telegram-close-workflow.mjs';
import {AI_NINE,readAiNineDailyPrices,readAiNineSecFilings,
 formatAiNineDailyPrices,completedUsRegularClose} from './briefing-ai-nine-sources.mjs';
import {runAiNineSourceAudit} from './audit-ai-nine-readonly.mjs';
import {summarizeAiNineHistory,readAiNineHistoricalTrends} from './briefing-ai-nine-trends.mjs';
import {extractSecAnnualFacts,readAiNineAnnualSecFacts} from './briefing-ai-nine-sec-financials.mjs';

const date='2026-11-02',usDate='2026-10-30';
const nh=[
 {label:'S&P 500',symbol:'^GSPC',source:'NH_INDEX_DAILY',date:usDate,value:7580.07,changePercent:-1.82},
 {label:'NASDAQ',symbol:'^IXIC',source:'NH_INDEX_DAILY',date:usDate,value:25437,changePercent:-2.86},
 {label:'NASDAQ100',symbol:'^NDX',source:'NH_INDEX_DAILY',date:usDate,value:28384.85,changePercent:-3.46}
];
const secondary=[
 {label:'SOX',source:'FRED_NASDAQSOX',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:8000,changePercent:-7.2},
 {label:'VIX',source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:19.42,changePercent:5},
 {label:'다우존스',source:'FRED_DJIA',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:51770.31,changePercent:-1}
];
const stockDates={SAMSUNG:date,SKHYNIX:date,NVDA:usDate,MU:usDate};
const stocks=Object.entries(stockDates).map(([id,d],i)=>({
 id,label:({SAMSUNG:'삼성전자',SKHYNIX:'SK하이닉스',NVDA:'엔비디아',MU:'마이크론'})[id],
 symbol:({SAMSUNG:'005930.KS',SKHYNIX:'000660.KS',NVDA:'NVDA',MU:'MU'})[id],
 date:d,value:100+i,source:'NH_REGULAR_CLOSE',changePercent:0
}));
const result=formatAiIndustryCloseLens({date,usDate,nh,secondary,stocks}).join('\n');
assert.match(result,/AI 산업 전체/);
assert.match(result,/기술주 상대약세 \(-1\.64%p\)/);
assert.match(result,/SOX -7\.20% \/ NASDAQ100 대비 -3\.74%p/);
assert.match(result,/주요 4종목 종가 4\/4/);
assert.match(result,/CAPEX.*클라우드 매출.*미연결/);
assert.match(result,/네트워크·광통신.*전력·냉각.*AI 소프트웨어/);
assert.match(result,/AI 설비투자 → HBM\/GPU 수요/);
assert.doesNotMatch(result,/AI 수요 급증|실제 주문 증가|AI 버블 확정/);
const duplicates=formatAiIndustryCloseLens({date,usDate,nh,
 secondary:[...secondary,secondary[0]],stocks:[...stocks,stocks[0]]}).join('\n');
assert.match(duplicates,/SOX·NASDAQ100 동시 검증값 부족 → 상대강도 판단 유보/);
assert.match(duplicates,/주요 4종목 종가 3\/4/);


const missing=formatAiIndustryCloseLens({date,usDate,nh:nh.slice(0,1),
 secondary:secondary.slice(1),stocks:[]}).join('\n');
assert.match(missing,/동일 거래일 지수 수익률 부족 → 판단 보류/);
assert.match(missing,/상대강도 판단 유보/);
assert.match(missing,/0\/4/);
const wrongDates=formatAiIndustryCloseLens({date,usDate,nh:nh.map(x=>({...x,date:'2026-10-29'})),
 secondary:secondary.map(x=>({...x,date:'2026-10-29'})),stocks:stocks.map(x=>({...x,source:'YAHOO'}))}).join('\n');
assert.match(wrongDates,/동일 거래일 지수 수익률 부족 → 판단 보류/);
assert.match(wrongDates,/상대강도 판단 유보/);
assert.match(wrongDates,/0\/4/);

const domestic=[
 {type:'KOSPI',label:'KOSPI',date,value:5859.08,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:2.24},
 {type:'KOSDAQ',label:'KOSDAQ',date,value:734.36,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:1.38},
 {type:'KOSPI200',label:'KOSPI 200',date,value:920.63,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:2.32}
];
const macros=[
 {id:'USDKRW',label:'원/달러',symbol:'KRW=X',date:usDate,value:1337.98,
 changePercent:-0.18,source:'YAHOO_DAILY_REFERENCE'},
 {id:'DXY',label:'DXY',symbol:'DX-Y.NYB',date:usDate,value:101.88,
 changePercent:-0.16,source:'YAHOO_DAILY_REFERENCE'},
 {id:'UST10Y',label:'미 10년물',symbol:'^TNX',date:usDate,value:4.929,
 changePercent:-1.2,source:'YAHOO_DAILY_REFERENCE'}
];
const domesticAnalysis=formatAiIndustryCloseLens({date,usDate,nh,domestic,secondary,stocks}).join('\n');
assert.match(domesticAnalysis,/KOSPI \+2\.24% \/ KOSDAQ \+1\.38% → 양 시장 상승/);
for(const name of ['버핏','다모다란','애크먼','피터 린치'])
 assert.ok(domesticAnalysis.includes(name),'investor lens: '+name);
assert.match(domesticAnalysis,/ROIC.*현금흐름/);
assert.match(domesticAnalysis,/시장가격이 요구하는 성장 가정/);
assert.match(domesticAnalysis,/계좌별 중복 노출/);
assert.match(domesticAnalysis,/메모리 업황 최고점/);
assert.match(domesticAnalysis,/■ 조건부 시나리오/);
assert.doesNotMatch(domesticAnalysis,/매수 확정|버핏이 오늘|다모다란이 오늘/);
const yahooSoxAnalysis=formatAiIndustryCloseLens({date,usDate,nh,domestic,
 secondary:[{...secondary[0],source:'YAHOO_SOX_DAILY_REFERENCE'}],stocks}).join('\n');
assert.match(yahooSoxAnalysis,/SOX -7\.20% \/ NASDAQ100 대비 -3\.74%p/,
 'exact-date Yahoo backup should inform the same AI semiconductor spread');

const msg=formatClose(date,nh,secondary,domestic,stocks,macros,[]);
assert.ok(msg.startsWith('['+date+' 장후 시장 브리핑]'));
assert.ok(msg.indexOf('■ 먼저 보는 시장 해석')<msg.indexOf('■ 국내 시장'));
assert.match(msg,/■ 데이터 확인/);
assert.ok(msg.length<4000, 'AI commentary must not exceed Telegram 4000-char payload gate');

/* Issue #826: SEC nine issuers + exact-date read-only US daily references.
   No real network, Telegram, GAS or portfolio writes. */
assert.deepEqual(AI_NINE.map(x=>x.symbol),
 ['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK']);
assert.equal(AI_NINE.find(x=>x.symbol==='SNDK').cik,'0002023554');
assert.equal(AI_NINE.find(x=>x.symbol==='SNDK').firstIndependentTradingDay,'2025-02-24');
assert.equal(new Set(AI_NINE.map(x=>x.cik)).size,9);
assert.equal(AI_NINE.find(x=>x.symbol==='AAPL')?.cik,'0000320193');
const quoteNow=()=>new Date('2026-11-02T17:00:00+09:00');
const quoteCalls=[],quoteDiagnostics=[];
const quotes=await readAiNineDailyPrices(date,{
 now:quoteNow,onDiagnostic:x=>quoteDiagnostics.push(x),
 fetchDaily:async(label,symbol,day,{host})=>{
  quoteCalls.push([symbol,host]);
  if(symbol==='ORCL')return {label,symbol,date:'2026-10-29',
   source:'Yahoo Finance 일봉',value:100,changePercent:1};
  if(symbol==='SNDK'&&host==='query1.finance.yahoo.com')
   return {label,symbol,date:'2026-10-29',source:'Yahoo Finance 일봉',value:500,
    changePercent:5};
  return {label,symbol,date:usDate,source:'Yahoo Finance 일봉',
   value:200,changePercent:-2.5};
 }
});
assert.equal(quotes.expectedUsDate,usDate);
assert.equal(quotes.total,9);
assert.equal(quotes.verified,8);
assert.ok(quoteCalls.some(x=>x[0]==='SNDK'&&x[1]==='query2.finance.yahoo.com'));
assert.equal(quotes.prices.find(x=>x.symbol==='SNDK')?.source,'YAHOO_DAILY_REFERENCE');
assert.equal(quotes.statuses.find(x=>x.symbol==='ORCL')?.status,'NO_EXACT_COMPLETED_US_BAR');
assert.equal(quoteDiagnostics.length,1);
assert.ok(!JSON.stringify(quoteDiagnostics).includes('200'));
const quoteText=formatAiNineDailyPrices(quotes);
assert.match(quoteText,/SNDK: 200 USD \(-2\.50%\) \[2026-10-30\]/);
assert.match(quoteText,/ORCL: 완료 일봉 미확보/);
assert.doesNotMatch(quoteText,/2026-10-29/);
const stale=await readAiNineDailyPrices(date,{
 now:quoteNow,fetchDaily:async(label,symbol)=>({label,symbol,date:usDate,
  value:100,changePercent:0,source:'UNVERIFIED_PROVIDER'})
});
assert.equal(stale.verified,0,'invalid provider must fail closed');

const nyBeforeClose=new Date('2026-11-02T15:00:00Z'); // 10:00 EST, active session
assert.equal(completedUsRegularClose('2026-11-02',nyBeforeClose),false);
assert.equal(completedUsRegularClose('2026-11-02',new Date('2026-11-02T21:14:00Z')),false);
assert.equal(completedUsRegularClose('2026-11-02',new Date('2026-11-02T21:15:00Z')),true);
assert.equal(completedUsRegularClose('2026-03-09',new Date('2026-03-09T20:15:00Z')),true,
 'EDT 16:15 is 20:15 UTC');
assert.equal(completedUsRegularClose('2026-03-09',new Date('2026-03-09T19:00:00Z')),false);
const mockYahooClose=async url=>{
 const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
 return {ok:true,json:async()=>({chart:{result:[{
  meta:{symbol,exchangeTimezoneName:'America/New_York'},
  timestamp:[Date.parse('2026-10-30T13:30:00Z')/1000,
   Date.parse('2026-11-02T14:30:00Z')/1000],
  indicators:{quote:[{close:[100,110]}]}
 }]}})};
};
let earlyRequests=0;
const early=await readAiNineDailyPrices('2026-11-03',{
 now:()=>nyBeforeClose,fetchImpl:async url=>{earlyRequests++;return mockYahooClose(url);}
});
assert.equal(early.verified,0,'active NYSE session must not be marked complete');
assert.equal(earlyRequests,0,'early session gate must short-circuit source reads');
assert.ok(early.statuses.every(x=>x.status==='US_CLOSE_UNVERIFIED'));
const afterClose=await readAiNineDailyPrices('2026-11-03',{
 now:()=>new Date('2026-11-02T21:20:00Z'),fetchImpl:mockYahooClose
});
assert.equal(afterClose.verified,9,'real completed-bar parser and post-close gate');
assert.ok(afterClose.prices.every(x=>x.date==='2026-11-02'));

const holiday=await readAiNineDailyPrices('2026-11-01',{fetchDaily:async()=>{throw Error('must-not-fetch');}});
assert.equal(holiday.verified,0,'unknown/closed KR session must not be accepted');

let secCalls=0;
const secUnconfigured=await readAiNineSecFilings({
 userAgent:'',fetchImpl:async()=>{secCalls++;throw Error('must-not-fetch');}
});
assert.equal(secCalls,0);
assert.equal(secUnconfigured.verified,0);
assert.equal(secUnconfigured.statuses[8].status,'SEC_USER_AGENT_NOT_CONFIGURED');
const secDiagnostics=[];
const sec=await readAiNineSecFilings({
 userAgent:'PortfolioMonitor contact@example.org',now:quoteNow,
 onDiagnostic:x=>secDiagnostics.push(x),
 fetchImpl:async(url,init)=>{
  secCalls++;
  const item=AI_NINE.find(x=>url==='https://data.sec.gov/submissions/CIK'+x.cik+'.json');
  assert.ok(item,'only pinned SEC CIK hosts/paths');
  assert.equal(init.method,'GET');
  assert.equal(init.headers['user-agent'],'PortfolioMonitor contact@example.org');
  return {ok:true,headers:{get:()=> 'application/json'},
   json:async()=>({
    cik:Number(item.cik),tickers:[item.symbol],
    filings:{recent:{
     form:['8-K','10-Q','10-K'],
     filingDate:['2026-10-31','2026-10-30','2026-08-17'],
     reportDate:['2026-10-31','2026-10-02','2026-07-03'],
     accessionNumber:['0001628280-26-068602','0001628280-26-068601','0001628280-26-040000']
    }}
   })};
 }
});
assert.equal(secCalls,9);
assert.equal(sec.verified,9);
assert.ok(sec.filings.every(x=>x.latest.form==='10-Q'
 &&x.latest.filedAt==='2026-10-30'&&x.latest.periodEnd==='2026-10-02'));
assert.equal(sec.filings.find(x=>x.symbol==='SNDK')?.cik,'0002023554');
assert.equal(secDiagnostics[0].verified,9);
assert.ok(!JSON.stringify(secDiagnostics).includes('contact@example.org'),
 'never log user agent or raw filings');
const secMismatch=await readAiNineSecFilings({
 userAgent:'PortfolioMonitor contact@example.org',now:quoteNow,
 fetchImpl:async(url)=>({
  ok:true,headers:{get:()=> 'application/json'},
  json:async()=>({
   cik:url.includes('2023554')?123456:789019,
   tickers:[url.includes('2023554')?'SNDK':'MSFT'],
   filings:{recent:{form:['10-K'],filingDate:['2026-08-17'],
    reportDate:['2026-07-03'],accessionNumber:['0001628280-26-040000']}}
  })
 })
});
assert.equal(secMismatch.verified,1,'CIK and ticker both match, not just ticker');
assert.equal(secMismatch.statuses.find(x=>x.symbol==='SNDK').status,
 'SEC_FILING_SCHEMA_OR_DATE_INVALID');


const auditResult=await runAiNineSourceAudit({
 now:()=>new Date('2026-11-06T17:10:00+09:00'),
 readPrices:async()=>({expectedUsDate:'2026-11-05',
  prices:[{symbol:'MSFT',value:999999,secret:'DO_NOT_PRINT'}],
  statuses:AI_NINE.map((x,i)=>({symbol:x.symbol,status:i<6?'VERIFIED':'BAD_STATUS',
   secret:'DO_NOT_PRINT'}))}),
 readFilings:async()=>({filings:[{symbol:'AAPL',rawBody:'DO_NOT_PRINT'}],
  statuses:AI_NINE.map((x,i)=>({symbol:x.symbol,status:i<3?'VERIFIED':
   'SEC_USER_AGENT_NOT_CONFIGURED',secret:'DO_NOT_PRINT'}))}),
 readAnnualFacts:async()=>({statuses:AI_NINE.map((x,i)=>({symbol:x.symbol,
  status:i<2?'VERIFIED':'NO_SAME_FILING_ANNUAL_FACTS',cash:999999}))})
});
assert.equal(auditResult.dateKst,'2026-11-06');
assert.equal(auditResult.usSessionDate,'2026-11-05');
assert.deepEqual(auditResult.price.verified,6);
assert.deepEqual(auditResult.sec.verified,3);
assert.equal(auditResult.annualFinancials.verified,2);
assert.equal(auditResult.price.statuses.find(x=>x.symbol==='SNDK').status,'UNVERIFIED');
assert.equal(auditResult.portfolioWrites+auditResult.telegramSends+auditResult.gasDeployments,0);
assert.doesNotMatch(JSON.stringify(auditResult),/DO_NOT_PRINT|999999|rawBody/);
assert.deepEqual(auditResult.price.statuses.map(x=>x.symbol),AI_NINE.map(x=>x.symbol));
const auditErrors=await runAiNineSourceAudit({
 now:()=>new Date('2026-11-06T07:40:00+09:00'),
 readPrices:async()=>{throw Error('PRIVATE_PROVIDER_ERROR');},
 readFilings:async()=>({statuses:AI_NINE.map(x=>({symbol:x.symbol,status:'FETCH_FAILED'}))}),
 readAnnualFacts:async()=>{throw Error('DO_NOT_LOG_PRIVATE_SEC_FACTS');}
});
assert.equal(auditErrors.price.verified,0);
assert.equal(auditErrors.annualFinancials.verified,0);
assert.equal(auditErrors.price.statuses.every(x=>x.status==='UNVERIFIED'),true);
assert.doesNotMatch(JSON.stringify(auditErrors),/PRIVATE_PROVIDER_ERROR/);


/* 52-week closing extremes and 10-year price-only trend contract. */
const sessions=[];
for(let day=Date.parse('2015-10-26T00:00:00Z');
 day<=Date.parse('2026-11-05T00:00:00Z'); day+=86400000){
 const date=new Date(day).toISOString().slice(0,10);
 if(![0,6].includes(new Date(day).getUTCDay()))sessions.push(date);
}
const fullBars=sessions.map((d,i)=>({date:d,close:100+i}));
const stat=summarizeAiNineHistory('AAPL','2026-11-05',fullBars);
assert.equal(stat.date,'2026-11-05');
assert.equal(stat.week52.type,'CLOSING_HIGH_LOW');
assert.ok(stat.week52.high>=stat.week52.low);
assert.ok(stat.week52.sampleCount>=250);
assert.ok(stat.returnsYears['10']!==null && stat.returnsYears['3']!==null);
assert.ok(stat.returnsTradingDays['252']!==null);
assert.ok(stat.sma['200']!==null);
assert.equal(stat.scope,'PRICE_ONLY_EXCLUDES_DIVIDENDS');
assert.equal(stat.week52.highDistancePct,0);
assert.equal(summarizeAiNineHistory('AAPL','2026-11-05',fullBars.slice(-220)).week52,null,
 'ten-month partial listing is not a full 52-week close range');
assert.equal(summarizeAiNineHistory('AAPL','2026-11-04',fullBars),null,
 'wrong final session must be rejected');
const dupBars=[...fullBars.slice(-300)];
dupBars.splice(2,0,dupBars[1]);
assert.equal(summarizeAiNineHistory('AAPL','2026-11-05',dupBars),null,
 'duplicate trade dates rejected');
const sandiskHistory=summarizeAiNineHistory('SNDK','2026-11-05',fullBars);
assert.equal(sandiskHistory.returnsYears['3'],null,
 'SNDK before 2025-02-24 cannot have an independent three-year return');
assert.equal(sandiskHistory.returnsYears['5'],null);
assert.equal(sandiskHistory.returnsYears['10'],null);
assert.ok(sandiskHistory.week52,'SNDK still has 52-week history as of 2026-11-05');

const misleading=fullBars.filter(x=>x.date==='2025-01-02'
  ||x.date>='2026-01-02');
assert.ok(misleading.length>=200,'independent negative sample has enough close prices');
assert.equal(summarizeAiNineHistory('AAPL','2026-11-05',misleading).week52,null,
 'old pre-window price must not mask a missing 52-week window start');
const brokenMid=fullBars.filter(x=>x.date<'2026-03-01'||x.date>'2026-04-15');
assert.equal(summarizeAiNineHistory('AAPL','2026-11-05',brokenMid).week52,null,
 'a prolonged gap inside the 52-week window cannot yield reliable extremes');

const sampleBars=fullBars.slice(-300);
const fakeYahooChart=url=>{
 const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
 return {ok:true,json:async()=>({chart:{result:[{
  meta:{symbol,exchangeTimezoneName:'America/New_York'},
  timestamp:sampleBars.map(x=>Date.parse(x.date+'T14:30:00Z')/1000),
  indicators:{quote:[{close:sampleBars.map(x=>x.close)}]}
 }]}})};
};
const trends=await readAiNineHistoricalTrends('2026-11-06',{
 now:()=>new Date('2026-11-06T08:50:00Z'),
 fetchImpl:async url=>fakeYahooChart(url)
});
assert.equal(trends.verified,9);
assert.equal(trends.sessionDate,'2026-11-05');
assert.ok(trends.trends.every(x=>x.week52?.type==='CLOSING_HIGH_LOW'));
assert.equal(trends.trends.find(x=>x.symbol==='SNDK').returnsYears['3'],null);
const wrongSymbol=await readAiNineHistoricalTrends('2026-11-06',{
 now:()=>new Date('2026-11-06T08:50:00Z'),
 fetchImpl:async url=>{const r=fakeYahooChart(url);const raw=await r.json();
 raw.chart.result[0].meta.symbol='EVIL';return {ok:true,json:async()=>raw};}
});
assert.equal(wrongSymbol.verified,0,'wrong source identity must fail closed');
const earlyHistory=await readAiNineHistoricalTrends('2026-11-03',{
 now:()=>new Date('2026-11-02T15:00:00Z'),
 fetchImpl:async()=>{throw Error('NO_EARLY_NETWORK');}
});
assert.equal(earlyHistory.verified,0,'uncompleted US session must not read or accept trend');
assert.ok(earlyHistory.statuses.every(x=>x.status==='US_CLOSE_UNVERIFIED'));


/* SEC US-GAAP annual 10-K: strict same accession/year/unit provenance. */
const filing='0000320193-26-000026',end='2026-09-26',filed='2026-11-03',
  start='2025-09-28';
const one=(value,{instant=false,unit='USD',accn=filing,form='10-K',
 fp='FY',endDate=end}={})=>({
  val:value,end:endDate,filed,accn,form,fp,...instant?{}:{start}
});
const secPayload={
 cik:320193,entityName:'Apple Inc.',
 facts:{'us-gaap':{
  Assets:{units:{USD:[one(5000000000,{instant:true})]}},
  RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[one(3000000000)]}},
  OperatingIncomeLoss:{units:{USD:[one(750000000)]}},
  NetIncomeLoss:{units:{USD:[one(650000000)]}},
  NetCashProvidedByUsedInOperatingActivities:{units:{USD:[one(800000000)]}},
  PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[one(400000000)]}},
  StockholdersEquity:{units:{USD:[one(1700000000,{instant:true})]}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:[one(200000000,{instant:true})]}},
  EarningsPerShareDiluted:{units:{'USD/shares':[one(2.32,{unit:'USD/shares'})]}}
 }}
};
const annual=extractSecAnnualFacts(secPayload,'AAPL',{
 now:new Date('2026-11-06T15:00:00Z')
});
assert.equal(annual.symbol,'AAPL');
assert.equal(annual.period,end);
assert.equal(annual.accessionNumber,filing);
assert.equal(annual.values.revenue.value,3000000000);
assert.equal(annual.values.revenue.tag,'RevenueFromContractWithCustomerExcludingAssessedTax');
assert.equal(annual.values.operatingCashFlow.value,800000000);
assert.equal(annual.values.capex.value,400000000);
assert.equal(annual.calculated.freeCashFlow,400000000);
assert.equal(annual.calculated.operatingMarginPercent,25);
assert.equal(annual.values.epsDiluted.unit,'USD/shares');
assert.equal(annual.missing.includes('shareRepurchases'),true);
assert.equal(Object.hasOwn(annual,'roic'),false);
assert.equal(Object.hasOwn(annual,'bps'),false);
const secWrongPeriod=structuredClone(secPayload);
secWrongPeriod.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD
 =[one(999999999,{endDate:'2026-06-27'})];
const wrongPeriod=extractSecAnnualFacts(secWrongPeriod,'AAPL',{now:new Date('2026-11-06T12:00:00Z')});
assert.equal(wrongPeriod.values.operatingCashFlow,null);
assert.equal(wrongPeriod.calculated.freeCashFlow,null);
const secWrongAccn=structuredClone(secPayload);
secWrongAccn.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD
 =[one(100,{accn:'0000320193-25-000001'})];
assert.equal(extractSecAnnualFacts(secWrongAccn,'AAPL').calculated.freeCashFlow,null,
 'cross-filing capex cannot be combined');
const secDuplicates=structuredClone(secPayload);
secDuplicates.facts['us-gaap'].Assets.units.USD.push(one(5000000001,{instant:true}));
assert.equal(extractSecAnnualFacts(secDuplicates,'AAPL'),null,
 'contradictory assets in one filing disqualify annual anchor');
const secOtherCik=structuredClone(secPayload);
secOtherCik.cik=2023554;
assert.equal(extractSecAnnualFacts(secOtherCik,'AAPL'),null);
const secBeforeFiling=extractSecAnnualFacts(secPayload,'AAPL',{
 now:new Date('2026-11-01T00:00:00Z')});
assert.equal(secBeforeFiling,null,'future filing cannot be accepted');
const secNoRevenue=structuredClone(secPayload);
delete secNoRevenue.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax;
assert.equal(extractSecAnnualFacts(secNoRevenue,'AAPL').calculated.fcfMarginPercent,null);
let realCalls=0;
const unconfiguredFacts=await readAiNineAnnualSecFacts({
 userAgent:'',fetchImpl:async()=>{realCalls++;throw Error('NO_NETWORK');}
});
assert.equal(realCalls,0);
assert.equal(unconfiguredFacts.verified,0);
assert.ok(unconfiguredFacts.statuses.every(x=>x.status==='SEC_USER_AGENT_NOT_CONFIGURED'));
const auditedSec=await readAiNineAnnualSecFacts({
 now:()=>new Date('2026-11-06T15:00:00Z'),
 userAgent:'ResearchMonitor contact@example.org',
 fetchImpl:async(url,request)=>{
  realCalls++;
  const item=AI_NINE.find(x=>url==='https://data.sec.gov/api/xbrl/companyfacts/CIK'+x.cik+'.json');
  assert.ok(item);
  assert.equal(request.method,'GET');
  assert.equal(request.headers['user-agent'],'ResearchMonitor contact@example.org');
  const p=structuredClone(secPayload);
  p.cik=Number(item.cik);
  return {ok:true,headers:{get:key=>key==='content-type'?'application/json':null},
   json:async()=>p};
 }
});
assert.equal(realCalls,9);
assert.equal(auditedSec.verified,9);
assert.ok(auditedSec.reports.every(x=>x.source==='SEC_COMPANYFACTS_US_GAAP_10K'));
const deniedSec=await readAiNineAnnualSecFacts({
 userAgent:'ResearchMonitor contact@example.org',
 fetchImpl:async()=>({ok:false,headers:{get:()=>null}})
});
assert.equal(deniedSec.verified,0);
assert.ok(deniedSec.statuses.every(x=>x.status==='SEC_HTTP_UNAVAILABLE'));

console.log('AI_BRIEFING_LENS_PASS verified/absent dates, value-chain, Telegram length');
