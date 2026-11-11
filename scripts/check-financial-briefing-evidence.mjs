import assert from 'node:assert/strict';
import {buildAiFinancialEvidence,formatAiFinancialEvidence,auditSentFinancialEvidence}
 from './briefing-financial-evidence.mjs';
import {collectAiFinancialEvidence}
 from './collect-ai-financial-evidence-readonly.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';

const asOfKst='2026-11-06',usSessionDate='2026-11-05';
const ttm={
 statuses:[{symbol:'MSFT',status:'VERIFIED_TTM'},
           {symbol:'NVDA',status:'VERIFIED_TTM'},
           {symbol:'MU',status:'FY_ONLY'}],
 reports:[
  {symbol:'MSFT',periodEnd:'2026-09-30',quarterFiledAt:'2026-10-25',
   quarterAccession:'mock-q-1',annualAccession:'mock-y-1',
   method:'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD',
   fields:{operatingCashFlow:100e9,capex:60e9},
   calculated:{freeCashFlow:40e9}},
  {symbol:'NVDA',periodEnd:'2026-08-02',quarterFiledAt:'2026-08-24',
   quarterAccession:'mock-q-2',annualAccession:'mock-y-2',
   method:'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD',
   fields:{operatingCashFlow:38e9,capex:5e9},
   calculated:{freeCashFlow:33e9}},
  {symbol:'MU',periodEnd:'2026-08-27',annualAccession:'mock-y-3',
   method:'REPORTED_FY',fields:{operatingCashFlow:10e9,capex:6e9}}
 ]};
const fyValues={
 statuses:[{symbol:'MSFT',status:'VERIFIED_FY_BPS_PBR'},
           {symbol:'NVDA',status:'VERIFIED_FY_BPS_PBR'},
           {symbol:'META',status:'PARTIAL_FY_VALUE'}],
 snapshots:[
  {symbol:'MSFT',source:'SEC_10K_US_GAAP',asOf:'2026-06-30',
   reportedAt:'2026-08-01',priceDate:'2026-11-05',
   priceSource:'YAHOO_DAILY_REFERENCE',bpsUsd:50,
   splitAdjustedBpsUsd:50,splitSharesPerOldShare:1,
   priceUsd:500,pbrTimes:10},
  {symbol:'NVDA',source:'SEC_10K_US_GAAP',asOf:'2026-01-25',
   reportedAt:'2026-02-20',priceDate:'2026-11-05',
   priceSource:'YAHOO_DAILY_REFERENCE',bpsUsd:10,
   splitAdjustedBpsUsd:2,splitSharesPerOldShare:5,
   priceUsd:150,pbrTimes:75}
 ]};
const dart={
 statuses:[{symbol:'005930',status:'INDICATIVE_MULTICLASS_BPS'},
           {symbol:'000660',status:'VERIFIED_SINGLECLASS_BPS'}],
 rows:[
  {symbol:'005930',source:'OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL',
   corpCode:'00126380',currency:'KRW',period:'2026-06-30',
   filingDate:'2026-08-15',preferredShares:8000,
   referenceBpsKrw:55000,shareBasis:'ALL_CLASSES_EQUAL_EQUITY_REFERENCE'},
  {symbol:'000660',source:'OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL',
   corpCode:'00164779',currency:'KRW',period:'2026-06-30',
   filingDate:'2026-08-15',preferredShares:0,
   referenceBpsKrw:90000,shareBasis:'SINGLE_CLASS'}
 ]};
const domesticQuotes=[
 {symbol:'005930',source:'NH_REGULAR_CLOSE',unit:'KRW',
  date:'2026-11-06',value:110000},
 {symbol:'000660',source:'NH_REGULAR_CLOSE',unit:'KRW',
  date:'2026-11-06',value:225000}
];
const domesticSessionDate='2026-11-06';
const args={asOfKst,usSessionDate,domesticSessionDate,ttm,fyValues,dart,domesticQuotes};
const verified=buildAiFinancialEvidence(args);
assert.equal(verified.kind,'AI_FINANCIAL_EVIDENCE_READ_ONLY');
assert.deepEqual(verified.coverage,{
 ttm:2,fyOnly:1,referencePbr:2,domestic:2
});
const get=s=>verified.items.find(x=>x.symbol===s);
assert.equal(get('MSFT').ttm.fcfUsd,40e9);
assert.equal(get('MSFT').ttm.capexToOcfPercent,60);
assert.equal(get('NVDA').value.pbrTimes,75);
assert.equal(get('MU').ttm.basis,'FY');
assert.equal(get('META').value,null,'partial Meta must not show PBR');
assert.equal(verified.domestic[0].evidence.indicative,true);
assert.equal(verified.domestic[0].evidence.pbrTimes,2);
assert.equal(verified.domestic[1].evidence.pbrTimes,2.5);
assert.equal(verified.portfolioWrites,0);
assert.equal(verified.telegramSends,0);
const panel=formatAiFinancialEvidence(verified);
const prose=panel.join('\n');
assert.match(prose,/미국 TTM 2\/9·FY만 1\/9·FY PBR 2\/9/);
assert.match(prose,/MSFT TTM FCF \$40\.0B · CAPEX\/OCF 60%/);
assert.match(prose,/NVDA TTM FCF \$33\.0B/);
assert.match(prose,/FY BPS \$10\.00 \/ 조정 PBR 75\.0배/);
assert.match(prose,/삼성전자 보통·우선 합산 참고 BPS/,
 'multi-class DART book value must never look like legal common-only BPS');
