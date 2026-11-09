import assert from 'node:assert/strict';
import {SEMI_ISSUER_RELEASES,evaluateSemiconductorCompanyViews,
 formatSemiconductorCompanyFiveViews}
 from './briefing-semiconductor-company-views.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';

const date='2026-11-06',usDate='2026-11-05';
const sam=SEMI_ISSUER_RELEASES.find(x=>x.id==='SAMSUNG');
const hynix=SEMI_ISSUER_RELEASES.find(x=>x.id==='SKHYNIX');
assert.equal(SEMI_ISSUER_RELEASES.length,2);
assert.equal(sam.revenueTrillion,195.3);
assert.equal(sam.basis,'ISSUER_Q3_2026_REPORTED',
 'Samsung 2026-10-29 published quarterly results must not be described as preliminary');
assert.equal(hynix.basis,'ISSUER_Q3_2026_PRELIMINARY',
 'SK hynix issuer 2026-10-28 release is preliminary');
assert.equal(sam.operatingProfitTrillion,107.4);
assert.equal(sam.quarterlyCommonEpsKrw,11462);
assert.equal(sam.annualCapexPlanTrillion,84.4);
assert.equal(hynix.revenueTrillion,104.6155);
assert.equal(hynix.operatingProfitTrillion,83.3338);
assert.equal(hynix.netCashTrillion,98.7);
assert.ok(sam.url.startsWith('https://news.samsung.com/'));
assert.ok(hynix.url.startsWith('https://news.skhynix.com/'));
const morningPrices=[
 {label:'삼성전자',symbol:'005930.KS',date:'2026-11-05',source:'NH_REGULAR_CLOSE',value:180000},
 {label:'SK하이닉스',symbol:'000660.KS',date:'2026-11-05',source:'NH_REGULAR_CLOSE',value:200000}
];
const closingPrices=morningPrices.map((x,i)=>({...x,
 id:i?'SKHYNIX':'SAMSUNG',date}));
const financial={
 kind:'AI_FINANCIAL_EVIDENCE_READ_ONLY',asOfKst:date,usSessionDate:usDate,
 domestic:[
  {symbol:'005930',name:'삼성전자',evidence:{period:'2026-06-30',filingDate:'2026-08-15',
    bpsKrw:120000,status:'INDICATIVE_MULTICLASS_BPS',indicative:true,
    priceDate:null,pbrTimes:null}},
  {symbol:'000660',name:'SK하이닉스',evidence:{period:'2026-06-30',filingDate:'2026-08-15',
    bpsKrw:100000,status:'VERIFIED_SINGLECLASS_BPS',indicative:false,
    priceDate:null,pbrTimes:null}}
 ]
};
let rows=evaluateSemiconductorCompanyViews({date,stocks:morningPrices,financialEvidence:financial});
assert.deepEqual(rows.map(x=>x.name),['삼성전자','SK하이닉스']);
assert.ok(Math.abs(rows[0].operatingMarginPercent-54.99)<0.1);
assert.ok(Math.abs(rows[1].operatingMarginPercent-79.66)<0.1);
assert.equal(rows[0].book.pbr,1.5);
assert.equal(rows[0].book.indicative,true);
assert.equal(rows[1].book.pbr,2);
assert.match(rows[0].valueLine,/보통·우선 합산 참고 BPS 120,000원/);
assert.match(rows[0].valueLine,/참고 PBR 1.50배/);
assert.doesNotMatch(rows[0].valueLine,/검증 BPS/);
assert.match(rows[1].valueLine,/검증 BPS 100,000원/);
assert.match(rows[1].valueLine,/PBR 2.00배/);
const view=formatSemiconductorCompanyFiveViews({date,stocks:morningPrices,financialEvidence:financial}).join('\n');
for(const name of ['버핏','애크먼','린치','다모다란','막스','삼성전자','SK하이닉스'])
 assert.ok(view.includes(name),name);
