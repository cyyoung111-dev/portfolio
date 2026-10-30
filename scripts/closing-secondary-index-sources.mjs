// Supplemental daily-index references. Never promote to NH operating closes,
// price history, P&L, or Snapshots. Fail closed on missing/duplicate dates.
import {expectedMorningDate} from './telegram-morning-report.mjs';
const SETTINGS={
 DOW:{name:'다우존스',source:'FRED_DJIA',url:'https://fred.stlouisfed.org/graph/fredgraph.csv',code:'DJIA'},
 SOX:{name:'SOX',source:'FRED_NASDAQSOX',url:'https://fred.stlouisfed.org/graph/fredgraph.csv',code:'NASDAQSOX'},
 VIX:{name:'VIX',source:'CBOE_VIX_DAILY',url:'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'}
};
const iso=s=>{
 s=String(s||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
 }
 const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
 return m?iso(m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')):null;
};
export function parseReferenceCsv(id,date,text){
 if(!SETTINGS[id]||!iso(date)||typeof text!=='string'||text.length>1900000||text.includes('\0'))return null;
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines.length<3||lines.length>18000)return null;
 const columns=lines.shift().toUpperCase().split(',').map(s=>s.trim());
 const dateIdx=columns.indexOf(id==='VIX'?'DATE':'OBSERVATION_DATE');
 const priceIdx=columns.indexOf(id==='VIX'?'CLOSE':SETTINGS[id].code);
 if(dateIdx<0||priceIdx<0||columns.length>12)return null;
 const prices=new Map(),duplicates=new Set();
 for(const line of lines){
  const row=line.split(',');
  if(row.length!==columns.length)continue;
  const day=iso(row[dateIdx]);if(!day||day>date)continue;
  const raw=row[priceIdx].trim();
  if(!/^\d+(?:\.\d+)?$/.test(raw)||!(Number(raw)>0)||!Number.isFinite(Number(raw)))continue;
  if(prices.has(day))duplicates.add(day);
  prices.set(day,Number(raw));
 }
 if(duplicates.size||!prices.has(date))return null;
 const previous=[...prices.keys()].filter(day=>day<date).sort().at(-1);
 if(!previous)return null;
 return {id,label:SETTINGS[id].name,source:SETTINGS[id].source,
  date,value:prices.get(date),changePercent:(prices.get(date)/prices.get(previous)-1)*100,
  role:'NON_NH_REFERENCE_ONLY'};
}
export async function fetchSecondaryIndexes(day,{fetchImpl=fetch}={}){
 const expected=expectedMorningDate('SPX',day);
 if(!expected)return [];
 const from=new Date(Date.parse(expected+'T00:00:00Z')-21*86400000).toISOString().slice(0,10);
 const rows=await Promise.all(Object.entries(SETTINGS).map(async([id,config])=>{
  const url=new URL(config.url);
  if(config.code){url.searchParams.set('id',config.code);url.searchParams.set('cosd',from);url.searchParams.set('coed',expected);}
  try{
   const response=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(6000)});
   if(!response.ok)return null;
   const ct=response.headers?.get?.('content-type')||'';
   if(ct&&!/csv|plain|octet-stream/i.test(ct))return null;
   return parseReferenceCsv(id,expected,await response.text());
  }catch{return null;}
 }));
 return rows.filter(Boolean);
}
