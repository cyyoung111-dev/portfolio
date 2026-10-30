import {MORNING_SERIES} from './telegram-morning-report.mjs';

const DOMESTIC_OFFICIAL=new Set(['KOSPI','KOSDAQ','SAMSUNG','SKHYNIX']);
// NH-confirmed US indices cannot be silently replaced by Yahoo or an unverified master.
export const NH_ONLY_INDEX_SYMBOLS=Object.freeze(['^GSPC','^IXIC','^NDX']);
const NH_ONLY_INDEX_SET=new Set(NH_ONLY_INDEX_SYMBOLS);
export function verifiedMorningMaster(date,observations=[],{cutoff=date+'T07:30:00+09:00'}={}) {
  const limit=Date.parse(cutoff),earliest=Date.parse(date+'T00:00:00Z')-8*86400000;
  if(!Number.isFinite(limit)||!Array.isArray(observations))return [];
  const selected=new Map();
  for(const row of observations){
    const config=MORNING_SERIES.find(s=>s.id===row?.seriesId);
    if(!config||row?.status!=='FINAL')continue;
    const value=Number(row.value),asOf=String(row.sourceDate||row.tradingDate||'');
    const received=Date.parse(row.receivedAt||''),observed=row.observedAt?Date.parse(row.observedAt):null;
    const source=String(row.source||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||asOf>=date||Date.parse(asOf+'T00:00:00Z')<earliest
      ||!Number.isFinite(value)||value<=0||!Number.isFinite(received)||received>limit
      ||(row.observedAt&&(!Number.isFinite(observed)||observed>limit)))continue;
    if(DOMESTIC_OFFICIAL.has(config.id)
      &&(source!=='KRX_OFFICIAL'||row.finality!=='REGULAR_CLOSE'||row.session!=='REGULAR'))continue;
    const candidate={label:config.label,symbol:config.symbol,date:asOf,value,changePercent:null,
      source:DOMESTIC_OFFICIAL.has(config.id)?'KRX_OFFICIAL':'MARKET_MASTER'};
    const earlier=selected.get(config.id);
    if(!earlier||asOf>earlier.date)selected.set(config.id,candidate);
  }
  return [...selected.values()];
}
export async function loadMorningMaster(date,{url,token,fetchImpl=fetch,now=new Date()}={}) {
  if(!url||!token)return [];
  let parsed;
  try{parsed=new URL(url);}catch{return [];}
  if(parsed.protocol!=='https:'||!['script.google.com','script.googleusercontent.com'].includes(parsed.hostname))return [];
  try{
    const body=new URLSearchParams({action:'getMarketBriefingMaster',accessToken:token});
    const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(17000)});
    if(!response.ok)return [];
    const result=await response.json();
    if(result?.status!=='ok'||!Array.isArray(result.observations))return [];
    return verifiedMorningMaster(date,result.observations);
  }catch{return [];}
}
export function mergeMorningSourceRows(yahooRows=[],masterRows=[],nhRows=[],domesticIndexRows=[]) {
  const output=new Map(yahooRows.filter(r=>!NH_ONLY_INDEX_SET.has(r?.symbol)).map(r=>[r.symbol,r]));
  for(const r of masterRows){
    if(NH_ONLY_INDEX_SET.has(r?.symbol))continue;
    const earlier=output.get(r.symbol);
    // Keep only trusted dated source and never displace a newer completed daily
    // observation with an older stored value.
    // Official KR closes supersede Yahoo, but a MARKET_MASTER observation
    // without previous close must not erase the same-date Yahoo daily change.
    // Keep price and percent from the SAME provider to avoid synthetic returns.
    if(!earlier || r.date>earlier.date ||
      (r.date===earlier.date && (r.source==='KRX_OFFICIAL'||!Number.isFinite(earlier.changePercent))))
      output.set(r.symbol,r);
  }
  for(const row of nhRows){
    if(row?.source!=='NH_INDEX_DAILY'||!/\d{4}-\d{2}-\d{2}/.test(row.date)||!Number.isFinite(row.value)||row.value<=0)continue;
    const prior=output.get(row.symbol);
    if(!prior||row.date>=prior.date)output.set(row.symbol,row);
  }
  return [...output.values()];
}