assert.match(view,/84.4조/);
assert.match(view,/98.7조/);
assert.match(view,/1.50배/);
assert.match(view,/2.00배/);
assert.match(view,/적정가 아님/);
assert.match(view,/삼성 BPS\/PBR: 지배자본÷보통·우선 합산 유통주식 참고치/);
assert.match(view,/주식종류별 권리 차이 미반영/);
assert.match(view,/삼성 3Q26 10\/29 실적 발표·하닉 10\/28 잠정 발표/);
assert.match(view,/BPS는 표시된 DART 결산일 기준/);
assert.doesNotMatch(view,/3Q26 기업 잠정 발표\(10\/28~29\)/);
assert.match(view,/분기 EPS/);
assert.doesNotMatch(view,/확정 FCF|확정 ROIC|PER [0-9]+배/);
assert.ok(view.length<1300,'must fit within full Telegram daily market briefing');

const missing=evaluateSemiconductorCompanyViews({date,stocks:morningPrices,financialEvidence:null});
assert.equal(missing.length,2);
assert.ok(missing.every(x=>x.book===null));
assert.ok(missing.every(x=>x.price));
const unverifiedViews=formatSemiconductorCompanyFiveViews({date,
 stocks:morningPrices}).join('\n');
assert.match(unverifiedViews,/BPS·PBR 미확보/);
assert.match(unverifiedViews,/삼성 BPS\/PBR 미확보/);
assert.match(unverifiedViews,/하닉 BPS\/PBR 미확보/);
assert.doesNotMatch(unverifiedViews,/하닉: 단일종류 BPS 검증/,
 'without DART evidence the footer must not certify Hynix BPS');
const onlySamsung=formatSemiconductorCompanyFiveViews({date,stocks:morningPrices,
 financialEvidence:{...financial,domestic:[financial.domestic[0],
 {...financial.domestic[1],evidence:null}]}}).join('\n');
assert.match(onlySamsung,/삼성 BPS\/PBR: 지배자본÷보통·우선 합산/);
assert.match(onlySamsung,/하닉 BPS\/PBR 미확보/);
const onlyHynix=formatSemiconductorCompanyFiveViews({date,stocks:morningPrices,
 financialEvidence:{...financial,domestic:[{...financial.domestic[0],evidence:null},
 financial.domestic[1]]}}).join('\n');
assert.match(onlyHynix,/삼성 BPS\/PBR 미확보/);
assert.match(onlyHynix,/하닉: 단일종류 BPS 검증/);
assert.equal(evaluateSemiconductorCompanyViews({date:'2027-02-01'}).length,0,
 'dated release must not be reused without bounds after next report season');
assert.equal(evaluateSemiconductorCompanyViews({date:'2026-10-28'}).length,0,
 'Samsung 3Q release was not published on October 28');
for(const changed of [
 {...financial,asOfKst:'2026-11-05'},
 {...financial,usSessionDate:'2026-11-04'},
 {...financial,kind:'UNVERIFIED'},
 {...financial,domestic:financial.domestic.map(x=>({...x,evidence:{...x.evidence,
  filingDate:'2026-11-06'}}))},
 {...financial,domestic:financial.domestic.map(x=>({...x,evidence:{...x.evidence,
  bpsKrw:-1}}))}
 ]){
 const result=evaluateSemiconductorCompanyViews({date,stocks:morningPrices,financialEvidence:changed});
 assert.ok(result.every(x=>x.book===null),'bad evidence cannot produce PBR');
}
const duplicateBook=evaluateSemiconductorCompanyViews({date,stocks:morningPrices,
 financialEvidence:{...financial,domestic:[financial.domestic[0],financial.domestic[0],
 financial.domestic[1]]}});
assert.equal(duplicateBook[0].book,null,'Samsung repeated BPS must fail');
assert.equal(duplicateBook[1].book.pbr,2,'independent SK BPS must survive duplicate Samsung');
for(const corrupted of [
 morningPrices.map(x=>({...x,source:'Yahoo Finance 일봉'})),
 morningPrices.map(x=>({...x,date:'2026-11-04'})),
 morningPrices.map(x=>({...x,label:'wrong'})),
 morningPrices.map(x=>({...x,value:0}))
 ]){
 const result=evaluateSemiconductorCompanyViews({date,stocks:corrupted,financialEvidence:financial});
 assert.ok(result.every(x=>x.book===null),'invalid close must never generate PBR');
}
const duplicatePrice=evaluateSemiconductorCompanyViews({date,
 stocks:[...morningPrices,morningPrices[0]],financialEvidence:financial});
