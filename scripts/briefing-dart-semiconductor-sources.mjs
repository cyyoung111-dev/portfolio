// Domestic semiconductor reference: official OpenDART CFS only.
// The code NEVER writes portfolio data, calls Telegram or calculates a PBR
// from a price with unverified market close/currency/filing date.
export const DART_SEMICONDUCTORS=Object.freeze([
 Object.freeze({symbol:'005930',name:'삼성전자',corpCode:'00126380'}),
 Object.freeze({symbol:'000660',name:'SK하이닉스',corpCode:'00164779'})
]);
const EQUITY_IDS=new Set([
 'ifrs-full_EquityAttributableToOwnersOfParent',
 'ifrs_EquityAttributableToOwnersOfParent'
]);
const validKey=s=>typeof s==='string'&&/^[a-z0-9]{40}$/i.test(s);
const safeInt=x=>Number.isSafeInteger(x)&&Math.abs(x)<9e15;
const goodDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const dayOfReceipt=s=>typeof s==='string'&&/^\d{14}$/.test(s)
 ?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8):null;
const dateKst=now=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);
const cleanInt=value=>{
 if(typeof value==='number')return safeInt(value)?value:null;
 if(typeof value!=='string')return null;
 const s=value.replace(/,/g,'').trim();
 if(!/^-?\d+$/.test(s))return null;
 const n=Number(s);
 return safeInt(n)?n:null;
};
const unique=x=>x.length&&x.every(v=>v===x[0])?x[0]:null;
// In DART stock-count tables only, a literal dash represents an empty
// stock category/zero treasury shares. Never treat null, empty strings,
// arbitrary text, financial amounts, or a missing column as numeric zero.
const stockCount=value=>typeof value==='string'
 &&['-','–','—'].includes(value.trim())?0:cleanInt(value);
const shareRowCheck=(row,kind)=>{
 const issued=stockCount(row.istc_totqy),treasury=stockCount(row.tesstk_co),
  outstanding=stockCount(row.distb_stock_co);
 if(!safeInt(issued)||!safeInt(treasury)||!safeInt(outstanding))
  return {net:null,detail:kind+'_FIELD_NON_NUMERIC'};
 if(issued<0||treasury<0||outstanding<0||treasury>issued)
  return {net:null,detail:kind+'_SHARE_RANGE_INVALID'};
 if(issued-treasury!==outstanding)
  return {net:null,detail:kind+'_SHARE_ARITHMETIC_MISMATCH'};
 // An inactive preferred stock row of all zeros is allowed; the common and
 // reported total classes must nevertheless be strictly positive.
 if(outstanding===0&&kind!=='PREFERRED')
  return {net:null,detail:kind+'_NONPOSITIVE_SHARES'};
 return {net:outstanding,detail:null};
};

const reportOptions=now=>{
 const today=dateKst(now),y=Number(today.slice(0,4));
 const result=[];
 // At the beginning of a new year the immediately preceding 10-K may
 // not have been filed yet. Preserve the last published Q3/Q2/Q1 instead.
 for(const year of [y,y-1,y-2]){
  for(const [code,monthDay] of [
   ['11011','12-31'],['11014','09-30'],
   ['11012','06-30'],['11013','03-31']]){
   const period=year+'-'+monthDay;
   if(today>period)result.push({year,code,period});
  }
 }
 return result.sort((a,b)=>b.period.localeCompare(a.period));
};

