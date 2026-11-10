// Read-only verification of Treasury.gov PAR yield publication timeliness.
// This is a distinct measure from the Fed/FRED H.15 constant maturity series.
import {expectedMorningDate} from './telegram-morning-report.mjs';
const now=new Date();
const local=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
 hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
const day=local.year+'-'+local.month+'-'+local.day;
const expected=expectedMorningDate('SPX',day);
const month=day.slice(0,7).replace('-','');
const url=new URL('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml');
url.searchParams.set('data','daily_treasury_yield_curve');
url.searchParams.set('field_tdr_date_value_month',month);
function rate(raw,key){
 const regex=new RegExp('<(?:d:)?BC_'+key+'(?:\\s[^>]*)?>([^<]*)<\\/(?:d:)?BC_'+key+'>','i');
 const match=raw.match(regex);
 if(!match)return null;
 const value=Number(match[1]);
 return Number.isFinite(value)&&value>0&&value<25?value:null;
}
function dated(raw){
 const match=raw.match(/<(?:d:)?NEW_DATE(?:\s[^>]*)?>([^<]*)<\/(?:d:)?NEW_DATE>/i);
 return match&&/^20\d{2}-\d{2}-\d{2}/.test(match[1])?match[1].slice(0,10):null;
}
function output(details){console.log(JSON.stringify({kind:'TREASURY_PAR_YIELD_PUBLIC_TIMELINESS',
 observedKst:day+' '+local.hour+':'+local.minute,expectedUsDate:expected,
 ...details,financialWrites:0,telegramSends:0}));}
try{
 const res=await fetch(url,{headers:{accept:'application/xml,text/xml,application/atom+xml'},
  redirect:'follow',signal:AbortSignal.timeout(12000)});
 const mime=String(res.headers.get('content-type')||'').toLowerCase();
 const host=new URL(res.url).hostname;
 if(!res.ok||!/(xml|text)/.test(mime)||host!=='home.treasury.gov'){
  output({result:'HTTP_OR_TYPE_REJECTED',http:res.status,
   mimeKind:mime.includes('xml')?'XML':mime.includes('html')?'HTML':'OTHER',
   finalHost:host==='home.treasury.gov'?'TREASURY':'OTHER'});
 }else{
  const length=Number(res.headers.get('content-length')||0);
  if(length>3000000)output({result:'OVERSIZE'});
  else{
   const xml=await res.text();
   if(xml.length>3000000)throw Error('OVERSIZE_RESPONSE');
   const rows=[];
   for(const item of xml.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)){
    const date=dated(item[0]);
    if(!date)continue;
    const rates=[rate(item[0],'2YEAR'),rate(item[0],'3YEAR'),rate(item[0],'10YEAR')];
    rows.push({date,hasAllThree:rates.every(Number.isFinite)});
   }
   rows.sort((a,b)=>a.date.localeCompare(b.date));
   const latest=rows.at(-1),expectedRow=rows.find(x=>x.date===expected);
   output({result:rows.length?'ATOM_XML_PARSED':'NO_DATED_ENTRIES',
    http:res.status,finalHost:'TREASURY',totalEntries:rows.length,
    latestDate:latest?.date||null,latestHasAllThree:latest?.hasAllThree||false,
    expectedUsDatePresent:Boolean(expectedRow),
    expectedAllThree:expectedRow?.hasAllThree||false,
    latestDates:rows.slice(-3).map(x=>x.date)});
  }
 }
}catch(e){output({result:['TimeoutError','AbortError'].includes(e?.name)?'TIMEOUT':'NETWORK_OR_PARSE_FAILED'});}