assert.equal(duplicatePrice[0].book,null,'Samsung repeated close must fail');
assert.equal(duplicatePrice[1].book.pbr,2,'independent SK quote must survive duplicate Samsung');
const close=evaluateSemiconductorCompanyViews({date,period:'close',
 stocks:closingPrices,financialEvidence:financial});
assert.equal(close[0].book.pbr,1.5);
assert.equal(close[1].book.pbr,2);
const krxClose=closingPrices.map(x=>({...x,source:'KRX_OFFICIAL'}));
const official=evaluateSemiconductorCompanyViews({date,period:'close',
 stocks:krxClose,financialEvidence:financial});
assert.equal(official[0].book.pbr,1.5);
assert.match(official[0].valueLine,/KRX/);

// Independent read-only DART evidence may already include an exact-session
// NH PBR. It must be accepted only if its date and numeric PBR agree with
// the separate verified close. The prior strict-null requirement discarded it.
const datedDomestic=(day,prices)=>({...financial,domesticSessionDate:day,
 domestic:financial.domestic.map((r,i)=>({
  ...r,evidence:{...r.evidence,priceDate:day,
   pbrTimes:prices[i].value/r.evidence.bpsKrw}
 }))});
const pricedMorning=datedDomestic('2026-11-05',morningPrices);
const confirmedMorning=evaluateSemiconductorCompanyViews({
 date,period:'morning',stocks:morningPrices,financialEvidence:pricedMorning
});
assert.deepEqual(confirmedMorning.map(r=>r.book?.pbr),[1.5,2],
 'matching exact-day independently priced DART PBR must be displayed');
assert.match(formatSemiconductorCompanyFiveViews({
 date,stocks:morningPrices,financialEvidence:pricedMorning
}).join('\n'),/참고 PBR 1\.50배/);
const pricedClosing=datedDomestic(date,closingPrices);
const confirmedClose=evaluateSemiconductorCompanyViews({
 date,period:'close',stocks:closingPrices,financialEvidence:pricedClosing
});
assert.deepEqual(confirmedClose.map(r=>r.book?.pbr),[1.5,2]);
for(const unsafe of [
 {...pricedMorning,domesticSessionDate:date},
 {...pricedMorning,domestic:pricedMorning.domestic.map(r=>({
  ...r,evidence:{...r.evidence,priceDate:'2026-11-04'}}))},
 {...pricedMorning,domestic:pricedMorning.domestic.map(r=>({
  ...r,evidence:{...r.evidence,pbrTimes:r.evidence.pbrTimes+0.5}}))},
 {...pricedMorning,domestic:pricedMorning.domestic.map(r=>({
  ...r,evidence:{...r.evidence,pbrTimes:null}}))}
]){
 assert(evaluateSemiconductorCompanyViews({date,stocks:morningPrices,
  financialEvidence:unsafe}).every(r=>r.book===null),
  'stale/mismatched DART PBR must never appear as exact confirmed');
}
const crossDay=evaluateSemiconductorCompanyViews({
 date,period:'close',stocks:closingPrices,financialEvidence:pricedMorning
});
assert(crossDay.every(r=>r.book===null),
 'close must not reuse previous-session PBR as today confirmed');

assert.ok(evaluateSemiconductorCompanyViews({date,period:'close',stocks:morningPrices,
 financialEvidence:financial}).every(x=>x.book===null),
 'closing price must have the production stock id and exact same session');
const marketMorning=formatFullMorningBriefing(date,null,morningPrices,{
 now:new Date('2026-11-06T07:45:00+09:00'),financialEvidence:null});
assert.match(marketMorning,/삼성전자·SK하이닉스 5인 정량 관점/);
assert.match(marketMorning,/분기 EPS 11,462/);
assert.ok(marketMorning.length<=3900);
const marketClose=formatClose(date,[],[],[],closingPrices,[],[],[],
 new Date('2026-11-06T17:00:00+09:00'));
assert.match(marketClose,/삼성전자·SK하이닉스 5인 정량 관점/);
assert.match(marketClose,/순현금 98.7조/);
assert.ok(marketClose.length<=4000);
console.log('SEMICONDUCTOR_FIVE_VIEWS_PASS issuer=2 investor_lenses=5 book_price_date=exact no_dart_key=true');
