// 17:00 KST market context: last VALID trading-session quotes from US index
// futures, never US spot-index closes, settlement prices or NH equity closes.
// Yahoo intraday quotes can be delayed. Require <= 25 minutes age; no stale
// fallback, inferred percentage move, financial writes or new NH credentials.
export const FUTURES=Object.freeze([
 Object.freeze({id:'ES',label:'S&P500 선물',symbol:'ES=F'}),
 Object.freeze({id:'NQ',label:'NASDAQ100 선물',symbol:'NQ=F'}),
 Object.freeze({id:'YM',label:'다우 선물',symbol:'YM=F'}),
 Object.freeze({id:'RTY',label:'러셀2000 선물',symbol:'RTY=F'})
]);
const closeWindow=d=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(d).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
};
export function validateCurrentFuturesQuote(date,id,data,now){
 const item=FUTURES.find(x=>x.id===id);
 if(!item||!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
 const p=closeWindow(now);
 if(p.date!==date||p.minute<1020||p.minute>=1050)return null;
 const result=data?.chart?.result;
 if(data?.chart?.error||!Array.isArray(result)||result.length!==1)return null;
 const chart=result[0];
 if(chart?.meta?.symbol!==item.symbol||!Array.isArray(chart.timestamp)
  ||!Array.isArray(chart.indicators?.quote)||chart.indicators.quote.length!==1
  ||!Array.isArray(chart.indicators.quote[0]?.close))return null;
 const quotes=chart.indicators.quote[0].close;
 if(quotes.length!==chart.timestamp.length||quotes.length===0||quotes.length>1000)return null;
 // Latest reported candle only. An older candle in the same response must
 // never be substituted when the last one is stale, null or from another day.
 const i=quotes.length-1,stamp=chart.timestamp[i],value=quotes[i];
 if(!Number.isSafeInteger(stamp)||!Number.isFinite(value)||value<=0)return null;
 const age=now.getTime()-stamp*1000;
 if(age<0||age>25*60*1000||closeWindow(new Date(stamp*1000)).date!==date)return null;
 return {id,label:item.label,symbol:item.symbol,value,asOf:new Date(stamp*1000).toISOString(),
   source:'YAHOO_DELAYED_FUTURES_REFERENCE'};
}
export async function readCurrentFutures(date,{fetchImpl=fetch,now=()=>new Date()}={}){
 const at=now();
 if(closeWindow(at).date!==date||closeWindow(at).minute<1020
  ||closeWindow(at).minute>=1050)return [];
 return (await Promise.all(FUTURES.map(async item=>{
  let best=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const url=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(item.symbol));
    url.searchParams.set('interval','5m');
    url.searchParams.set('range','1d');
    const res=await fetchImpl(url.href,{headers:{accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!res?.ok)continue;
    const observed=now(),row=validateCurrentFuturesQuote(date,item.id,await res.json(),observed);
    if(!row)continue;
    if(!best||row.asOf>best.asOf)best=row;
    // Avoid an unnecessary second request when already <=10m fresh.
    // If delayed by 10-25m, compare the backup provider's timestamp
    // and choose its latest *verified* same-session price.
    if(observed.getTime()-Date.parse(best.asOf)<=10*60*1000)break;
   }catch{/* no stale or unverified current price */ }
  }
  return best;
 }))).filter(Boolean);
}
export function selectCurrentFuturesRows(date,rows=[],now=new Date(date+'T17:00:00+09:00')){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Array.isArray(rows))return [];
 return FUTURES.flatMap(item=>{
  const found=rows.filter(x=>x?.id===item.id&&x?.symbol===item.symbol
    &&x?.label===item.label&&x?.source==='YAHOO_DELAYED_FUTURES_REFERENCE');
  if(found.length!==1)return [];
  const x=found[0],at=new Date(x.asOf);
  if(!Number.isFinite(at.getTime())||!Number.isFinite(x.value)||x.value<=0)return [];
  const age=now.getTime()-at.getTime();
  if(age<0||age>25*60*1000||closeWindow(at).date!==date)return [];
  return [x];
 });
}
export function formatCurrentFutures(date,rows=[],now=new Date(date+'T17:00:00+09:00')){
 const lines=['■ 17:00 글로벌 시장 반응 — 미국 지수선물 (지연 시세)'];
 const good=selectCurrentFuturesRows(date,rows,now).map(x=>{
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x.asOf));
  return x.label+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
   +'pt ['+time+' KST · Yahoo 지연 참고]';
 });
 lines.push(...(good.length?good:['유효한 최근 거래값 미확보 — 직전 미국 현물 종가를 현재값으로 대체하지 않음']));
 lines.push('확보 '+good.length+'/4 · 실시간 확정값이 아니며, 지수선물과 현물지수는 서로 다릅니다.');
 return lines.join('\n');
}