assert.match(prose,/SK하이닉스 단일종류 확인 BPS/,
 'single-class DART book value keeps its higher verification status');
assert.doesNotMatch(prose,/META FY PBR/);
assert.ok(prose.length<=680);

// No invented FY PBR when split events, price day or share denominator differ.
const splitMissing=buildAiFinancialEvidence({...args,fyValues:{
 ...fyValues,snapshots:fyValues.snapshots.map(x=>x.symbol==='NVDA'
  ?{...x,splitSharesPerOldShare:null}:x)}});
assert.equal(splitMissing.items.find(x=>x.symbol==='NVDA').value,null);
const wrongPriceDay=buildAiFinancialEvidence({...args,usSessionDate:'2026-11-04'});
assert.equal(wrongPriceDay.coverage.referencePbr,0);
const wrongPbrMath=buildAiFinancialEvidence({...args,fyValues:{
 ...fyValues,snapshots:fyValues.snapshots.map(x=>x.symbol==='MSFT'
  ?{...x,pbrTimes:20}:x)}});
assert.equal(wrongPbrMath.items.find(x=>x.symbol==='MSFT').value,null);
const invalidTTM=buildAiFinancialEvidence({...args,ttm:{
 ...ttm,reports:ttm.reports.map(x=>x.symbol==='MSFT'
  ?{...x,calculated:{freeCashFlow:90e9}}:x)}});
assert.equal(invalidTTM.items.find(x=>x.symbol==='MSFT').ttm,null);
const futureDart=buildAiFinancialEvidence({...args,domesticQuotes:
 domesticQuotes.map(x=>({...x,date:'2026-11-09'}))});
assert.equal(futureDart.domestic[0].evidence.pbrTimes,null);
assert.equal(futureDart.domestic[1].evidence.pbrTimes,null);
const staleDomesticClose=buildAiFinancialEvidence({...args,
 domesticQuotes:domesticQuotes.map(x=>({...x,date:'2026-09-01'}))});
assert.equal(staleDomesticClose.domestic[0].evidence.bpsKrw,55000,
 'verified DART BPS stays visible despite stale close');
assert.equal(staleDomesticClose.domestic[0].evidence.pbrTimes,null,
 'stale NH close must never produce a current PBR');
assert.equal(staleDomesticClose.domestic[1].evidence.pbrTimes,null);
const noExpectedDomesticDate=buildAiFinancialEvidence({
 ...args,domesticSessionDate:null});
assert.equal(noExpectedDomesticDate.domestic[0].evidence.pbrTimes,null,
 'absent expected Korean session must fail closed');
assert.match(formatAiFinancialEvidence(noExpectedDomesticDate).join('\n'),
 /PBR 종가 미연결/,
 'public DART-only prefetch must not be described as failed PBR collection');
const previousSessionEvidence=buildAiFinancialEvidence({
 ...args,domesticSessionDate:'2026-11-05',
 domesticQuotes:domesticQuotes.map(x=>({...x,date:'2026-11-05'}))});
assert.equal(previousSessionEvidence.domestic[1].evidence.pbrTimes,2.5,
 'morning may explicitly declare preceding completed domestic session');

const missingDart=buildAiFinancialEvidence({...args,dart:{statuses:[
 {symbol:'005930',status:'DART_KEY_NOT_CONFIGURED'},
 {symbol:'000660',status:'DART_KEY_NOT_CONFIGURED'}],rows:[]}});
assert.equal(missingDart.coverage.domestic,0);
const duplicateSec=buildAiFinancialEvidence({...args,ttm:{
 ...ttm,reports:[...ttm.reports,ttm.reports[0]]}});
assert.equal(duplicateSec.items.find(x=>x.symbol==='MSFT').ttm,null);
assert.equal(buildAiFinancialEvidence({...args,asOfKst:'2026-13-42'}).kind,
 'AI_FINANCIAL_EVIDENCE_UNVERIFIED');
assert.deepEqual(formatAiFinancialEvidence({...verified,coverage:null}),[]);
assert.deepEqual(formatAiFinancialEvidence({...verified,
 items:[...verified.items.slice(0,8),verified.items[0]]}),[]);
assert.deepEqual(formatAiFinancialEvidence(verified,{maxLength:30}),[]);

const morningNoEvidence=formatFullMorningBriefing(asOfKst,null,[],{
 now:new Date('2026-11-05T22:40:00Z')});
const morningWithEvidence=formatFullMorningBriefing(asOfKst,null,[],{
 now:new Date('2026-11-05T22:40:00Z'),financialEvidence:verified});