// The DART API does not publish before the actual filing. A missing Q3 does
// not authorize manufacturing a Q3 balance from Q2: fall back to the last
// available *published* report, retaining its source period.
export function extractDartDomesticBps(finance,shares,item,report,{now=new Date()}={}){
 if(!DART_SEMICONDUCTORS.some(x=>x.corpCode===item?.corpCode)
  ||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||!goodDay(report?.period)||!Number.isInteger(report?.year)
  ||!['11011','11012','11013','11014'].includes(report?.code))
  return {status:'DART_SCHEMA_UNVERIFIED',snapshot:null};
 if(finance?.status!=='000'||shares?.status!=='000'
  ||!Array.isArray(finance.list)||!Array.isArray(shares.list))
  return {status:'DART_SCHEMA_UNVERIFIED',snapshot:null};
 const fs=finance.list,st=shares.list,year=String(report.year);
 const allRows=[...fs,...st];
 // The stock-total response omits bsns_year/reprt_code on some official
 // versions; only the financial list guarantees those response fields.
 if(!allRows.length||fs.some(r=>r.corp_code!==item.corpCode
  ||r.reprt_code!==report.code||r.bsns_year!==year)
  ||st.some(r=>r.corp_code!==item.corpCode
   ||(r.reprt_code!=null&&r.reprt_code!==report.code)
   ||(r.bsns_year!=null&&r.bsns_year!==year)))
  return {status:'DART_IDENTITY_MISMATCH',snapshot:null};
 const accession=unique(allRows.map(r=>r.rcept_no));
 const receiptDate=dayOfReceipt(accession);
 if(!accession||!goodDay(receiptDate)
  ||receiptDate<report.period||receiptDate>dateKst(now))
  return {status:'DART_PERIOD_OR_FILING_UNVERIFIED',snapshot:null};
 const eqRows=fs.filter(r=>r.sj_div==='BS'&&EQUITY_IDS.has(r.account_id)
  &&r.currency==='KRW');
 const eqValues=eqRows.map(r=>cleanInt(r.thstrm_amount));
 const parentEquity=unique(eqValues);
 if(!safeInt(parentEquity)||parentEquity<=0)
  return {status:'DART_PARENT_EQUITY_UNVERIFIED',snapshot:null};
 if(st.some(r=>r.stlm_dt!==report.period))
  return {status:'DART_SHARES_PERIOD_UNVERIFIED',snapshot:null};
 const classes=st.filter(r=>r.se==='보통주'||r.se==='우선주');
 const totalRows=st.filter(r=>r.se==='합계');
 if(totalRows.length!==1||!classes.some(r=>r.se==='보통주')
  ||classes.length!==new Set(classes.map(r=>r.se)).size)
  return {status:'DART_SHARE_CLASSES_UNVERIFIED',snapshot:null};
 const checks=classes.map(r=>shareRowCheck(r,
  r.se==='보통주'?'COMMON':'PREFERRED'));
 const classShares=checks.map(x=>x.net),totalCheck=shareRowCheck(totalRows[0],'TOTAL');
 const total=totalCheck.net;
 const invalid=checks.find(x=>!safeInt(x.net));
 if(invalid||!safeInt(total))
  return {status:'DART_SHARE_TOTAL_MISMATCH',snapshot:null,
   detail:invalid?.detail||totalCheck.detail||'UNKNOWN_STOCK_FIELD'};
 if(classShares.reduce((a,b)=>a+b,0)!==total)
  return {status:'DART_SHARE_TOTAL_MISMATCH',snapshot:null,
   detail:'CLASS_TOTAL_OUTSTANDING_MISMATCH'};
 const bps=parentEquity/total;
 if(!Number.isFinite(bps)||bps<=0)
  return {status:'DART_BPS_ARITHMETIC_INVALID',snapshot:null};
 const preferredIndex=classes.findIndex(x=>x.se==='우선주');
 const hasPreferred=preferredIndex>=0&&classShares[preferredIndex]>0;
 return {status:hasPreferred?'INDICATIVE_MULTICLASS_BPS':'VERIFIED_SINGLECLASS_BPS',
  snapshot:{symbol:item.symbol,corpCode:item.corpCode,
   receiptNo:accession,filingDate:receiptDate,period:report.period,
   reportCode:report.code,consolidation:'CFS',
   currency:'KRW',parentEquityKrw:parentEquity,
   totalOutstandingShares:total,
   commonShares:classShares[classes.findIndex(x=>x.se==='보통주')],
   preferredShares:hasPreferred?classShares[classes.findIndex(x=>x.se==='우선주')]:0,
   referenceBpsKrw:bps,
   shareBasis:hasPreferred?'ALL_CLASSES_EQUAL_EQUITY_REFERENCE':'SINGLE_CLASS',
   source:'OPENDART_OFFICIAL_FINANCE_AND_STOCK_TOTAL'}
 };
}

