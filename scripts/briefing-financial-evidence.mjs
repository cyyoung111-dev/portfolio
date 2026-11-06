// Optional read-only evidence adapter for the five-investor market briefings.
// It does not fetch on the punctual Telegram path and NEVER sends or writes.
import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {DART_SEMICONDUCTORS,calculateDomesticReferencePbr}
 from './briefing-dart-semiconductor-sources.mjs';
import {readAiNineTtmSecFacts} from './briefing-ai-nine-sec-ttm.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';
import {readTwoDomesticDartBps} from './briefing-dart-semiconductor-sources.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=d=>typeof d==='string'&&DAY.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e16;
const positive=x=>num(x)&&x>0;
const exact=(xs,symbol)=>Array.isArray(xs)
 ?(xs.filter(x=>x?.symbol===symbol).length===1
   ?xs.find(x=>x?.symbol===symbol):null):null;
const validDate=(d,asOf)=>day(d)&&day(asOf)&&d<=asOf;
const dollars=n=>num(n)?(n/1e9).toFixed(1)+'B':'미확보';

function ttmRow(item,source,asOf){
 const st=exact(source?.statuses,item.symbol);
 const doc=exact(source?.reports,item.symbol);
 if(!st||!doc||!validDate(doc.periodEnd,asOf))return null;
 const expected=st.status==='VERIFIED_TTM'
  ?'FY_PLUS_CURRENT_YTD_MINUS_PRIOR_YTD'
  :st.status==='FY_ONLY'?'REPORTED_FY':null;
 if(!expected||doc.method!==expected)return null;
 if(st.status==='VERIFIED_TTM'
  &&(!validDate(doc.quarterFiledAt,asOf)||!doc.quarterAccession
   ||!doc.annualAccession))return null;
 if(st.status==='FY_ONLY'&&!doc.annualAccession)return null;
 const ocf=doc.fields?.operatingCashFlow,capex=doc.fields?.capex;
 const fcf=num(ocf)&&num(capex)&&capex>=0?ocf-capex:null;
 if(!num(fcf))return null;
 if(st.status==='VERIFIED_TTM'
  &&(!num(doc.calculated?.freeCashFlow)
   ||Math.abs(doc.calculated.freeCashFlow-fcf)>Math.max(1,Math.abs(fcf)*1e-8)))
  return null;
 return {basis:st.status==='VERIFIED_TTM'?'TTM':'FY',period:doc.periodEnd,
  fcfUsd:fcf,capexUsd:capex,ocfUsd:ocf,
  capexToOcfPercent:positive(ocf)?100*capex/ocf:null};
}

function valueRow(item,source,expectedUsDate,asOf){
 const st=exact(source?.statuses,item.symbol);
 const snap=exact(source?.snapshots,item.symbol);
 if(!st||!snap||st.status!=='VERIFIED_FY_BPS_PBR'
  ||snap.source!=='SEC_10K_US_GAAP'
  ||snap.priceSource!=='YAHOO_DAILY_REFERENCE'
  ||snap.symbol!==item.symbol
  ||!day(expectedUsDate)||snap.priceDate!==expectedUsDate
  ||!validDate(snap.asOf,asOf)||!validDate(snap.reportedAt,asOf)
  ||snap.reportedAt>snap.priceDate
  ||!positive(snap.splitAdjustedBpsUsd)
  ||!positive(snap.bpsUsd)||!positive(snap.pbrTimes)
  ||!positive(snap.priceUsd)
  ||!positive(snap.splitSharesPerOldShare))return null;
 const implied=snap.priceUsd/snap.splitAdjustedBpsUsd;
 if(Math.abs(implied-snap.pbrTimes)>Math.max(0.015,implied*0.0001))
  return null;
 return {period:snap.asOf,filingDate:snap.reportedAt,
  priceDate:expectedUsDate,bpsUsd:snap.bpsUsd,
  pbrTimes:snap.pbrTimes,
  note:'FY_BPS_YAHOO_PRICE_REFERENCE_SPLIT_ADJUSTED_NOT_CURRENT_QUARTER'};
}

