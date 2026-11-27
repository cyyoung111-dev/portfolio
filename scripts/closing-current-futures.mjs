// 17:00 KST market context: last VALID trading-session quotes from US index
// futures, never US spot-index closes, settlement prices or NH equity closes.
// Yahoo intraday quotes can be delayed. Require <= 25 minutes age; no stale
// fallback, spot-index comparisons, financial writes or new NH credentials.
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
function inspectCurrentFuturesQuote(date,id,data,now){
 const unavailable=status=>({row:null,status});
 const item=FUTURES.find(x=>x.id===id);
 if(!item||!(now instanceof Date)||!Number.isFinite(now.getTime()))return unavailable('INPUT_UNVERIFIED');
 const p=closeWindow(now);
 if(p.date!==date||p.minute<1020||p.minute>=1080)return unavailable('OUTSIDE_DELIVERY_WINDOW');
 const result=data?.chart?.result;
 if(data?.chart?.error)return unavailable('PROVIDER_CHART_ERROR');
 if(!Array.isArray(result)||result.length!==1)return unavailable('PAYLOAD_UNVERIFIED');
 const chart=result[0];
 if(chart?.meta?.symbol!==item.symbol)return unavailable('SYMBOL_MISMATCH');
 if(!Array.isArray(chart.timestamp)
  ||!Array.isArray(chart.indicators?.quote)||chart.indicators.quote.length!==1
  ||!Array.isArray(chart.indicators.quote[0]?.close))return unavailable('PAYLOAD_UNVERIFIED');
 const quotes=chart.indicators.quote[0].close;
 if(quotes.length!==chart.timestamp.length||quotes.length>1000)return unavailable('PAYLOAD_UNVERIFIED');
 if(quotes.length===0)return unavailable('NO_QUOTE');
 // Latest reported candle only. An older candle in the same response must
 // never be substituted when the last one is stale, null or from another day.
 const i=quotes.length-1,stamp=chart.timestamp[i],value=quotes[i];
 if(!Number.isSafeInteger(stamp)||!Number.isFinite(value)||value<=0)return unavailable('NO_VALID_LATEST_QUOTE');
 const observedAt=new Date(stamp*1000);
 if(!Number.isFinite(observedAt.getTime()))return unavailable('PAYLOAD_UNVERIFIED');
 const age=now.getTime()-stamp*1000;
 if(age<0)return unavailable('FUTURE_QUOTE');
 if(closeWindow(observedAt).date!==date)return unavailable('QUOTE_DATE_MISMATCH');
 if(age>25*60*1000)return unavailable('STALE_QUOTE');
 const reference=chart.meta.chartPreviousClose;
 // The same symbol's provider-reported previous close, never a spot index
 // or CME official settlement claim. Conflicting reference fields are
 // withheld; the valid price remains visible.
 const alternate=chart.meta.previousClose;
 const comparable=Number.isFinite(reference)&&reference>0
   &&(alternate===undefined||alternate===null
      ||(Number.isFinite(alternate)&&Math.abs(alternate-reference)<=0.000001));
 const movement=comparable?{previousClose:reference,
   changePercent:(value/reference-1)*100,changeBasis:'YAHOO_CHART_PREVIOUS_CLOSE'}:{};
 return {status:'VERIFIED',row:{id,label:item.label,symbol:item.symbol,value,asOf:observedAt.toISOString(),
   source:'YAHOO_DELAYED_FUTURES_REFERENCE',...movement}};
}
export function validateCurrentFuturesQuote(date,id,data,now){
 return inspectCurrentFuturesQuote(date,id,data,now).row;
}
export async function readCurrentFutures(date,{fetchImpl=fetch,now=()=>new Date(),onDiagnostic=()=>{}}={}){
 // Emit only fixed enums and instrument IDs; diagnostics cannot affect quotes.
 const emit=(id,host,status)=>{
  try{onDiagnostic({kind:'US_FUTURES_READ',id,host,status});}catch{}
 };
 const at=now();
 if(!(at instanceof Date)||!Number.isFinite(at.getTime())
  ||closeWindow(at).date!==date||closeWindow(at).minute<1020||closeWindow(at).minute>=1080){
  for(const item of FUTURES)emit(item.id,'NONE','OUTSIDE_DELIVERY_WINDOW');
  return [];
 }
 return (await Promise.all(FUTURES.map(async item=>{
  let best=null,primaryStatus=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   const hostId=host.startsWith('query1.')?'PRIMARY':'SECONDARY';
   try{
    const url=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(item.symbol));
    url.searchParams.set('interval','5m');
    // A 1d chart may refer to the last provider session rather than the
    // current KST day. On a proven stale/date mismatch, use the existing
    // second request for a bounded explicit UTC time window instead.
    const explicit=hostId==='SECONDARY'&&['QUOTE_DATE_MISMATCH','STALE_QUOTE'].includes(primaryStatus);
    if(explicit){
     const end=Math.floor(now().getTime()/1000);
     url.searchParams.set('period1',String(end-24*60*60));
     url.searchParams.set('period2',String(end));
    }else url.searchParams.set('range','1d');
    const res=await fetchImpl(url.href,{headers:{accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!res?.ok){
     emit(item.id,hostId,[401,403].includes(res?.status)?'HTTP_ACCESS_DENIED':
      res?.status===429?'HTTP_RATE_LIMITED':'HTTP_UNAVAILABLE');
     continue;
    }
    const observed=now();
    let data;
    try{data=await res.json();}catch{emit(item.id,hostId,'JSON_UNVERIFIED');continue;}
    const {row,status}=inspectCurrentFuturesQuote(date,item.id,data,observed);
    if(hostId==='PRIMARY')primaryStatus=status;
    emit(item.id,hostId,status);
    if(!row)continue;
    // Explicit-window chartPreviousClose may mean the prior range boundary,
    // not the daily session close. Publish the verified price only.
    if(explicit){delete row.previousClose;delete row.changePercent;delete row.changeBasis;}
    if(!best||row.asOf>best.asOf)best=row;
    // Avoid an unnecessary second request when already <=10m fresh.
    // If delayed by 10-25m, compare the backup provider's timestamp
    // and choose its latest *verified* same-session price.
    if(observed.getTime()-Date.parse(best.asOf)<=10*60*1000)break;
   }catch{emit(item.id,hostId,'NETWORK_UNAVAILABLE');}
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
  const {previousClose,changePercent,changeBasis,...quote}=x;
  const validChange=changeBasis==='YAHOO_CHART_PREVIOUS_CLOSE'
    &&Number.isFinite(previousClose)&&previousClose>0&&Number.isFinite(changePercent)
    &&Math.abs(changePercent-(x.value/previousClose-1)*100)<0.000001;
  return [{...quote,...(validChange?{previousClose,changePercent,changeBasis}:{})}];
 });
}
export function formatCurrentFutures(date,rows=[],now=new Date(date+'T17:00:00+09:00')){
 const lines=['■ 장후 글로벌 반응 — 미국 지수선물 (지연 시세)'];
 const good=selectCurrentFuturesRows(date,rows,now).map(x=>{
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x.asOf));
  return x.label+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
   +'pt'+(Number.isFinite(x.changePercent)?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'')
   +' ['+time+' KST · Yahoo 지연 참고]';
 });
 lines.push(...(good.length?good:['유효한 최근 거래값 미확보 — 직전 미국 현물 종가를 현재값으로 대체하지 않음']));
 lines.push('확보 '+good.length+'/4'+(good.some(x=>/\([+-][0-9.]+%\)/.test(x))?' · 등락률은 Yahoo 전거래일 기준':'')+' · 지연 참고');
 return lines.join('\n');
}
