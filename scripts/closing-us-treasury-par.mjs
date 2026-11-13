// US Treasury daily PAR yield curve. Official public reference ONLY, not
// a substitute labelled as Federal Reserve H.15 constant-maturity yields.
// No quote persistence, GAS, NH tokens or financial writes.
const RATES=Object.freeze([
 {id:'UST2Y',label:'미 국채 2년',field:'2YEAR'},
 {id:'UST3Y',label:'미 국채 3년',field:'3YEAR'},
 {id:'UST10Y_FRED',label:'미 국채 10년',field:'10YEAR'}
]);
function fieldValue(raw,field){
 const re=new RegExp('<(?:d:)?BC_'+field+'(?:\\s[^>]*)?>([^<]*)<\\/(?:d:)?BC_'+field+'>','gi');
 const all=[...raw.matchAll(re)];
 if(all.length!==1)return null;
 const v=all[0][1].trim();
 if(!/^\d+(?:\.\d{1,3})?$/.test(v))return null;
 const n=Number(v);
 return Number.isFinite(n)&&n>0&&n<25?n:null;
}
function fieldDate(raw){
 const matches=[...raw.matchAll(/<(?:d:)?NEW_DATE(?:\s[^>]*)?>([^<]*)<\/(?:d:)?NEW_DATE>/gi)];
 if(matches.length!==1)return null;
 const value=matches[0][1].trim();
 return /^20\d{2}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;
}
export function parseTreasuryParXml(allowedDates,source){
 if(!Array.isArray(allowedDates)||allowedDates.length<1||allowedDates.length>2
   ||allowedDates.some(x=>typeof x!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x))
   ||typeof source!=='string'||source.length>3000000||source.includes('\0'))return [];
 const entries=[...source.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)];
 if(entries.length<1||entries.length>200)return [];
 const days=new Map();
 for(const entry of entries){
  const raw=entry[0],day=fieldDate(raw);
  if(!allowedDates.includes(day))continue;
  if(days.has(day))return []; // ambiguous official day, no arbitrary winner
  days.set(day,raw);
 }
 const matched=allowedDates.find(d=>days.has(d));
 if(!matched)return [];
 const content=days.get(matched);
 return RATES.flatMap(item=>{
  const value=fieldValue(content,item.field);
  return value===null?[]:[{id:item.id,label:item.label,date:matched,value,
   source:'US_TREASURY_PAR_DAILY'}];
 });
}
export async function readOfficialTreasuryPar(allowedDates,{fetchImpl=fetch,onDiagnostic=()=>{}}={}){
 const emit=status=>{try{onDiagnostic({kind:'TREASURY_PAR_READ',status});}catch{}};
 if(!Array.isArray(allowedDates)||!allowedDates.length){emit('SESSION_UNVERIFIED');return [];}
 const month=allowedDates[0].slice(0,7).replace('-','');
 if(!/^20[0-9]{4}$/.test(month)){emit('SESSION_UNVERIFIED');return [];}
 const u=new URL('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml');
 u.searchParams.set('data','daily_treasury_yield_curve');
 u.searchParams.set('field_tdr_date_value_month',month);
 try{
  const res=await fetchImpl(u.href,{headers:{accept:'application/xml,text/xml,application/atom+xml'},
   redirect:'follow',signal:AbortSignal.timeout(12000)});
  if(res?.ok!==true){emit('HTTP_UNAVAILABLE');return [];}
  const mime=String(res.headers?.get?.('content-type')||'').toLowerCase();
  const host=new URL(res.url).hostname;
  if(host!=='home.treasury.gov'||!/(?:application\/(?:xml|atom\+xml)|text\/xml)(?:;|$)/.test(mime)){
   emit('SOURCE_OR_TYPE_INVALID');return [];
  }
  if(Number(res.headers?.get?.('content-length')||0)>3000000){
   emit('RESPONSE_TOO_LARGE');return [];
  }
  const xml=await res.text();
  const rows=parseTreasuryParXml(allowedDates,xml);
  emit(rows.length?'VERIFIED':'NO_EXACT_VALID_ROW');
  return rows;
 }catch{emit('NETWORK_OR_PARSE_FAILED');return [];}
}
