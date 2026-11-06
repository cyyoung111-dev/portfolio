import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {DART_SEMICONDUCTORS} from './briefing-dart-semiconductor-sources.mjs';

// Company CDS watchlist mirrors the exact issuers monitored by AI/semiconductor
// lenses. A stock ticker or CIK/DART corp_code is NOT a CDS reference entity.
// Issuer mapping is deliberately unresolved until the reference obligation,
// RED/LEI, seniority, currency, tenor, licensing and source are verified.
export const COMPANY_CDS_WATCHLIST=Object.freeze([
 ...AI_NINE.map(x=>Object.freeze({
  symbol:x.symbol,company:x.label,country:'US',equityIdentifier:'CIK:'+x.cik
 })),
 ...DART_SEMICONDUCTORS.map(x=>Object.freeze({
  symbol:x.symbol,company:x.name,country:'KR',equityIdentifier:'DART:'+x.corpCode
 }))
]);
const DAY_MS=86400000;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&!Number.isNaN(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const delta=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/DAY_MS;
const fixed=n=>Math.round(n*100)/100;
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const SOURCE_TYPE=Object.freeze({
 LSEG_5Y_PAR_MID:'DEALER_PAR_QUOTE',
 ICE_LICENSED_5Y_PAR_MID:'CLEARING_PAR_QUOTE',
 DTCC_SEC_EXPLICIT_SPREAD:'REPORTED_TRADE_SPREAD'
});
const validId=id=>typeof id==='string'&&/^(RED|LEI|ISIN):[A-Z0-9-]{6,24}$/.test(id);

// Only an independent issuer-ID mapping may be supplied by a vetted adapter;
// the raw trade record cannot set its own trusted reference ID.
export function validateCompanyCdsPoint(company,record,{
 asOf='2026-11-06',approvedReferenceId=null
}={}){
 if(!COMPANY_CDS_WATCHLIST.some(x=>x.symbol===company?.symbol
  &&x.equityIdentifier===company.equityIdentifier))
  return {status:'ISSUER_NOT_ON_WATCHLIST',point:null};
 if(!validId(approvedReferenceId))
  return {status:'REFERENCE_ENTITY_NOT_MAPPED',point:null};
 if(!record)return {status:'NO_SOURCE_OBSERVATION',point:null};
 if(record.referenceEntityId!==approvedReferenceId)
  return {status:'REFERENCE_ENTITY_MISMATCH',point:null};
 // Do not substitute a Korean sovereign CDS or the semiconductor industry's
 // aggregate CDX spread for an individual company's credit risk.
 if(record.referenceType!=='SINGLE_NAME_CORPORATE'
  ||record.seniority!=='SENIOR_UNSECURED'
  ||record.currency!=='USD'
  ||record.restructuringClause==null
  ||typeof record.restructuringClause!=='string'
  ||!record.restructuringClause.trim())
  return {status:'CDS_CONTRACT_MISMATCH',point:null};
 if(!Object.hasOwn(SOURCE_TYPE,record.source)
  ||record.tenor!=='5Y'
  ||record.unit!=='bp'||record.field!=='SPREAD'
  ||record.spreadDefinition!=='RUNNING_MARKET_SPREAD'
  ||record.priceType!=='MID'&&record.priceType!=='REPORTED')
  return {status:'NOT_COMPARABLE_5Y_SPREAD',point:null};
 // Public ICE EOD "price" around 100 is a CLEAN PRICE, not ~100bp.
 // DTCC fixed-rate coupons/upfront cash are not running market spreads.
 if(record.source==='DTCC_SEC_EXPLICIT_SPREAD'
  &&(record.priceType!=='REPORTED'
   ||record.verifiedNotation!==true
   ||!isNum(record.maturityYears)
   ||record.maturityYears<4.4||record.maturityYears>5.6))
  return {status:'CDS_UNITS_OR_TENOR_UNVERIFIED',point:null};
 if(record.source!=='DTCC_SEC_EXPLICIT_SPREAD'
  &&record.priceType!=='MID')
  return {status:'CDS_QUOTE_TYPE_MISMATCH',point:null};
 if(!isNum(record.spreadBp)||record.spreadBp<=0||record.spreadBp>5000)
  return {status:'CDS_VALUE_UNVERIFIED',point:null};
 if(!validDate(asOf)||!validDate(record.date)
  ||delta(asOf,record.date)<0)return {status:'CDS_DATE_UNVERIFIED',point:null};
 if(delta(asOf,record.date)>7)
  return {status:'CDS_STALE',point:null};
 if(typeof record.sourceRecordId!=='string'||!record.sourceRecordId.trim())
  return {status:'CDS_PROVENANCE_MISSING',point:null};
 return {status:SOURCE_TYPE[record.source],point:{
  symbol:company.symbol,referenceEntityId:approvedReferenceId,
  date:record.date,spreadBp:fixed(record.spreadBp),
  source:record.source,sourceRecordId:record.sourceRecordId,
  category:SOURCE_TYPE[record.source],tenor:'5Y',
  seniority:'SENIOR_UNSECURED',currency:'USD',
  restructuringClause:record.restructuringClause,
  // Data may not share quote convention, dates or liquidity.
  comparableToDealerQuote:record.priceType==='MID'
 }};
}

export function computeCompanyCdsTrend(points,{asOf='2026-11-06'}={}){
 // Different reference entities, restructuring clauses, quote sources or
 // print/quote conventions must not be combined in a daily change metric.
 if(!validDate(asOf)||!Array.isArray(points))return null;
 const valid=points.filter(x=>x?.category!=='REPORTED_TRADE_SPREAD'
  &&x?.comparableToDealerQuote===true&&validDate(x.date)
  &&isNum(x.spreadBp)&&x.spreadBp>0&&x.date<=asOf);
 if(!valid.length)return null;
 const group=valid.filter(x=>x.source===valid[0].source
  &&x.referenceEntityId===valid[0].referenceEntityId
  &&x.currency===valid[0].currency
  &&x.tenor===valid[0].tenor
  &&x.restructuringClause===valid[0].restructuringClause);
 const byDate=new Map();
 for(const v of group){
  if(byDate.has(v.date)&&byDate.get(v.date)!==v.spreadBp)return null;
  byDate.set(v.date,v.spreadBp);
 }
 const dates=[...byDate.keys()].sort();
 const last=dates.at(-1);
 if(delta(asOf,last)>7)return null;
 const current=byDate.get(last);
 const windows={month1:30,month3:91,year1:365};
 const changes={},comparisonDates={};
 for(const [name,days] of Object.entries(windows)){
  const candidates=dates.filter(d=>d<last&&Math.abs(delta(last,d)-days)<=3)
   .sort((a,b)=>{
    // Exact target date first. Otherwise choose the nearest observation;
    // tied distances choose the earlier one to avoid lookahead bias.
    const da=Math.abs(delta(last,a)-days),db=Math.abs(delta(last,b)-days);
    return da-db||a.localeCompare(b);
   });
  const picked=candidates[0]??null;
  comparisonDates[name]=picked;
  changes[name]=picked===null?null:fixed(current-byDate.get(picked));
 }
 return {date:last,spreadBp:current,changesBp:changes,
  comparisonDates,
  source:group[0].source,referenceEntityId:group[0].referenceEntityId,
  observationCount:dates.length};
}

export function buildCompanyCdsCoverage({asOf='2026-11-06',
 sourceRows=[],approvedReferences={}}={}){
 if(!validDate(asOf))throw Error('INVALID_ASOF_DATE');
 const statuses=COMPANY_CDS_WATCHLIST.map(item=>{
  const reference=approvedReferences[item.symbol];
  if(!validId(reference))
   return {symbol:item.symbol,country:item.country,
    status:'REFERENCE_ENTITY_NOT_MAPPED',latest:null};
  const matches=sourceRows.filter(x=>x.symbol===item.symbol);
  if(matches.length!==1)return {symbol:item.symbol,country:item.country,
   status:matches.length?'AMBIGUOUS_SOURCE_OBSERVATIONS':'NO_SOURCE_OBSERVATION',
   latest:null};
  const checked=validateCompanyCdsPoint(item,matches[0],{
   asOf,approvedReferenceId:reference
  });
  return {symbol:item.symbol,country:item.country,
   status:checked.status,latest:checked.point};
 });
 return {total:statuses.length,
  verifiedQuotes:statuses.filter(x=>x.status==='DEALER_PAR_QUOTE'
    ||x.status==='CLEARING_PAR_QUOTE').length,
  verifiedTradeReports:statuses.filter(x=>x.status==='REPORTED_TRADE_SPREAD').length,
  statuses,portfolioWrites:0,telegramSends:0,gasDeployments:0};
}
