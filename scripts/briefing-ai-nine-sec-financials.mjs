import {AI_NINE,isValidSecUserAgent} from './briefing-ai-nine-sources.mjs';

// Read-only SEC XBRL annual financial extract; source facts are from the SAME
// 10-K accession and fiscal year end. No cross-period sum, YTD-as-quarter,
// fabricated ROIC/BPS, or inferred AI CAPEX/HBM shipment from GAAP values.
const TAGS=Object.freeze({
 revenue:['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],
 operatingIncome:['OperatingIncomeLoss'],
 netIncome:['NetIncomeLoss'],
 operatingCashFlow:['NetCashProvidedByUsedInOperatingActivities'],
 capex:['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets'],
 assets:['Assets'],
 equity:['StockholdersEquity'],
 cash:['CashAndCashEquivalentsAtCarryingValue'],
 epsDiluted:['EarningsPerShareDiluted'],
 shareRepurchases:['PaymentsForRepurchaseOfCommonStock']
});
const BALANCE=new Set(['assets','equity','cash']);
const PERIOD=86400000;
const goodDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const age=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/PERIOD);
const amount=x=>Number.isFinite(x)&&Math.abs(x)<1e16;
const notify=(fn,x)=>{try{fn(x);}catch{}};

// Reference is the newest 10-K balance sheet fact. The SEC 'fy'/'fp'
// attributes describe the filing and are NOT used to select fact periods.
function annualAnchor(facts,now){
 const values=facts?.['us-gaap']?.Assets?.units?.USD;
 if(!Array.isArray(values))return null;
 const candidates=values.filter(x=>x?.form==='10-K'&&x.fp==='FY'
  &&!x.start&&goodDay(x.end)&&goodDay(x.filed)
  &&x.filed<=now.toISOString().slice(0,10)
  &&/^\d{10}-\d{2}-\d{6}$/.test(x.accn||'')
  &&amount(x.val)&&x.val>0);
 candidates.sort((a,b)=>b.end.localeCompare(a.end)
  ||b.filed.localeCompare(a.filed)||b.accn.localeCompare(a.accn));
 if(!candidates.length)return null;
 const a=candidates[0],ties=candidates.filter(x=>x.end===a.end
  &&x.filed===a.filed&&x.accn===a.accn);
 if(ties.some(x=>x.val!==a.val))return null;
 return {periodEnd:a.end,filedAt:a.filed,accessionNumber:a.accn};
}
function extractFact(facts,key,anchor){
 const unit=key==='epsDiluted'?'USD/shares':'USD',annual=!BALANCE.has(key);
 for(const tag of TAGS[key]){
  const source=facts?.['us-gaap']?.[tag]?.units?.[unit];
  if(!Array.isArray(source))continue;
  const candidates=source.filter(x=>x?.form==='10-K'&&x.fp==='FY'
    &&x.end===anchor.periodEnd&&x.accn===anchor.accessionNumber
    &&x.filed===anchor.filedAt&&amount(x.val)
    &&(!annual?(!x.start):goodDay(x.start)&&age(x.start,x.end)>=300
      &&age(x.start,x.end)<=390)
    &&(key!=='capex'&&key!=='revenue'&&key!=='assets'&&key!=='equity'
     &&key!=='cash'&&key!=='shareRepurchases'||x.val>=0));
  if(!candidates.length)continue;
  if(candidates.some(x=>x.val!==candidates[0].val))return null;
  return {value:candidates[0].val,tag,unit,source:'SEC_US_GAAP_10K'};
 }
 return null;
}
const rate=(numer,denom)=>Number.isFinite(numer)&&Number.isFinite(denom)&&denom>0
 ?Math.round(numer/denom*1e6)/1e4:null;

// A valid 10-K anchor alone is NOT a verified financial statement. Require
// every field needed for sales/profit, reported FCF and annual diluted EPS.
// Optional cash and repurchases remain visible as missing, without turning
// a fully comparable report into a failure.
const REQUIRED_ANNUAL=Object.freeze([
 'revenue','operatingIncome','netIncome','operatingCashFlow',
 'capex','assets','equity','epsDiluted'
]);
export function classifySecAnnualFacts(report){
 if(!report)return 'NO_SAME_FILING_ANNUAL_FACTS';
 return REQUIRED_ANNUAL.every(key=>Number.isFinite(report.values?.[key]?.value))
  ?'VERIFIED':'PARTIAL_SEC_ANNUAL_FACTS';
}

