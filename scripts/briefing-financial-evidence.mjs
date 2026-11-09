// Optional read-only evidence adapter for the five-investor market briefings.
// It does not fetch on the punctual Telegram path and NEVER sends or writes.
import {DART_SEMICONDUCTORS,calculateDomesticReferencePbr}
 from './briefing-dart-semiconductor-sources.mjs';

const AI_NINE=Object.freeze(['MSFT','AAPL','GOOGL','AMZN','META','NVDA','MU','ORCL','SNDK']
 .map(symbol=>Object.freeze({symbol})));
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

function domesticRow(item,source,asOf,domesticSessionDate,domesticQuotes=[]){
 const st=exact(source?.statuses,item.symbol);
 const snap=exact(source?.rows,item.symbol);
 if(!st||!snap||!['VERIFIED_SINGLECLASS_BPS','INDICATIVE_MULTICLASS_BPS'].includes(st.status)
  ||snap.source!=='OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL'
  ||snap.corpCode!==item.corpCode||snap.currency!=='KRW'
  ||!validDate(snap.period,asOf)||!validDate(snap.filingDate,asOf)
  ||snap.period>snap.filingDate||!positive(snap.referenceBpsKrw))return null;
 const q=exact(domesticQuotes,item.symbol);
 // A stale but historically valid NH close cannot price today's BPS.
 // The caller must supply the exact *completed Korean trading session* date.
 const exactClose=day(domesticSessionDate)&&domesticSessionDate<=asOf
  &&q?.date===domesticSessionDate;
 const pbr=exactClose?calculateDomesticReferencePbr(snap,q):null;
 return {period:snap.period,filingDate:snap.filingDate,
  bpsKrw:snap.referenceBpsKrw,
  status:st.status,priceDate:pbr?.sourceDate??null,
  pbrTimes:pbr?.status==='VERIFIED_SINGLECLASS_PBR'
   ||pbr?.status==='INDICATIVE_MULTICLASS_PBR'?pbr.value:null,
  indicative:st.status==='INDICATIVE_MULTICLASS_BPS'};
}

export function buildAiFinancialEvidence({
 asOfKst,usSessionDate,domesticSessionDate=null,
 ttm={},fyValues={},dart={},domesticQuotes=[]
}={}){
 if(!day(asOfKst)||!day(usSessionDate)||usSessionDate>asOfKst)
  return {kind:'AI_FINANCIAL_EVIDENCE_UNVERIFIED',items:[],domestic:[]};
 const items=AI_NINE.map(item=>({symbol:item.symbol,
  ttm:ttmRow(item,ttm,asOfKst),
  value:valueRow(item,fyValues,usSessionDate,asOfKst)}));
 const domestic=DART_SEMICONDUCTORS.map(item=>({symbol:item.symbol,
  name:item.name,evidence:domesticRow(item,dart,asOfKst,
   domesticSessionDate,domesticQuotes)}));
 return {kind:'AI_FINANCIAL_EVIDENCE_READ_ONLY',asOfKst,usSessionDate,
  domesticSessionDate:day(domesticSessionDate)&&domesticSessionDate<=asOfKst
   ?domesticSessionDate:null,
  items,domestic,
  coverage:{ttm:items.filter(x=>x.ttm?.basis==='TTM').length,
   fyOnly:items.filter(x=>x.ttm?.basis==='FY').length,
   referencePbr:items.filter(x=>x.value).length,
   domestic:domestic.filter(x=>x.evidence).length},
  portfolioWrites:0,telegramSends:0,gasDeployments:0};
}