assert.ok(morningWithEvidence.length<=3900);
assert.match(morningWithEvidence,/삼성전자·SK하이닉스 정량 지표/);
assert.doesNotMatch(morningWithEvidence,/5인 정량 관점|• 하워드 막스:|• 버핏:/);
if(morningWithEvidence.includes('■ 공시 재무 근거'))
 assert.match(morningWithEvidence,/미국 TTM 2\/9/);
else assert.equal(morningWithEvidence,morningNoEvidence,
 'optional evidence must be dropped entirely if length budget is full');

// Optional renderer refuses a complete-looking but wrong-day artifact.
assert.equal(formatFullMorningBriefing(asOfKst,null,[],{
 now:new Date('2026-11-05T22:40:00Z'),
 financialEvidence:{...verified,asOfKst:'2026-11-05'}}),
 morningNoEvidence);
assert.equal(formatFullMorningBriefing(asOfKst,null,[],{
 now:new Date('2026-11-05T22:40:00Z'),
 financialEvidence:{...verified,usSessionDate:'2026-11-04'}}),
 morningNoEvidence);

const closedAt=new Date('2026-11-06T17:00:00+09:00');
const closeArgs=[asOfKst,[],[],[],[],[],[],[],closedAt,[],[],null];
const closeNoEvidence=formatClose(...closeArgs);
const closeWithEvidence=formatClose(...closeArgs,verified);
assert.equal(formatClose(...closeArgs,{...verified,asOfKst:'2026-11-05'}),
 closeNoEvidence);
assert.equal(formatClose(...closeArgs,{...verified,usSessionDate:'2026-11-04'}),
 closeNoEvidence);
assert.match(closeWithEvidence,/삼성전자·SK하이닉스 정량 지표/);
assert.doesNotMatch(closeWithEvidence,/5인 정량 관점|• 하워드 막스:|• 버핏:/);
if(closeWithEvidence.includes('■ 공시 재무 근거'))
 assert.match(closeWithEvidence,/미국 TTM 2\/9/);
else assert.equal(closeWithEvidence,closeNoEvidence);
assert.ok(closeWithEvidence.length<=3900 || closeWithEvidence===closeNoEvidence,
 'optional evidence must not push close above budget');

// Actual SEND diagnostics must reflect the delivered text, not only a
// successfully downloaded SEC/DART artifact. No issuer prices are logged.
const sentPanel=formatAiFinancialEvidence(verified).join('\n');
const liveAudit=auditSentFinancialEvidence(sentPanel,usSessionDate);
assert.deepEqual(liveAudit,{
 status:'DISPLAYED',
 counts:{ttm:2,fyOnly:1,referencePbr:2,domestic:2},
 domesticLine:true
});
assert.deepEqual(auditSentFinancialEvidence('No sentPanel',usSessionDate),{
 status:'NOT_DISPLAYED',counts:null,domesticLine:false
});
const shortPanel=sentPanel.split('\n').slice(0,2).join('\n');
assert.equal(auditSentFinancialEvidence(shortPanel,usSessionDate).status,
 'PARTIAL_DISPLAYED');
assert.equal(auditSentFinancialEvidence(sentPanel,'2026-11-04').status,
 'UNVERIFIED_RENDER','a mismatched US regular session cannot be credited');
assert.equal(auditSentFinancialEvidence(sentPanel+'\n'+sentPanel,usSessionDate).status,
 'UNVERIFIED_RENDER','duplicated coverage can never prove one send');
assert.equal(auditSentFinancialEvidence(
 '■ 공시 재무 근거 (미국 '+usSessionDate+' 종가 참고)',usSessionDate
).status,'UNVERIFIED_RENDER','orphan heading is not data evidence');
assert.equal(auditSentFinancialEvidence(
 sentPanel.replace('미국 TTM 2/9','미국 TTM 99/9'),usSessionDate
).status,'UNVERIFIED_RENDER','counts above source universe refused');
const printedMorning=auditSentFinancialEvidence(morningWithEvidence,usSessionDate);
assert.equal(printedMorning.status,
 morningWithEvidence.includes('■ 공시 재무 근거')
  ?'DISPLAYED':'NOT_DISPLAYED');
const printedClose=auditSentFinancialEvidence(closeWithEvidence,usSessionDate);
assert.equal(printedClose.status,
 closeWithEvidence.includes('■ 공시 재무 근거')
  ?'DISPLAYED':'NOT_DISPLAYED');

let ordered=[];
const asyncResult=await collectAiFinancialEvidence({
 now:()=>new Date('2026-11-06T01:00:00Z'),usSessionDate,
 domesticSessionDate,
 readTtm:async()=>{ordered.push('TTM');return ttm;},
 readValues:async()=>{ordered.push('FY');return fyValues;},
 readDart:async()=>{ordered.push('DART');return dart;},
 domesticQuotes});
assert.deepEqual(ordered,['DART','TTM','FY'],
 'DART first while SEC readers remain strictly sequential');
assert.deepEqual(asyncResult.coverage,verified.coverage);
assert.equal(asyncResult.gasDeployments,0);
console.log('FINANCIAL_EVIDENCE_BRIEFING_PASS source dates, FCF/PBR, missing, concise metrics and length');
