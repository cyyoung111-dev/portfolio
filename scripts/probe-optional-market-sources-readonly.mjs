// Public read-only diagnostics for missing optional briefing sources.
// Prints status, date and response contract only; never publishes prices,
// credentials, user holdings, Telegram messages, or raw API response bodies.
import {readTreasuryCurve} from './closing-us-treasury-curve.mjs';
const REPORT_DATE='2026-11-10';
const diagnostics=[];
const rates=await readTreasuryCurve(REPORT_DATE,{
 onDiagnostic:d=>diagnostics.push({id:d.id,status:d.status})
});
console.log(JSON.stringify({kind:'FRED_MARKET_SOURCE_PROBE',
 reportDate:REPORT_DATE,diagnostics,
 verified:rates.map(x=>({id:x.id,asOf:x.date,source:x.source})),
 financeWrites:0,telegramSends:0}));
async function fred(code){
 const u=new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
 u.searchParams.set('id',code);
 u.searchParams.set('cosd','2026-10-29');
 u.searchParams.set('coed','2026-11-09');
 const info={kind:'FRED_CONTRACT_PROBE',code};
 try{
  const r=await fetch(u,{headers:{accept:'text/csv'},redirect:'error',
   signal:AbortSignal.timeout(6500)});
  info.http=r.status;
  info.type=(r.headers.get('content-type')||'').slice(0,60);
  if(r.ok){
   const txt=await r.text();
   const lines=txt.trim().split(/\r?\n/);
   info.bytes=txt.length;
   info.header=lines[0]?.slice(0,95)||null;
   info.dateRange={first:lines[1]?.split(',')[0]||null,
     last:lines.at(-1)?.split(',')[0]||null};
   info.lines=lines.length;
  }
 }catch(e){info.error=['TimeoutError','AbortError'].includes(e?.name)
  ?'TIMEOUT':'NETWORK_OR_RESPONSE';}
 console.log(JSON.stringify(info));
}
await Promise.all(['DGS2','DGS3','DGS10'].map(fred));
for(const code of ['ES=F','NQ=F','YM=F','RTY=F']){
 const log={kind:'FUTURES_MARKET_SOURCE_PROBE',symbol:code,results:[]};
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
  const url=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(code));
  url.searchParams.set('interval','5m');url.searchParams.set('range','1d');
  const item={host};
  try{
   const r=await fetch(url.href,{redirect:'error',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
   item.http=r.status;
   if(r.ok){
    const payload=await r.json(),v=payload?.chart?.result?.[0];
    item.error=payload?.chart?.error?'UPSTREAM_CHART_ERROR':null;
    item.metaSymbol=v?.meta?.symbol||null;
    item.candles=v?.timestamp?.length||0;
    item.latestUtc=Number.isSafeInteger(v?.timestamp?.at(-1))
      ?new Date(v.timestamp.at(-1)*1000).toISOString():null;
    item.latestValidClose=Number.isFinite(v?.indicators?.quote?.[0]?.close?.at(-1));
    item.apiAgeMinutes=Number.isSafeInteger(v?.timestamp?.at(-1))
      ?Math.round((Date.now()-v.timestamp.at(-1)*1000)/60000):null;
   }
  }catch(e){item.error=['TimeoutError','AbortError'].includes(e?.name)
    ?'TIMEOUT':'NETWORK_OR_RESPONSE';}
  log.results.push(item);
 }
 console.log(JSON.stringify(log));
}