// Explicitly opt in to this collector in a separate prefetch job only.
// Sequential SEC readers respect source fair-access and never block 07:40/17:00.
const preferred=['NVDA','MSFT','GOOGL','AMZN','META','ORCL','MU','SNDK','AAPL'];
const compact=x=>{
 if(!x?.ttm&&!x?.value)return null;
 const parts=[];
 if(x.ttm){
  parts.push(x.ttm.basis+' FCF $'+dollars(x.ttm.fcfUsd));
  if(num(x.ttm.capexToOcfPercent))
   parts.push('CAPEX/OCF '+x.ttm.capexToOcfPercent.toFixed(0)+'%');
 }
 if(x.value)parts.push('FY BPS $'+x.value.bpsUsd.toFixed(2)
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
  Number.isInteger(coverage[k])&&coverage[k]>=0
   &&coverage[k]<=(k==='domestic'?2:9))
  ||coverage.ttm+coverage.fyOnly>9
  ||new Set(evidence.items.map(x=>x?.symbol)).size!==9
  ||new Set(evidence.domestic.map(x=>x?.symbol)).size!==2
  ||coverage.ttm!==evidence.items.filter(x=>x?.ttm?.basis==='TTM').length
  ||coverage.fyOnly!==evidence.items.filter(x=>x?.ttm?.basis==='FY').length
  ||coverage.referencePbr!==evidence.items.filter(x=>x?.value).length
  ||coverage.domestic!==evidence.domestic.filter(x=>x?.evidence).length)return [];
 const header='■ 공시 재무 근거 (미국 '+evidence.usSessionDate+' 종가 참고)';
 const count='• 검증 범위: 미국 TTM '+coverage.ttm+'/9·FY만 '+coverage.fyOnly
  +'/9·FY PBR '+coverage.referencePbr+'/9, 국내 DART BPS '+coverage.domestic+'/2';
 const bySymbol=new Map(evidence.items.map(x=>[x.symbol,x]));
 const lines=[header,count];
 // The Korean BPS is independently verified by DART. Its priority must not
 // depend on the number of successful US SEC/Yahoo companies in the appendix.
 // Keep the actual filing quarter explicit; a 3Q issuer press release must
 // never make the 2Q official book value appear to be a 3Q BPS.
 const d=evidence.domestic.map(x=>{
  const r=x.evidence;
  if(!r)return x.name+' 미확보';
  return x.name+' '+(r.indicative?'보통·우선 합산 참고':'단일종류 확인')+' BPS '+Math.round(r.bpsKrw).toLocaleString('en-US')+'원'
   +' ['+r.period+' 연결]'
   +(positive(r.pbrTimes)&&day(r.priceDate)
    ?' / '+r.pbrTimes.toFixed(2)+'배('+r.priceDate.slice(5)+' NH 종가)'
    :' / PBR 미확보');
 }).join('; ');
 const dLine='• 국내: '+d;
 if([...lines,dLine].join('\n').length<=maxLength)lines.push(dLine);
 // Only lower-priority US lines use the remaining bounded Telegram budget.
 for(const sym of preferred){
  const v=compact(bySymbol.get(sym));
  if(!v)continue;
  if([...lines,v,'• 미국 FY 장부가와 최근 종가, 회사별 결산일 차이 주의.'].join('\n').length>maxLength)
   break;
  lines.push('• '+v);
 }
 const caution='• 자료 주의: FCF·CAPEX는 AI 전용 투자액이나 소유주이익이 아니며 FY PBR은 내재가치가 아닙니다.';
 if([...lines,caution].join('\n').length<=maxLength)lines.push(caution);
 return lines;
}


// Preserve the bounded SEC/DART provenance panel when a dense market report
// has room for the verified domestic BPS line but not every US-company row.
// Never truncate individual monetary values, filing dates or disclosures.
// If even the complete header+coverage+domestic evidence cannot fit, omit the
// optional appendix rather than publishing an orphaned/misleading heading.
export function fitAiFinancialEvidenceForBudget(evidence,availableChars){
 if(!Number.isSafeInteger(availableChars)||availableChars<0||availableChars>3900)
  return [];
 const lines=formatAiFinancialEvidence(evidence);
 if(lines.length<2)return [];
 const required=lines[2]?.startsWith('• 국내:')?3:2;
 const selected=lines.slice(0,required);
 if(selected.join('\n').length>availableChars)return [];
 for(const line of lines.slice(required)){
  if([...selected,line].join('\n').length>availableChars)break;
  selected.push(line);
 }
 return selected;
}