function domesticRow(item,source,asOf,domesticQuotes=[]){
 const st=exact(source?.statuses,item.symbol);
 const snap=exact(source?.rows,item.symbol);
 if(!st||!snap||!['VERIFIED_SINGLECLASS_BPS','INDICATIVE_MULTICLASS_BPS'].includes(st.status)
  ||snap.source!=='OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL'
  ||snap.corpCode!==item.corpCode||snap.currency!=='KRW'
  ||!validDate(snap.period,asOf)||!validDate(snap.filingDate,asOf)
  ||snap.period>snap.filingDate||!positive(snap.referenceBpsKrw))return null;
 const q=exact(domesticQuotes,item.symbol);
 const pbr=q&&validDate(q.date,asOf)?calculateDomesticReferencePbr(snap,q):null;
 return {period:snap.period,filingDate:snap.filingDate,
  bpsKrw:snap.referenceBpsKrw,
  status:st.status,priceDate:pbr?.sourceDate??null,
  pbrTimes:pbr?.status==='VERIFIED_SINGLECLASS_PBR'
   ||pbr?.status==='INDICATIVE_MULTICLASS_PBR'?pbr.value:null,
  indicative:st.status==='INDICATIVE_MULTICLASS_BPS'};
}

export function buildAiFinancialEvidence({
 asOfKst,usSessionDate,ttm={},fyValues={},dart={},domesticQuotes=[]
}={}){
 if(!day(asOfKst)||!day(usSessionDate)||usSessionDate>asOfKst)
  return {kind:'AI_FINANCIAL_EVIDENCE_UNVERIFIED',items:[],domestic:[]};
 const items=AI_NINE.map(item=>({symbol:item.symbol,
  ttm:ttmRow(item,ttm,asOfKst),
  value:valueRow(item,fyValues,usSessionDate,asOfKst)}));
 const domestic=DART_SEMICONDUCTORS.map(item=>({symbol:item.symbol,
  name:item.name,evidence:domesticRow(item,dart,asOfKst,domesticQuotes)}));
 return {kind:'AI_FINANCIAL_EVIDENCE_READ_ONLY',asOfKst,usSessionDate,
  items,domestic,
  coverage:{ttm:items.filter(x=>x.ttm?.basis==='TTM').length,
   fyOnly:items.filter(x=>x.ttm?.basis==='FY').length,
   referencePbr:items.filter(x=>x.value).length,
   domestic:domestic.filter(x=>x.evidence).length},
  portfolioWrites:0,telegramSends:0,gasDeployments:0};
}

// Explicitly opt in to this collector in a separate prefetch job only.
// Sequential SEC readers respect source fair-access and never block 07:40/17:00.
export async function collectAiFinancialEvidence({
 now=()=>new Date(),readTtm=readAiNineTtmSecFacts,
 readValues=readAiNineAnnualValueSnapshots,
 readDart=readTwoDomesticDartBps,usSessionDate,domesticQuotes=[]
}={}){
 const instant=now();
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))
  throw Error('FINANCIAL_EVIDENCE_CLOCK_INVALID');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
 const ttm=await readTtm({now});
 const fyValues=await readValues({now});
 const dart=await readDart({now});
 return buildAiFinancialEvidence({
  asOfKst:date,usSessionDate,ttm,fyValues,dart,domesticQuotes});
}

