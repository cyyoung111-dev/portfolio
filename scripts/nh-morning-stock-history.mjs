import {MORNING_SERIES,expectedMorningDate} from './telegram-morning-report.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';

// Read-only priority source: previously saved NH REGULAR_CLOSE, not live quotes.
// Never requests NH OAuth, modifies stored history, or trusts KRX_CARRY/Yahoo rows.
const STOCKS=Object.freeze([
  {id:'SAMSUNG',code:'005930'},
  {id:'SKHYNIX',code:'000660'},
  {id:'NVDA',code:'NVDA'},
  {id:'MU',code:'MU'},
]);
export function normalizeNhStoredStockCloses(date,data){
  if(data?.status!=='ok'||!data.prices||typeof data.prices!=='object'
    ||Array.isArray(data.prices))return [];
  const results=[];
  for(const {id,code} of STOCKS){
    const item=MORNING_SERIES.find(x=>x.id===id), expected=expectedMorningDate(id,date);
    if(!item||!expected)continue;
    const prior=expectedMorningDate(id,expected);
    const rows=data.prices[code];
    if(!Array.isArray(rows)||rows.length>30)continue;
    const valid=row=>row?.source==='NH_REGULAR_CLOSE'
      &&row?.date===expected&&typeof row.price==='number'
      &&Number.isFinite(row.price)&&row.price>0;
    const matching=rows.filter(row=>row?.date===expected);
    if(matching.length!==1||!valid(matching[0]))continue;
    const priorRows=rows.filter(row=>row?.date===prior);
    const previous=priorRows.length===1&&priorRows[0]?.source==='NH_REGULAR_CLOSE'
      &&typeof priorRows[0].price==='number'&&Number.isFinite(priorRows[0].price)
      &&priorRows[0].price>0?priorRows[0].price:null;
    results.push({label:item.label,symbol:item.symbol,date:expected,
      value:matching[0].price,changePercent:previous===null?null:
        (matching[0].price/previous-1)*100,source:'NH_REGULAR_CLOSE'});
  }
  return results;
}
export async function readNhStoredMorningStocks(date,{url,token,fetchImpl=fetch}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||!url||!token)return [];
  let endpoint;
  try{endpoint=validateGasEndpoint(url);}catch{return [];}
  const needed=STOCKS.map(x=>expectedMorningDate(x.id,date));
  if(needed.some(x=>!x))return [];
  const from=new Date(Math.min(...needed.map(d=>Date.parse(d+'T00:00:00Z')))-8*86400000)
    .toISOString().slice(0,10);
  const body=new URLSearchParams({action:'getPriceHistory',accessToken:token,
    codes:STOCKS.map(x=>x.code).join(','),from,to:needed.sort().at(-1)});
  try{
    const response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(17000)});
    if(!response.ok)return [];
    return normalizeNhStoredStockCloses(date,await response.json());
  }catch{return [];}
}
