// Official quarterly issuer statements, NOT audited 10-Q facts, and not a
// substitute for confirmed FY/TTM EPS, FCF, ROIC or owner earnings.
// No DART key, external fetch, GAS, sheet mutation, or Telegram access.
import {expectedMorningDate} from './telegram-morning-report.mjs';

export const SEMI_ISSUER_RELEASES=Object.freeze([
 Object.freeze({
  id:'SAMSUNG',symbol:'005930.KS',code:'005930',name:'삼성전자',
  date:'2026-10-29',period:'2026-09-30',basis:'ISSUER_Q3_2026_REPORTED',
  url:'https://news.samsung.com/kr/삼성전자-2026년-3분기-실적-발표',
  revenueTrillion:195.3,operatingProfitTrillion:107.4,dsProfitTrillion:106.5,
  quarterlyCommonEpsKrw:11462,annualCapexPlanTrillion:84.4
 }),
 Object.freeze({
  id:'SKHYNIX',symbol:'000660.KS',code:'000660',name:'SK하이닉스',
  date:'2026-10-28',period:'2026-09-30',basis:'ISSUER_Q3_2026_PRELIMINARY',
  url:'https://news.skhynix.com/en/q3-2026-business-results/',
  revenueTrillion:104.6155,operatingProfitTrillion:83.3338,
  priorYearQuarterOperatingProfitTrillion:11.3834,
  netProfitTrillion:39.7756,netCashTrillion:98.7,
  contracted2027And2028CapacityLowerBoundPercent:50
 })
]);
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const num=n=>Math.round(n).toLocaleString('en-US');
const pct=n=>n.toFixed(1)+'%';
const round=x=>x.toFixed(2);
function verifiedPrice(item,date,period,stocks){
 const expected=period==='morning'?expectedMorningDate('SAMSUNG',date):date;
 if(!day(expected)||!Array.isArray(stocks))return null;
 const matches=stocks.filter(x=>x?.symbol===item.symbol);
 if(matches.length!==1)return null;
 const q=matches[0];
 if(q.date!==expected||q.label!==item.name||!finitePositive(q.value)
  ||!['NH_REGULAR_CLOSE','KRX_OFFICIAL'].includes(q.source))return null;
 if(period==='close'&&q.id!==item.id)return null;
 return {date:expected,value:q.value,source:q.source};
}
function verifiedBook(item,date,financialEvidence,price){
 if(!financialEvidence||financialEvidence.kind!=='AI_FINANCIAL_EVIDENCE_READ_ONLY'
  ||financialEvidence.asOfKst!==date
  ||financialEvidence.usSessionDate!==expectedMorningDate('SPX',date)
  ||!Array.isArray(financialEvidence.domestic)||!price)return null;
 const items=financialEvidence.domestic.filter(x=>x?.symbol===item.code
  &&x.name===item.name);
 if(items.length!==1)return null;
 const e=items[0]?.evidence;
 if(!e||!finitePositive(e.bpsKrw)||!day(e.period)||!day(e.filingDate)
  ||e.period>e.filingDate||e.filingDate>=price.date
  ||!['INDICATIVE_MULTICLASS_BPS','VERIFIED_SINGLECLASS_BPS'].includes(e.status)
  ||e.indicative!==(e.status==='INDICATIVE_MULTICLASS_BPS'))return null;
 const computedPbr=price.value/e.bpsKrw;
 // DART prefetch may already have priced this exact BPS using a dated NH
 // confirmed close. Do not discard such valid evidence; compare it against
 // the *independent* confirmed close passed to the rendering step.
 const unpriced=e.priceDate===null&&e.pbrTimes===null;
 const independentlyVerified=e.priceDate===price.date
  &&financialEvidence.domesticSessionDate===price.date
  &&finitePositive(e.pbrTimes)
  &&Math.abs(e.pbrTimes-computedPbr)<=Math.max(0.015,computedPbr*0.0001);
 if(!unpriced&&!independentlyVerified)return null;
 return {bps:e.bpsKrw,pbr:computedPbr,indicative:e.indicative,
  filingDate:e.filingDate,period:e.period};
}
export function evaluateSemiconductorCompanyViews({
 date,period='morning',stocks=[],financialEvidence=null
}={}){
 if(!day(date)||date<'2026-10-29'||date>'2026-12-31'
  ||!['morning','close'].includes(period))return [];
 return SEMI_ISSUER_RELEASES.map(item=>{
  const price=verifiedPrice(item,date,period,stocks);
  const book=verifiedBook(item,date,financialEvidence,price);
  const margin=item.operatingProfitTrillion/item.revenueTrillion*100;
  const dsShare=item.id==='SAMSUNG'
   ?item.dsProfitTrillion/item.operatingProfitTrillion*100:null;
  const earningsGrowth=item.id==='SKHYNIX'
   ?(item.operatingProfitTrillion/item.priorYearQuarterOperatingProfitTrillion-1)*100:null;
  const valueLine=book
   ?(book.indicative?'보통·우선 합산 참고 BPS ':'검증 BPS ')+num(book.bps)+'원 / '+(book.indicative?'참고 ':'')+'PBR '
     +round(book.pbr)+'배 ['+book.period+' 연결 · '+price.date+' '+(price.source==='NH_REGULAR_CLOSE'?'NH':'KRX')+']'
   :price?'종가 '+num(price.value)+'원 ['+price.date+'] / BPS·PBR 미확보'
    :'확정 종가·BPS·PBR 미확보';
  const buffett=item.id==='SAMSUNG'
   ?'DS 영업익 비중 '+pct(dsShare)+'; 유지투자·ROIC·소유주 FCF 미확보'
   :'영업이익률 '+pct(margin)+'; 유지투자·ROIC·소유주 FCF 미확보';
  const ackman=item.id==='SAMSUNG'
   ?'연간 설비투자 계획 '+item.annualCapexPlanTrillion+'조원(실집행/FCF 아님)'
   :'순현금 '+item.netCashTrillion+'조원·27~28년 생산능력 50% 초과 LTA(기업 발표)';
  const lynch=item.id==='SAMSUNG'
   ?'분기 EPS '+num(item.quarterlyCommonEpsKrw)+'원; TTM PER로 환산 금지'
   :'영업익 전년동기 +'+pct(earningsGrowth)+'; TTM EPS·PER 미확보';
  const damodaran=book
   ?'PBR '+round(book.pbr)+'배; 1·1.5·2배 BPS 가격 민감도 '
      +[1,1.5,2].map(x=>num(book.bps*x)).join('/')+'원(적정가 아님)'
   :'현금흐름·할인율·BPS 미확보로 DCF/PBR 적정가 유보';
  const marks=item.id==='SAMSUNG'
   ?'영업익 DS 집중 '+pct(dsShare)+'와 메모리 가격 정상화 충격 점검'
   :'영업이익률 '+pct(margin)+'의 정상화/공급확대 위험 점검';
  return {id:item.id,name:item.name,asOf:item.date,period:item.period,
   sourceUrl:item.url,sourceBasis:item.basis,
   revenueTrillion:item.revenueTrillion,
   operatingProfitTrillion:item.operatingProfitTrillion,
   operatingMarginPercent:margin,price,book,valueLine,
   views:{buffett,ackman,lynch,damodaran,marks}};
 });
}
// The market briefing is a constrained channel: preserve exact-date issuer
// metrics while leaving investor-framework commentary out of Telegram.
// The original detailed five-framework evaluator stays available offline.
export function formatSemiconductorCompanyMetrics(input={}){
 const evaluated=evaluateSemiconductorCompanyViews(input);
 if(evaluated.length!==2)return [];
 return [
  '■ 삼성전자·SK하이닉스 정량 지표',
  ...evaluated.map(x=>'• '+x.name+': '+x.valueLine)
 ];
}
// Two per-company numeric evidence anchors, then 5 separate frameworks applied
// to both firms. 5 investors' actual statements are NOT inferred.
export function formatSemiconductorCompanyFiveViews(input={}){
 const a=evaluateSemiconductorCompanyViews(input);
 if(a.length!==2)return [];
 const s=a.find(x=>x.id==='SAMSUNG'),h=a.find(x=>x.id==='SKHYNIX');
 const metric=x=>x.name+'[3Q26] 매출 '+x.revenueTrillion.toFixed(1)
  +'조/영업익 '+x.operatingProfitTrillion.toFixed(1)+'조/영업률 '
  +pct(x.operatingMarginPercent)+'; '+x.valueLine;
 const pbr=x=>x.book
  ?(x.book.indicative?'참고 PBR(보통·우선 합산) ':'PBR ')+round(x.book.pbr)+'배 (BPS×1/1.5/2='
    +[1,1.5,2].map(y=>num(x.book.bps*y)).join('/')+'원, 적정가 아님)'
  :'PBR·DCF 유보(BPS/FCF 미확보)';
 const bookProvenance='※ '+(s.book
  ?(s.book.indicative
    ?'삼성 BPS/PBR: 지배자본÷보통·우선 합산 유통주식 참고치(주식종류별 권리 차이 미반영)'
    :'삼성: 단일종류 BPS 검증')
  :'삼성 BPS/PBR 미확보')+'; '+(h.book
   ?(h.book.indicative?'하닉: 복수종류 참고 BPS':'하닉: 단일종류 BPS 검증')
   :'하닉 BPS/PBR 미확보')+'.';
 return [
  '■ 삼성전자·SK하이닉스 5인 정량 관점 (당일 실제 발언 아님)',
  '• '+metric(s),
  '• '+metric(h),
  '• 버핏: 삼전 DS 영업익 '+pct(s.operatingProfitTrillion
    ?SEMI_ISSUER_RELEASES[0].dsProfitTrillion/s.operatingProfitTrillion*100:0)
    +' 집중; 하닉 영업률 '+pct(h.operatingMarginPercent)
    +' → 양사 ROIC·소유주 FCF 미확보',
  '• 애크먼: 삼전 연 CAPEX계획 84.4조(실집행 아님); 하닉 순현금 98.7조·LTA 50% 초과',
  '• 피터 린치: 삼전 분기 EPS 11,462원(PER 아님); 하닉 영업익 YoY +'
    +pct((h.operatingProfitTrillion/SEMI_ISSUER_RELEASES[1].priorYearQuarterOperatingProfitTrillion-1)*100)
    +'(TTM PER 미확보)',
  '• 다모다란: 삼전 '+pbr(s)+'; 하닉 '+pbr(h),
  '• 하워드 막스: 삼전 DS 이익집중·메모리 정상화; 하닉 '+pct(h.operatingMarginPercent)
    +' 고마진 정상화·증설 위험',
  bookProvenance,
  '※ 삼성 3Q26 10/29 실적 발표·하닉 10/28 잠정 발표. BPS는 표시된 DART 결산일 기준; TTM EPS/FCF/ROIC·장기 PBR 분포 미확보.'
 ];
}