const preferred=['NVDA','MSFT','GOOGL','AMZN','META','ORCL','MU','SNDK','AAPL'];
const compact=x=>{
 if(!x?.ttm&&!x?.value)return null;
 const parts=[];
 if(x.ttm){
  parts.push(x.ttm.basis+' FCF $'+dollars(x.ttm.fcfUsd));
  if(num(x.ttm.capexToOcfPercent))
   parts.push('CAPEX/OCF '+x.ttm.capexToOcfPercent.toFixed(0)+'%');
 }
 if(x.value)parts.push('FY BPS 
 return x.symbol+' '+parts.join(' · ');
};
export function formatAiFinancialEvidence(evidence,{maxLength=680}={}){
 if(evidence?.kind!=='AI_FINANCIAL_EVIDENCE_READ_ONLY'
  ||!day(evidence?.asOfKst)||!day(evidence?.usSessionDate)
  ||!Array.isArray(evidence.items)||evidence.items.length!==9
  ||!Array.isArray(evidence.domestic)||evidence.domestic.length!==2
  ||!Number.isInteger(maxLength)||maxLength<100||maxLength>1200)return [];
 const coverage=evidence.coverage;
 if(!coverage||!['ttm','fyOnly','referencePbr','domestic'].every(k=>
  Number.isInteger(coverage[k])&&coverage[k]>=0&&coverage[k]<=9)
  ||new Set(evidence.items.map(x=>x?.symbol)).size!==9
  ||new Set(evidence.domestic.map(x=>x?.symbol)).size!==2)return [];
 const header='■ 공시 재무 근거 (미국 '+evidence.usSessionDate+' 종가 참고)';
 const count='• 검증 범위: 미국 TTM '+coverage.ttm+'/9·FY만 '+coverage.fyOnly
  +'/9·FY PBR '+coverage.referencePbr+'/9, 국내 DART BPS '+coverage.domestic+'/2';
 const bySymbol=new Map(evidence.items.map(x=>[x.symbol,x]));
 const lines=[header,count];
 for(const sym of preferred){
  const v=compact(bySymbol.get(sym));
  if(!v)continue;
  if([...lines,v,'• 미국 FY 장부가와 최근 종가, 회사별 결산일 차이 주의.'].join('\n').length>maxLength)
   break;
  lines.push('• '+v);
 }
 const d=evidence.domestic.map(x=>{
  const r=x.evidence;
  if(!r)return x.name+' 미확보';
  return x.name+' '+(r.indicative?'참고':'확인')+' BPS '+Math.round(r.bpsKrw).toLocaleString('en-US')+'원'
   +(positive(r.pbrTimes)?' / '+r.pbrTimes.toFixed(2)+'배':' / PBR 미확보');
 }).join('; ');
 const dLine='• 국내: '+d;
 if([...lines,dLine].join('\n').length<=maxLength)lines.push(dLine);
 const caution='• 5인 관점: FCF·CAPEX는 AI 전용 투자액/소유주이익/ROIC가 아님. FY PBR은 DCF 내재가치가 아니며 CDS 시장 5Y 종가 미확보.';
 if([...lines,caution].join('\n').length<=maxLength)lines.push(caution);
 return lines;
}
+x.value.bpsUsd.toFixed(2)
  +' / 조정 PBR '+x.value.pbrTimes.toFixed(1)+'배');
 return x.symbol+' '+parts.join(' · ');
};
export function formatAiFinancialEvidence(evidence,{maxLength=680}={}){
 if(evidence?.kind!=='AI_FINANCIAL_EVIDENCE_READ_ONLY'
  ||!day(evidence?.asOfKst)||!day(evidence?.usSessionDate)
  ||!Array.isArray(evidence.items)||evidence.items.length!==9
  ||!Array.isArray(evidence.domestic)||evidence.domestic.length!==2
  ||!Number.isInteger(maxLength)||maxLength<100||maxLength>1200)return [];
 const coverage=evidence.coverage;
 if(!coverage||!['ttm','fyOnly','referencePbr','domestic'].every(k=>
  Number.isInteger(coverage[k])&&coverage[k]>=0&&coverage[k]<=9)
  ||new Set(evidence.items.map(x=>x?.symbol)).size!==9
  ||new Set(evidence.domestic.map(x=>x?.symbol)).size!==2)return [];
 const header='■ 공시 재무 근거 (미국 '+evidence.usSessionDate+' 종가 참고)';
 const count='• 검증 범위: 미국 TTM '+coverage.ttm+'/9·FY만 '+coverage.fyOnly
  +'/9·FY PBR '+coverage.referencePbr+'/9, 국내 DART BPS '+coverage.domestic+'/2';
 const bySymbol=new Map(evidence.items.map(x=>[x.symbol,x]));
 const lines=[header,count];
 for(const sym of preferred){
  const v=compact(bySymbol.get(sym));
  if(!v)continue;
  if([...lines,v,'• 미국 FY 장부가와 최근 종가, 회사별 결산일 차이 주의.'].join('\n').length>maxLength)
   break;
  lines.push('• '+v);
 }
 const d=evidence.domestic.map(x=>{
  const r=x.evidence;
  if(!r)return x.name+' 미확보';
  return x.name+' '+(r.indicative?'참고':'확인')+' BPS '+Math.round(r.bpsKrw).toLocaleString('en-US')+'원'
   +(positive(r.pbrTimes)?' / '+r.pbrTimes.toFixed(2)+'배':' / PBR 미확보');
 }).join('; ');
 const dLine='• 국내: '+d;
 if([...lines,dLine].join('\n').length<=maxLength)lines.push(dLine);
 const caution='• 5인 관점: FCF·CAPEX는 AI 전용 투자액/소유주이익/ROIC가 아님. FY PBR은 DCF 내재가치가 아니며 CDS 시장 5Y 종가 미확보.';
 if([...lines,caution].join('\n').length<=maxLength)lines.push(caution);
 return lines;
}