export function calculateDomesticReferencePbr(snapshot,quote){
 if(!snapshot||!goodDay(snapshot.period)||!goodDay(snapshot.filingDate)
  ||quote?.symbol!==snapshot.symbol||quote?.source!=='NH_REGULAR_CLOSE'
  ||quote?.unit!=='KRW'||!goodDay(quote?.date)
  ||quote.date<=snapshot.filingDate
  ||!Number.isFinite(quote.value)||quote.value<=0
  ||!Number.isFinite(snapshot.referenceBpsKrw)||snapshot.referenceBpsKrw<=0)
  return {status:'DOMESTIC_PBR_UNVERIFIED',value:null};
 return {status:snapshot.preferredShares>0
  ?'INDICATIVE_MULTICLASS_PBR':'VERIFIED_SINGLECLASS_PBR',
  value:quote.value/snapshot.referenceBpsKrw,
  sourceDate:quote.date,source:'NH_REGULAR_CLOSE',
  basis:snapshot.shareBasis};
}

async function callDart(path,params,{fetchImpl,apiKey}){
 // Avoid secrets in logs or diagnostics. All URLs are fixed official hosts.
 const query=new URLSearchParams({crtfc_key:apiKey,...params});
 try{
  const r=await fetchImpl('https://opendart.fss.or.kr/api/'+path+'.json?'+query,{
   method:'GET',redirect:'error',headers:{accept:'application/json'},
   signal:AbortSignal.timeout(18000)});
  if(!r?.ok)return {kind:'DART_HTTP_UNAVAILABLE'};
  const doc=await r.json();
  if(doc?.status==='013')return {kind:'NO_PUBLISHED_REPORT'};
  if(['010','011','012','901'].includes(doc?.status))return {kind:'DART_KEY_REJECTED'};
  if(doc?.status==='020')return {kind:'DART_RATE_LIMITED'};
  if(doc?.status!=='000'||!Array.isArray(doc.list))
   return {kind:'DART_SCHEMA_UNVERIFIED'};
  return {kind:'OK',doc};
 }catch{return {kind:'DART_FETCH_FAILED'};}
}
export async function readTwoDomesticDartBps({
 now=()=>new Date(),apiKey=process.env.DART_API_KEY,fetchImpl=fetch
}={}){
 if(!validKey(apiKey))return {total:2,verified:0,rows:[],
  statuses:DART_SEMICONDUCTORS.map(x=>({symbol:x.symbol,status:'DART_KEY_NOT_CONFIGURED'}))};
 const instant=now(),options=reportOptions(instant);
 const rows=[],statuses=[];
 for(const item of DART_SEMICONDUCTORS){
  let status='NO_PUBLISHED_REPORT',snapshot=null,detail=null;
  for(const option of options){
   const params={corp_code:item.corpCode,bsns_year:String(option.year),
    reprt_code:option.code};
   const fs=await callDart('fnlttSinglAcntAll',{...params,fs_div:'CFS'},
    {fetchImpl,apiKey});
   if(fs.kind==='NO_PUBLISHED_REPORT')continue;
   if(fs.kind!=='OK'){status=fs.kind;break;}
   const shares=await callDart('stockTotqySttus',params,{fetchImpl,apiKey});
   if(shares.kind!=='OK'){status=shares.kind;break;}
   const ext=extractDartDomesticBps(fs.doc,shares.doc,item,option,{now:instant});
   status=ext.status;snapshot=ext.snapshot;detail=ext.detail||null;
   // Once a new filing exists, never silently fall back to older fiscal data.
   break;
  }
  statuses.push({symbol:item.symbol,status,...(detail?{detail}:{})});
  if(snapshot)rows.push(snapshot);
  // One invalid key is a global credential error, not a company-specific
  // missing filing. Stop further requests without leaking the key.
  if(status==='DART_KEY_REJECTED')break;
 }
 if(statuses.length<DART_SEMICONDUCTORS.length)
  for(const item of DART_SEMICONDUCTORS.slice(statuses.length))
   statuses.push({symbol:item.symbol,status:'DART_KEY_REJECTED'});
 return {total:2,verified:statuses.filter(x=>x.status==='VERIFIED_SINGLECLASS_BPS').length,
  indicative:statuses.filter(x=>x.status==='INDICATIVE_MULTICLASS_BPS').length,
  rows,statuses,source:'OPENDART_READ_ONLY',portfolioWrites:0,telegramSends:0};
}