export function extractSecAnnualFacts(doc,symbol,{now=new Date()}={}){
 const item=AI_NINE.find(x=>x.symbol===symbol);
 if(!item||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||Number(doc?.cik)!==Number(item.cik)||typeof doc.entityName!=='string'
  ||doc.entityName.length<2||!doc.facts||typeof doc.facts!=='object')return null;
 const anchor=annualAnchor(doc.facts,now);
 if(!anchor)return null;
 const values=Object.fromEntries(Object.keys(TAGS)
  .map(key=>[key,extractFact(doc.facts,key,anchor)]));
 // FCF is operating cash flow minus reported cash productive-asset purchases; it
 // is NOT owner earnings and is not a statement on AI-only investment.
 const ocf=values.operatingCashFlow?.value,capex=values.capex?.value,
  revenue=values.revenue?.value,op=values.operatingIncome?.value;
 const freeCashFlow=Number.isFinite(ocf)&&Number.isFinite(capex)?ocf-capex:null;
 return {symbol,cik:item.cik,period:anchor.periodEnd,filedAt:anchor.filedAt,
  accessionNumber:anchor.accessionNumber,source:'SEC_COMPANYFACTS_US_GAAP_10K',
  periodType:'ANNUAL_REPORTED',currency:'USD',
  values,
  calculated:{
   freeCashFlow,fcfMarginPercent:rate(freeCashFlow,revenue),
   operatingMarginPercent:rate(op,revenue)
  },
  missing:Object.keys(TAGS).filter(key=>values[key]===null),
  disclaimer:'FCF=reported OCF minus reported cash PP&E/productive-asset acquisitions; not owner earnings or AI-only CAPEX'
 };
}

export async function readAiNineAnnualSecFacts({
 fetchImpl=fetch,now=()=>new Date(),userAgent=process.env.SEC_USER_AGENT,
 onDiagnostic=()=>{}
}={}){
 if(!isValidSecUserAgent(userAgent)){
  const statuses=AI_NINE.map(x=>({symbol:x.symbol,status:'SEC_USER_AGENT_NOT_CONFIGURED'}));
  notify(onDiagnostic,{kind:'AI9_ANNUAL_SEC_READ',verified:0,total:9});
  return {verified:0,total:9,reports:[],statuses};
 }
 const reports=Array(AI_NINE.length).fill(null),statuses=Array(AI_NINE.length).fill(null);
 // A deliberately low rate stays below SEC fair-access limits, even with
 // other API readers; no parallel floods or retries.
 for(let i=0;i<AI_NINE.length;i++){
  const item=AI_NINE[i];
  let status='FETCH_FAILED',report=null;
  try{
   const response=await fetchImpl('https://data.sec.gov/api/xbrl/companyfacts/CIK'
     +item.cik+'.json',{method:'GET',redirect:'error',
    headers:{accept:'application/json','user-agent':userAgent},
    signal:AbortSignal.timeout(25000)});
   if(!response?.ok)status='SEC_HTTP_UNAVAILABLE';
   else if(!String(response.headers?.get?.('content-type')||'').toLowerCase()
     .includes('json'))status='SEC_CONTENT_TYPE_INVALID';
   else{
    const len=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(len)&&len>12000000)status='SEC_BODY_TOO_LARGE';
    else{
     report=extractSecAnnualFacts(await response.json(),item.symbol,{now:now()});
     status=classifySecAnnualFacts(report);
    }
   }
  }catch{status='FETCH_FAILED';}
  reports[i]=report;statuses[i]={symbol:item.symbol,status};
  if(i<AI_NINE.length-1)await new Promise(resolve=>setTimeout(resolve,250));
 }
 const result={verified:statuses.filter(x=>x.status==='VERIFIED').length,total:9,
  reports:reports.filter(Boolean),statuses};
 notify(onDiagnostic,{kind:'AI9_ANNUAL_SEC_READ',verified:result.verified,total:9,
  statuses:statuses.map(x=>({symbol:x.symbol,status:x.status}))});
 return result;
}
