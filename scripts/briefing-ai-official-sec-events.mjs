// Optional official SEC *filing presence* evidence for the day's 0-3
// material watch moves. Form/date proves an issuer filing exists, NOT that
// the filing caused the move, contained an earnings beat, or changed CAPEX.
// Missing EDGAR evidence does not inhibit the 07:40 regular briefing.
import {AI_EVENT_WATCH} from './briefing-ai-event-watch.mjs';
const VALID_FORMS=new Set(['8-K','10-Q','10-K','6-K','20-F','40-F']);
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const secAgent=x=>typeof x==='string'&&x.length>=12&&x.length<=160
 &&/^[\x20-\x7e]+$/.test(x)&&/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(x);
const allowSymbol=s=>AI_EVENT_WATCH.some(item=>item.symbol===s);
function toCIK(value){
 if(!Number.isInteger(value)||value<1||value>9999999999)return null;
 return String(value).padStart(10,'0');
}
export function secCikMap(tickers, symbols=[]){
 if(!tickers||typeof tickers!=='object'||!Array.isArray(symbols)
  ||symbols.some(s=>!allowSymbol(s)))return {};
 const values=Object.values(tickers);
 if(values.length<1||values.length>50000)return {};
 const output={};
 for(const symbol of new Set(symbols)){
  const found=values.filter(x=>x?.ticker===symbol&&toCIK(x?.cik_str));
  if(found.length!==1)continue;
  output[symbol]=toCIK(found[0].cik_str);
 }
 return output;
}
export function parseSecRecentFiling(data,{symbol,cik,usDate,now=new Date()}={}){
 if(!allowSymbol(symbol)||!day(usDate)
  ||!/^0\d{9}$/.test(cik||'')
  ||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||data?.cik!==Number(cik))return null;
 const recent=data.filings?.recent;
 const forms=recent?.form,days=recent?.filingDate,accns=recent?.accessionNumber;
 if(!Array.isArray(forms)||!Array.isArray(days)||!Array.isArray(accns)
  ||forms.length!==days.length||days.length!==accns.length
  ||forms.length<1||forms.length>2000)return null;
 const cutoff=Date.parse(usDate+'T00:00:00Z');
 const candidates=[];
 for(let i=0;i<forms.length;i++){
  const form=forms[i],filed=days[i],accession=accns[i];
  if(!VALID_FORMS.has(form)||!day(filed)||filed>usDate
   ||cutoff-Date.parse(filed+'T00:00:00Z')>2*86400000
   ||!/^0\d{9}-\d{2}-\d{6}$/.test(accession||''))continue;
  candidates.push({symbol,form,filed,accession,source:'SEC_EDGAR_SUBMISSIONS'});
 }
 candidates.sort((a,b)=>b.filed.localeCompare(a.filed)
  ||(a.form==='8-K'?-1:0)-(b.form==='8-K'?-1:0)
  ||b.accession.localeCompare(a.accession));
 return candidates[0]||null;
}
export function verifiedSecFiling(value,{symbol,usDate}={}){
 if(value==null)return null;
 if(value.symbol!==symbol||!allowSymbol(symbol)
  ||value.source!=='SEC_EDGAR_SUBMISSIONS'
  ||!VALID_FORMS.has(value.form)||!day(value.filed)||!day(usDate)
  ||value.filed>usDate
  ||Date.parse(usDate+'T00:00:00Z')-Date.parse(value.filed+'T00:00:00Z')>2*86400000
  ||!/^0\d{9}-\d{2}-\d{6}$/.test(value.accession||''))return null;
 return Object.freeze({symbol,form:value.form,filed:value.filed,
  accession:value.accession,source:'SEC_EDGAR_SUBMISSIONS'});
}
export async function addOfficialSecFilings(events,{usDate,now=new Date(),
 fetchImpl=fetch,userAgent=process.env.SEC_USER_AGENT}={}){
 if(!Array.isArray(events)||events.length>3||!day(usDate)
  ||!secAgent(userAgent))return events;
 const chosen=events.filter(x=>allowSymbol(x?.symbol)&&x?.date===usDate);
 if(chosen.length!==events.length)return events;
 const safeFetch=(url,options)=>fetchImpl(url,{
  ...options,headers:{accept:'application/json','user-agent':userAgent},
  redirect:'error',signal:AbortSignal.timeout(4500)});
 let tickerMap={};
 try{
  const response=await safeFetch('https://www.sec.gov/files/company_tickers.json',{});
  if(!response?.ok)return events;
  tickerMap=secCikMap(await response.json(),chosen.map(e=>e.symbol));
 }catch{return events;}
 const enriched=await Promise.all(chosen.map(async event=>{
  const cik=tickerMap[event.symbol];
  if(!cik)return event;
  try{
   const result=await safeFetch('https://data.sec.gov/submissions/CIK'+cik+'.json',{});
   if(!result?.ok)return event;
   const filing=parseSecRecentFiling(await result.json(),{
    symbol:event.symbol,cik,usDate,now});
   return filing?{...event,filing}:event;
  }catch{return event;}
 }));
 return enriched;
}
