// Presentation-only morning supplements. Never replace NH operating closes,
// snapshots, trades, dividends or dated claim/SENT logic.
import {expectedMorningDate,MORNING_SERIES} from './telegram-morning-report.mjs';
import {readTreasuryCurve,verifyTreasuryCurve} from './closing-us-treasury-curve.mjs';
import {FUTURES} from './closing-current-futures.mjs';
import {selectClosingVkospi} from './closing-vkospi-reference.mjs';
import {verifyOfficialKrxTurnover} from './closing-krx-turnover.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';
import {readKofiaLiquidity} from './briefing-kofia-liquidity.mjs';
import {readInvestorTrends} from './briefing-krx-investor-trends.mjs';
import {readMorningBreadth,formatMorningBreadth} from './telegram-morning-breadth.mjs';
export {formatMorningBreadth};

const US=Object.freeze(['SPX','NASDAQ','NDX']);
const SESSION_MS=90*60000; // 07:40 KST overlaps CME's daily maintenance halt.
function kst(d){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(d).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute),
  hhmm:p.hour+':'+p.minute};
}
function validDay(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)
 &&Number.isFinite(Date.parse(date+'T00:00:00Z'))
 &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
function num(v){return Number.isFinite(v)&&v>0&&v<10000000;}
export function validateMorningFuturesQuote(date,id,payload,now){
 const info=FUTURES.find(x=>x.id===id);
 if(!info||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||kst(now).date!==date||kst(now).minute<390||kst(now).minute>=490)return null;
 const found=payload?.chart?.result;
 if(payload?.chart?.error||!Array.isArray(found)||found.length!==1)return null;
 const chart=found[0],timestamps=chart?.timestamp,closes=chart?.indicators?.quote?.[0]?.close;
 if(chart?.meta?.symbol!==info.symbol||!Array.isArray(timestamps)||!Array.isArray(closes)
  ||timestamps.length!==closes.length||timestamps.length<1||timestamps.length>1000)return null;
 // CME maintenance can append untraded 5-minute bars with null closes.
 // Select the most recent ACTUAL positive trade, not the latest empty slot.
 // Never reuse an older date, malformed positive bar or >90m stale trade.
 let selected=closes.length-1;
 for(let i=0;i<timestamps.length;i++){
  if(!Number.isSafeInteger(timestamps[i])||
    (i>0&&timestamps[i]<=timestamps[i-1]))return null;
 }
 while(selected>=0&&closes[selected]===null)selected--;
 if(selected<0||closes.length-1-selected>18)return null;
 const stamp=timestamps[selected],value=closes[selected];
 if(!num(value)||timestamps.at(-1)*1000>now.getTime()+30000)return null;
 const age=now.getTime()-stamp*1000;
 if(age<0||age>SESSION_MS||kst(new Date(stamp*1000)).date!==date)return null;
 return {id,symbol:info.symbol,value,asOf:new Date(stamp*1000).toISOString(),
  source:'YAHOO_DELAYED_FUTURES_REFERENCE'};
}
export async function readMorningFutures(date,{now=()=>new Date(),fetchImpl=fetch}={}){
 if(!validDay(date)||kst(now()).date!==date)return [];
 return (await Promise.all(FUTURES.map(async info=>{
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const target=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(info.symbol));
    target.searchParams.set('interval','5m');target.searchParams.set('range','1d');
    const response=await fetchImpl(target.href,{headers:{accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!response?.ok)continue;
    const row=validateMorningFuturesQuote(date,info.id,await response.json(),now());
    if(row)return row;
   }catch{/* fail closed */ }
  }
  return null;
 }))).filter(Boolean);
}
export function formatMorningFutures(date,rows=[],now=new Date(date+'T07:40:00+09:00')){
 const safe=FUTURES.flatMap(info=>{
  const match=rows.filter(r=>r?.id===info.id&&r?.symbol===info.symbol
    &&r?.source==='YAHOO_DELAYED_FUTURES_REFERENCE');
  if(match.length!==1)return [];
  const v=match[0],time=Date.parse(v.asOf);
  return num(v.value)&&Number.isFinite(time)&&time<=now.getTime()
   &&now.getTime()-time<=SESSION_MS&&kst(new Date(time)).date===date?[v]:[];
 });
 if(!safe.length)return '미국 선물 ES/NQ/YM/RTY: 최근 검증된 시세 미확보';
 return '미국 선물 참고: '+safe.map(r=>r.id+' '+r.value.toLocaleString('en-US',
  {maximumFractionDigits:2})+' ('+kst(new Date(r.asOf)).hhmm+')').join(' · ')
  +' [KST · Yahoo 지연 시세, CME 점검시간에는 최종 체결값 · '+safe.length+'/4]';
}
export function formatMorningTreasury(date,rows=[]){
 const safe=verifyTreasuryCurve(date,rows);
 const pick=id=>safe.find(x=>x.id===id);
 const a=pick('UST2Y'),b=pick('UST3Y'),c=pick('UST10Y_FRED');
 const expected=expectedMorningDate('SPX',date);
 const pct=x=>!x?'미확보':x.value.toFixed(2)+'% ['+x.date
   +(x.date===expected?'':' · 발표 지연')+']';
 return '미 국채 2Y '+pct(a)+' · 3Y '+pct(b)
   +' · 10Y '+pct(c)+' · 10Y-2Y '
   +(a&&c&&a.date===c.date?(Math.round((c.value-a.value)*100)>=0?'+':'')
     +Math.round((c.value-a.value)*100)+'bp ['+a.date+']':'기준일 불일치 또는 미확보')
   +' [FRED H.15 참고]';
}
export function formatMorningVkospi(rows=[]){
 const x=rows.length===1?rows[0]:null;
 return 'VKOSPI: '+(x&&x.id==='VKOSPI'&&num(x.value)
   ?x.value.toFixed(2)+' ['+x.date+' · KRX 참고]':'확정 기준일 자료 미확보');
}
export function formatMorningTurnover(date,rows=[]){
 const valid=verifyOfficialKrxTurnover(date,rows);
 if(!valid.length)return 'KOSPI·KOSDAQ 거래대금: 공식 기준일 자료 미확보';
 return '지수 구성종목 거래대금: '+valid.map(x=>x.market+' '
  +(x.valueKrw/1e12).toFixed(2)+'조원').join(' · ')+' ['+date+' · KRX]';
}
async function readGas(date,action,params,{url,token,fetchImpl}){
 if(!url||typeof token!=='string'||token.length<12)return null;
 try{
  const endpoint=validateGasEndpoint(url);
  const response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token,...params}),
   redirect:'follow',signal:AbortSignal.timeout(16000)});
  return response?.ok?await response.json():null;
 }catch{return null;}
}
export async function readMorningSupplements(date,{now=()=>new Date(),fetchImpl=fetch,
 fetchDaily,nhRows=[],breadthKey=process.env.KRX_AUTH_KEY,url=process.env.GAS_WEB_APP_URL,
 token=process.env.GAS_ACCESS_TOKEN}={}){
 if(!validDay(date)||typeof fetchDaily!=='function')return {};
 const expectedUs=expectedMorningDate('SPX',date);
 const expectedKr=expectedMorningDate('KOSPI',date);
 const missing=US.filter(id=>!nhRows.some(r=>r?.symbol===MORNING_SERIES.find(x=>x.id===id)?.symbol
  &&r.date===expectedUs&&r.source==='NH_INDEX_DAILY'));
 const [usReferences,treasury,futures,vk,turnover,breadth,liquidity,investors]=await Promise.all([
  Promise.all(missing.map(async id=>{
   const info=MORNING_SERIES.find(x=>x.id===id);
   try{
    const row=await fetchDaily(info.label,info.symbol,date,{fetchImpl,now:now()});
    return row?.date===expectedUs&&row.source==='Yahoo Finance 일봉'
      &&row.symbol===info.symbol&&row.label===info.label&&num(row.value)
      ?{...row,referenceOnly:true}:null;
   }catch{return null;}
  })).then(x=>x.filter(Boolean)),
  readTreasuryCurve(date,{fetchImpl}).catch(()=>[]),
  readMorningFutures(date,{now,fetchImpl}).catch(()=>[]),
  readGas(date,'getBenchmark',{benchmark:'VKOSPI',from:expectedKr,to:expectedKr},
   {url,token,fetchImpl}).then(data=>selectClosingVkospi(expectedKr,data)).catch(()=>[]),
  readGas(date,'getKrxMarketTurnover',{date:expectedKr},
   {url,token,fetchImpl}).then(data=>{
    if(data?.status!=='ok'||data.date!==expectedKr||data.readOnly!==true
     ||data.source!=='KRX_OFFICIAL_INDEX_DAILY'||!Array.isArray(data.rows))return [];
    return verifyOfficialKrxTurnover(expectedKr,data.rows);
   }).catch(()=>[]),
  readMorningBreadth(date,{authKey:breadthKey,now,fetchImpl}).catch(()=>[]),
  readKofiaLiquidity(date,{fetchImpl}).catch(()=>null),
  readInvestorTrends(date,{mode:'morning',now,fetchImpl}).catch(()=>null)
 ]);
 return {usReferences,treasury,futures,vkospi:vk,turnover,breadth,liquidity,investors,turnoverDate:expectedKr};
}
