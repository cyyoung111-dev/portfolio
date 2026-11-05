import {pathToFileURL} from 'node:url';

export const SOURCE_URL='https://www.hanwhafund.co.kr/api/fund/dailyPrice';
export const FUND_CD='008942';
const iso=/^\d{4}-\d{2}-\d{2}$/;

function parseDate(value){
 const raw=String(value??'').trim();
 const normalized=/^\d{8}$/.test(raw)
   ?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6)
   :raw.replaceAll(/[./]/g,'-');
 const epoch=Date.parse(normalized+'T00:00:00Z');
 if(!iso.test(normalized)||!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,10)!==normalized)
   throw Error('HANWHA_SOURCE_DATE');
 return normalized;
}

export function parseHanwhaNav(payload,from,to){
 if(!iso.test(from||'')||!iso.test(to||'')||from>to)throw Error('HANWHA_SOURCE_RANGE');
 if(!Array.isArray(payload?.list)||!payload.list.length)throw Error('HANWHA_SOURCE_EMPTY');
 const mapped=new Map();
 for(const item of payload.list){
  if(!item||typeof item!=='object'||!Object.hasOwn(item,'wkdate')||!Object.hasOwn(item,'price'))
    throw Error('HANWHA_SOURCE_SCHEMA');
  const date=parseDate(item.wkdate);
  const raw=String(item.price??'').replaceAll(',','').trim();
  if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error('HANWHA_SOURCE_SCHEMA');
  const nav=Number(raw);
  if(!Number.isFinite(nav)||nav<=0)throw Error('HANWHA_SOURCE_SCHEMA');
  if(date<from||date>to)continue;
  if(mapped.has(date)&&mapped.get(date)!==nav)throw Error('HANWHA_SOURCE_CONFLICT');
  mapped.set(date,nav);
 }
 if(!mapped.size)throw Error('HANWHA_SOURCE_NO_RANGE_ROWS');
 return [...mapped].sort(([a],[b])=>a.localeCompare(b))
   .map(([date,nav])=>({date,nav}));
}

export async function runPublicHanwhaSource({now=new Date(),fetchImpl=fetch}={}){
 const to=new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(now);
 const from=new Date(Date.parse(to+'T00:00:00Z')-31*86400000).toISOString().slice(0,10);
 const url=new URL(SOURCE_URL);
 url.search=new URLSearchParams({fundCd:FUND_CD,period:'',startDate:from,endDate:to});
 let response;
 try{
  response=await fetchImpl(url,{method:'GET',headers:{'User-Agent':'Mozilla/5.0'},
   signal:AbortSignal.timeout(60000)});
 }catch{
  throw Error('HANWHA_SOURCE_NETWORK_UNVERIFIED');
 }
 if(!response?.ok)throw Error('HANWHA_SOURCE_HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}
 catch{throw Error('HANWHA_SOURCE_JSON_UNVERIFIED');}
 const received=parseHanwhaNav(payload,from,to);
 // The provider can expose a dated quote before that day's final publication.
 // Preserve only prior KST calendar dates as eligible history. This is a
 // conservative eligibility rule, not an assertion of independent NAV audit.
 const rows=received.filter(row=>row.date<to);
 if(!rows.length)throw Error('HANWHA_SOURCE_NO_PRIOR_DAY_ROWS');
 return {mode:'SOURCE_ONLY',writerInvoked:false,code:'F00001',
  lookupCode:FUND_CD,classCode:'C-RPe',provider:'HANWHA_2045_CRPE',
  sourceRows:rows.length,sameDayExcluded:received.length-rows.length,
  historicalCutoffExclusive:to,from,to,latestDate:rows.at(-1).date,rows};
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{console.log(JSON.stringify(await runPublicHanwhaSource()));}
 catch(e){
  console.error(/^HANWHA_SOURCE_[A-Z_]+$/.test(e?.message||'')?e.message:'HANWHA_SOURCE_UNVERIFIED');
  process.exitCode=1;
 }
}
