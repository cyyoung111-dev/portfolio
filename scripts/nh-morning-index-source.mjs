import {MORNING_SERIES,expectedMorningDate} from './telegram-morning-report.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';

// Use the same GAS getBenchmarks NH primary feed as portfolio performance
// comparisons. Unsupported or stale data remains a labeled Yahoo fallback.
const VERIFIED=Object.freeze([
  {id:'SPX',type:'SP500',code:'SPX'},
  {id:'NASDAQ',type:'NASDAQ',code:'COMP'},
  {id:'NDX',type:'NASDAQ100',code:'NDX'},
]);
export async function readNhMorningIndexes(date,{url,token,fetchImpl=fetch}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||!url||!token)return [];
  let endpoint;
  try{endpoint=validateGasEndpoint(url);}catch{return [];}
  const expected=expectedMorningDate('SPX',date);
  if(!expected||expected>=date)return [];
  const from=new Date(expected+'T00:00:00Z');
  from.setUTCDate(from.getUTCDate()-8);
  const body=new URLSearchParams({action:'getBenchmarks',accessToken:token,
    benchmarks:'SP500,NASDAQ,NASDAQ100',
    from:from.toISOString().slice(0,10),to:expected,fresh:'0'});
  try{
    const response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(17000)});
    if(!response.ok)return [];
    const data=await response.json();
    if(data?.status!=='ok'||!data.series||!data.seriesMeta)return [];
    const found=[];
    for(const {id,type,code} of VERIFIED){
      const info=MORNING_SERIES.find(x=>x.id===id),meta=data.seriesMeta[type],rows=data.series[type];
      if(!info||meta?.source!=='NH_INDEX_DAILY'||meta.providerCode!==code||!Array.isArray(rows))continue;
      if(rows.length<2||rows.length>400)continue;
      const usable=rows.filter(x=>x?.source==='NH_INDEX_DAILY'
        &&x.sourceDate===x.date&&x.status==='CONFIRMED'
        &&x.priceType==='REGULAR_CLOSE'
        &&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||''))
        &&x.date<=expected&&Number.isFinite(x.value)&&x.value>0)
        .sort((a,b)=>a.date.localeCompare(b.date));
      // Reject malformed rows rather than laundering them as NH confirmed.
      if(usable.length!==rows.length||new Set(usable.map(x=>x.date)).size!==rows.length)continue;
      const last=usable.at(-1),previous=usable.at(-2);
      if(last.date!==expected||!previous||previous.date>=expected)continue;
      found.push({label:info.label,symbol:info.symbol,date:expected,value:last.value,
        changePercent:(last.value/previous.value-1)*100,source:'NH_INDEX_DAILY'});
    }
    return found;
  }catch{return [];}
}
