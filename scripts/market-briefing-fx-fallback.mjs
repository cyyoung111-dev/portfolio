// Verified-date delayed USD/KRW daily quotes for market briefing only.
// This read-only fallback does NOT populate the portfolio's historical FX
// ledger and must never be reused for confirmed Snapshot FX conversion.
const SYMBOL='KRW=X';
const DAY_MS=86400000;
const dayMs=date=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('FX_YAHOO_INVALID_DATE');
  const ms=Date.parse(date+'T00:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)
    throw new Error('FX_YAHOO_INVALID_DATE');
  return ms;
};
export async function fetchUsdKrwYahooDaily({from,to,fetchImpl=fetch,timeoutMs=30000}){
  const fromMs=dayMs(from),toMs=dayMs(to);
  if(toMs<fromMs||toMs-fromMs>45*DAY_MS)throw new Error('FX_YAHOO_INVALID_RANGE');
  const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX');
  url.searchParams.set('period1',String(Math.floor((fromMs-2*DAY_MS)/1000)));
  url.searchParams.set('period2',String(Math.floor((toMs+2*DAY_MS)/1000)));
  url.searchParams.set('interval','1d');
  let response;
  try {
    response=await fetchImpl(url.toString(),{
      headers:{accept:'application/json'},redirect:'follow',
      signal:AbortSignal.timeout(Math.min(45000,Math.max(5000,Number(timeoutMs)||30000))),
    });
  } catch { throw new Error('FX_YAHOO_FETCH_FAILED'); }
  if(!response.ok)throw new Error('FX_YAHOO_HTTP_'+response.status);
  let payload;
  try {payload=await response.json();}catch{throw new Error('FX_YAHOO_INVALID_JSON');}
  const chart=payload?.chart?.result?.[0];
  if(!chart||chart.meta?.symbol!==SYMBOL||chart.meta?.currency!=='KRW'
    ||!Array.isArray(chart.timestamp)||!Array.isArray(chart.indicators?.quote?.[0]?.close))
    throw new Error('FX_YAHOO_INVALID_SCHEMA');
  const closes=chart.indicators.quote[0].close;
  const byDate=new Map();
  for(let i=0;i<Math.min(chart.timestamp.length,closes.length);i++){
    const timestamp=Number(chart.timestamp[i]),price=Number(closes[i]);
    if(!Number.isFinite(timestamp)||timestamp<0||!Number.isFinite(price)||price<=100||price>=10000)continue;
    // Yahoo daily candle timestamps carry the provider's UTC session date.
    const date=new Date(timestamp*1000).toISOString().slice(0,10);
    if(date>=from&&date<=to)byDate.set(date,{date,currency:'USD',rate:price});
  }
  const history=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(!history.length)throw new Error('FX_YAHOO_NO_DATED_CLOSE');
  return {status:'ok',source:'YAHOO_USDKRW_DELAYED_DAILY',history};
}
