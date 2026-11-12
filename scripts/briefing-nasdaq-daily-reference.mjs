// Optional, independent Nasdaq historical close reference for US-listed watch stocks.
// Cannot replace NH-confirmed index closes or domestic/official portfolio prices.
const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
  &&!Number.isNaN(Date.parse(s+'T00:00:00Z'))
  &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const money=s=>{
 if(typeof s==='number')return Number.isFinite(s)&&s>0?s:null;
 if(typeof s!=='string'||!/^[$]?[\d,]+(?:\.\d{1,5})?$/.test(s))return null;
 const v=Number(s.replace(/[$,]/g,''));
 return Number.isFinite(v)&&v>0?v:null;
};
const dateValue=s=>{
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s||''));
 if(!m)return null;
 const d=m[3]+'-'+m[1]+'-'+m[2];
 return isDate(d)?d:null;
};
function closedUsSession(usDate,now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day;
 return date>usDate||(date===usDate
  &&Number(p.hour)*60+Number(p.minute)>=16*60+15);
}
export function parseNasdaqDailyHistorical(symbol,usDate,body,now=new Date()){
 if(!/^[A-Z0-9]{1,6}$/.test(symbol)||!isDate(usDate)
   ||!(now instanceof Date)||!Number.isFinite(now.getTime())
   ||!closedUsSession(usDate,now))return null;
 const rows=body?.data?.tradesTable?.rows;
 if(!Array.isArray(rows)||rows.length<2||rows.length>100)return null;
 const dated=rows.map(r=>({
  date:dateValue(r?.date),value:money(r?.close)
 })).filter(x=>x.date&&x.value&&x.date<=usDate);
 if(new Set(dated.map(x=>x.date)).size!==dated.length)return null;
 const target=dated.find(x=>x.date===usDate);
 const previous=dated.filter(x=>x.date<usDate).sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(!target||!previous)return null;
 return {symbol,date:usDate,value:target.value,
  changePercent:(target.value/previous.value-1)*100,
  source:'NASDAQ_DAILY_REFERENCE'};
}
export async function readNasdaqDailyHistorical(symbol,usDate,{fetchImpl=fetch,now=new Date()}={}){
 if(!/^[A-Z0-9]{1,6}$/.test(symbol)||!isDate(usDate)
  ||!(now instanceof Date)||!closedUsSession(usDate,now))return null;
 const from=new Date(Date.parse(usDate+'T00:00:00Z')-12*86400000)
  .toISOString().slice(0,10);
 const url=new URL('https://api.nasdaq.com/api/quote/'+symbol+'/historical');
 url.searchParams.set('assetclass','stocks');
 url.searchParams.set('fromdate',from);
 url.searchParams.set('todate',usDate);
 url.searchParams.set('limit','25');
 try{
  const response=await fetchImpl(url.href,{
   headers:{accept:'application/json, text/plain, */*',
    'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    origin:'https://www.nasdaq.com'},
   redirect:'error',signal:AbortSignal.timeout(6500)});
  if(!response?.ok)return null;
  const data=await response.json();
  return parseNasdaqDailyHistorical(symbol,usDate,data,now);
 }catch{return null;}
}
