import {krxSessionStatus} from './krx-session-calendar.mjs';
import {isOfficialCloseWindow} from './krx-official-daily-index.mjs';
import {expectedMorningDate,MORNING_SERIES} from './telegram-morning-report.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';

// Exact-date, read-only reuse of GAS NH_REGULAR_CLOSE history. The domestic
// closing session is TODAY; US stocks refer to the LAST completed US session.
const STOCKS=Object.freeze([
 {id:'SAMSUNG',code:'005930',market:'KR'},
 {id:'SKHYNIX',code:'000660',market:'KR'},
 {id:'NVDA',code:'NVDA',market:'US'},
 {id:'MU',code:'MU',market:'US'}
]);
const MACROS=Object.freeze([
 {id:'USDKRW',label:'원/달러',symbol:'KRW=X'},
 {id:'DXY',label:'DXY',symbol:'DX-Y.NYB'},
 {id:'UST10Y',label:'미 10년물',symbol:'^TNX'}
]);
const safeDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)
  &&Number.isFinite(Date.parse(date+'T00:00:00Z'))
  &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
export function closingStockSessions(day){
 if(!safeDate(day)||krxSessionStatus(day)!=='OPEN')return null;
 const us=expectedMorningDate('NVDA',day);
 const priorKr=expectedMorningDate('SAMSUNG',day);
 const priorUs=us?expectedMorningDate('NVDA',us):null;
 if(!us||!priorKr||!priorUs)return null;
 return {day,us,priorKr,priorUs};
}
export function normalizeClosingNhStocks(date,data){
 const dates=closingStockSessions(date);
 if(!dates||data?.status!=='ok'||!data.prices
   ||typeof data.prices!=='object'||Array.isArray(data.prices))return [];
 const result=[];
 for(const item of STOCKS){
   const expected=item.market==='KR'?dates.day:dates.us;
   const prior=item.market==='KR'?dates.priorKr:dates.priorUs;
   const rows=data.prices[item.code];
   if(!Array.isArray(rows)||rows.length>30)continue;
   const matched=rows.filter(x=>x?.date===expected);
   if(matched.length!==1)continue;
   const row=matched[0];
   if(row?.source!=='NH_REGULAR_CLOSE'||!Number.isFinite(row.price)||row.price<=0)continue;
   const previous=rows.filter(x=>x?.date===prior);
   const p=previous.length===1&&previous[0]?.source==='NH_REGULAR_CLOSE'
     &&Number.isFinite(previous[0].price)&&previous[0].price>0?previous[0].price:null;
   const config=MORNING_SERIES.find(x=>x.id===item.id);
   if(!config)continue;
   result.push({id:item.id,label:config.label,symbol:config.symbol,date:expected,
     value:row.price,changePercent:p===null?null:(row.price/p-1)*100,source:'NH_REGULAR_CLOSE'});
 }
 return result;
}
// Read-only, fixed-enum diagnosis for missing NH regular closes. Never return
// raw GAS responses, prices, account details, credentials or endpoint URLs.
export function describeClosingNhStockRead(date,data){
 const session=closingStockSessions(date);
 if(!session)return {status:'SESSION_UNVERIFIED'};
 if(data?.status!=='ok')return {status:data?.status==='error'&&data?.message==='인증 실패'
   ?'GAS_AUTH_REJECTED':'GAS_RESPONSE_NOT_OK'};
 if(!data.prices||typeof data.prices!=='object'||Array.isArray(data.prices))
   return {status:'PRICE_RESPONSE_SCHEMA'};
 return {status:'GAS_RESPONSE_OK',stocks:STOCKS.map(item=>{
   const expected=item.market==='KR'?session.day:session.us;
   const rows=data.prices[item.code];
   if(!Array.isArray(rows))return {id:item.id,status:'CODE_NOT_RETURNED'};
   if(rows.length>30)return {id:item.id,status:'ROW_LIMIT_EXCEEDED'};
   const matching=rows.filter(x=>x?.date===expected);
   if(matching.length===0)return {id:item.id,status:'EXPECTED_DATE_MISSING'};
   if(matching.length!==1)return {id:item.id,status:'DUPLICATE_DATE'};
   const row=matching[0];
   if(row.source!=='NH_REGULAR_CLOSE')return {id:item.id,status:'SOURCE_NOT_NH'};
   if(!Number.isFinite(row.price)||row.price<=0)return {id:item.id,status:'INVALID_PRICE'};
   return {id:item.id,status:'VERIFIED'};
 })};
}

export async function readNhClosingStocks(date,{url=process.env.GAS_WEB_APP_URL,
 token=process.env.GAS_ACCESS_TOKEN,fetchImpl=fetch,onDiagnostic=()=>{}}={}){
 const emit=result=>{try{onDiagnostic(result);}catch{}};
 const session=closingStockSessions(date);
 if(!session||!url||typeof token!=='string'||token.length<12){
   emit({status:'CONFIG_OR_SESSION_UNVERIFIED'});return [];
 }
 let endpoint;
 try{endpoint=validateGasEndpoint(url);}catch{
   emit({status:'GAS_ENDPOINT_INVALID'});return [];
 }
 const oldest=Math.min(...[session.priorKr,session.priorUs].map(s=>Date.parse(s+'T00:00:00Z')));
 const from=new Date(oldest-2*86400000).toISOString().slice(0,10);
 const payload=new URLSearchParams({action:'getPriceHistory',accessToken:token,
   codes:STOCKS.map(x=>x.code).join(','),from,to:date});
 let response,data;
 try{
   response=await fetchImpl(endpoint,{method:'POST',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body:payload,redirect:'follow',signal:AbortSignal.timeout(30000)});
 }catch(error){
   // Don't reveal URL, token or raw errors. Real 17s GAS tails can otherwise
   // silently appear as empty NH history; the 30s cap remains bounded.
   emit({status:error?.name==='TimeoutError'?'GAS_TIMEOUT_30S':'GAS_FETCH_FAILED'});
   return [];
 }
 if(!response?.ok){emit({status:'GAS_HTTP_UNAVAILABLE'});return [];}
 try{data=await response.json();}
 catch{emit({status:'GAS_JSON_INVALID'});return [];}
 emit(describeClosingNhStockRead(date,data));
 return normalizeClosingNhStocks(date,data);
}
// Stock references are never written to the portfolio price/history sheets.
// A KRX-published KR close or a completed US Yahoo daily bar can supplement
// missing NH history; each keeps a distinct provenance label.
export function validClosingStockReference(date,row){
 const session=closingStockSessions(date);
 const target=STOCKS.find(x=>x.id===row?.id);
 const config=target?MORNING_SERIES.find(x=>x.id===target.id):null;
 if(!session||!target||!config||row.label!==config.label||row.symbol!==config.symbol
   ||row.date!==(target.market==='KR'?session.day:session.us)
   ||!Number.isFinite(row.value)||row.value<=0
   ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))return false;
 return row.source==='NH_REGULAR_CLOSE'
   ||(target.market==='KR'&&['KRX_OFFICIAL','YAHOO_KR_DAILY_REFERENCE'].includes(row.source))
   ||(target.market==='US'&&row.source==='YAHOO_DAILY_REFERENCE');
}
export function normalizeKrxOfficialClosingStocks(date,data,{instant=new Date()}={}){
 if(!closingStockSessions(date)||data?.status!=='ok'||data.requestedDate!==date
   ||!data.closes||typeof data.closes!=='object'||Array.isArray(data.closes)
   ||!Number.isFinite(instant?.getTime?.()))return [];
 const result=[];
 for(const item of STOCKS.filter(x=>x.market==='KR')){
  const row=data.closes[item.code],config=MORNING_SERIES.find(x=>x.id===item.id);
  const stamp=Date.parse(row?.receivedAt||'');
  if(!config||row?.code!==item.code||row?.requestedDate!==date
    ||row.usedDate!==date||row.source!=='KRX_OFFICIAL'
    ||!['KRX','KRX_OTP'].includes(row.providerSource)
    ||!Number.isFinite(row.price)||row.price<=0
    ||!Number.isFinite(stamp)||stamp>Date.parse(instant.toISOString())+2000
    ||stamp<Date.parse(date+'T15:30:00+09:00'))continue;
  result.push({id:item.id,label:config.label,symbol:config.symbol,date,
    source:'KRX_OFFICIAL',value:row.price,changePercent:null});
 }
 return result;
}
export async function readKrxOfficialClosingStocks(date,{
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 fetchImpl=fetch,now=()=>new Date(),onDiagnostic=()=>{}
}={}){
 const emit=status=>{try{onDiagnostic({kind:'KRX_CLOSE_STOCK_READ',status});}catch{}};
 if(!closingStockSessions(date)||!url||typeof token!=='string'||token.length<12){
  emit('CONFIG_OR_SESSION_UNVERIFIED');return [];
 }
 let endpoint;
 try{endpoint=validateGasEndpoint(url);}catch{emit('ENDPOINT_INVALID');return [];}
 try{
  const response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action:'getKrxOfficialStockCloses',accessToken:token,
    date,codes:'005930,000660'}),redirect:'follow',signal:AbortSignal.timeout(20000)});
  if(!response?.ok){emit('HTTP_UNAVAILABLE');return [];}
  const body=await response.json();
  if(body?.status!=='ok'){
   emit(body?.status==='error'?'GAS_STATUS_ERROR':'GAS_RESPONSE_SCHEMA');return [];
  }
  if(body.requestedDate!==date||!body.closes||typeof body.closes!=='object'
    ||Array.isArray(body.closes)) {emit('PAYLOAD_INVALID');return [];}
  if(!Object.keys(body.closes).length){emit('GAS_EMPTY_ROWS');return [];}
  const rows=normalizeKrxOfficialClosingStocks(date,body,{instant:now()});
  emit(rows.length===2?'BOTH_VERIFIED':rows.length?'PARTIAL':'NO_DATED_OFFICIAL_CLOSE');
  return rows;
 }catch{emit('NETWORK_OR_PARSE_FAILED');return [];}
}
export async function readYahooClosingUsStocks(date,{
 fetchImpl=fetch,now=()=>new Date(),fetchDaily=fetchDatedDaily,onDiagnostic=()=>{}
}={}){
 const session=closingStockSessions(date);
 if(!session)return [];
 const result=await Promise.all(STOCKS.filter(x=>x.market==='US').map(async item=>{
  const config=MORNING_SERIES.find(x=>x.id===item.id);
  if(!config)return null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const row=await fetchDaily(config.label,config.symbol,date,
      {fetchImpl,now:now(),host});
    const candidate={id:item.id,label:config.label,symbol:config.symbol,
      date:row?.date,value:row?.value,changePercent:row?.changePercent,
      source:'YAHOO_DAILY_REFERENCE'};
    if(row?.source==='Yahoo Finance 일봉'&&row.label===config.label
      &&row.symbol===config.symbol&&validClosingStockReference(date,candidate))
      return candidate;
   }catch{}
  }
  return null;
 }));
 const accepted=result.filter(Boolean);
 try{onDiagnostic({kind:'US_STOCK_DAILY_REFERENCE',status:accepted.length===2
  ?'BOTH_VERIFIED':accepted.length?'PARTIAL':'NO_EXACT_COMPLETED_BAR',
  verified:accepted.map(x=>x.id)});}catch{}
 return accepted;
}
// A separate, explicitly NON-OFFICIAL completed Korean daily reference.
// The shared morning Yahoo reader intentionally rejects today's candle;
// this source only accepts a same-day daily row after the KRX close and
// never promotes it to NH_REGULAR_CLOSE or KRX_OFFICIAL.
function isKrDailyReferenceWindow(date,instant){
 if(!Number.isFinite(instant?.getTime?.())||!isOfficialCloseWindow(date,instant))return false;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day!==date
   ||Number(p.hour)*60+Number(p.minute)>=970;
}
export function selectYahooClosingKrDaily(date,item,chart,{now=new Date()}={}){
 const session=closingStockSessions(date);
 if(!session||!['SAMSUNG','SKHYNIX'].includes(item?.id)
   ||!isKrDailyReferenceWindow(date,now))return null;
 const config=MORNING_SERIES.find(x=>x.id===item.id);
 if(!config||chart?.meta?.symbol!==config.symbol
   ||chart?.meta?.exchangeTimezoneName!=='Asia/Seoul'
   ||!Array.isArray(chart.timestamp)||!Array.isArray(chart.indicators?.quote?.[0]?.close)
   ||chart.timestamp.length!==chart.indicators.quote[0].close.length
   ||chart.timestamp.length<1||chart.timestamp.length>30)return null;
 const rows=[],seen=new Set();
 for(let i=0;i<chart.timestamp.length;i++){
  const ts=chart.timestamp[i],value=chart.indicators.quote[0].close[i];
  if(!Number.isSafeInteger(ts)||ts<=0||ts*1000>now.getTime()
    ||!Number.isFinite(value)||value<=0||value>=100000000)continue;
  const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
   year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts*1000));
  if(seen.has(d))return null; // Duplicate day is ambiguous, not a final close.
  seen.add(d);
  rows.push({date:d,value});
 }
 const exact=rows.filter(row=>row.date===date);
 if(exact.length!==1)return null;
 const previous=rows.filter(row=>row.date===session.priorKr);
 const changePercent=previous.length===1
   ?(exact[0].value/previous[0].value-1)*100:null;
 return {id:item.id,label:config.label,symbol:config.symbol,date,
  value:exact[0].value,changePercent,source:'YAHOO_KR_DAILY_REFERENCE'};
}
export async function readYahooClosingKrStocks(date,{
 now=()=>new Date(),fetchImpl=fetch,onDiagnostic=()=>{}
}={}){
 const instant=now();
 // A 16:00-bar might still be settling; never accept an intraday daily candle.
 if(!isKrDailyReferenceWindow(date,instant))return [];
 const result=await Promise.all(STOCKS.filter(x=>x.market==='KR').map(async item=>{
  const config=MORNING_SERIES.find(x=>x.id===item.id);
  if(!config)return null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   const target=new URL('https://'+host+'/v8/finance/chart/'+encodeURIComponent(config.symbol));
   const t=Date.parse(date+'T00:00:00Z');
   target.searchParams.set('period1',String(Math.floor((t-9*86400000)/1000)));
   target.searchParams.set('period2',String(Math.floor((t+86400000)/1000)));
   target.searchParams.set('interval','1d');
   try{
    const response=await fetchImpl(target.href,{headers:{accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response?.ok)continue;
    const size=Number(response.headers?.get?.('content-length')||0);
    if(size>250000)continue;
    const payload=await response.json();
    const results=payload?.chart?.result;
    if(!Array.isArray(results)||results.length!==1)continue;
    const candidate=selectYahooClosingKrDaily(date,item,results[0],{now:instant});
    if(candidate&&validClosingStockReference(date,candidate))return candidate;
   }catch{}
  }
  return null;
 }));
 const accepted=result.filter(Boolean);
 try{onDiagnostic({kind:'KR_YAHOO_DAILY_READ',status:accepted.length===2
  ?'BOTH_VERIFIED':accepted.length?'PARTIAL':'NO_EXACT_COMPLETED_BAR',
  verified:accepted.map(x=>x.id)});}catch{}
 return accepted;
}

export async function readClosingStockSources(date,{
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,
 fetchImpl=fetch,now=()=>new Date(),onDiagnostic=()=>{},
 fetchNh=readNhClosingStocks,fetchKrx=readKrxOfficialClosingStocks,
 fetchKr=readYahooClosingKrStocks,fetchUs=readYahooClosingUsStocks
}={}){
 if(!closingStockSessions(date))return [];
 const options={url,token,fetchImpl,now};
 const attempts=await Promise.allSettled([
  fetchNh(date,{...options,onDiagnostic:details=>{
   try{onDiagnostic({kind:'NH_CLOSE_STOCK_READ',...details});}catch{}}}),
  fetchKrx(date,{...options,onDiagnostic}),
  fetchKr(date,{...options,onDiagnostic}),
  fetchUs(date,{...options,onDiagnostic})
 ]);
 const groups=attempts.map(x=>x.status==='fulfilled'&&Array.isArray(x.value)
   ?x.value.filter(r=>validClosingStockReference(date,r)):[]);
 const byId=new Map();
 // Priority: confirmed NH, official KRX, then clearly labeled dated
 // Yahoo domestic/US references. A Yahoo daily bar is never an official close.
 for(const rows of groups)for(const row of rows)
  if(!byId.has(row.id))byId.set(row.id,row);
 const combined=STOCKS.flatMap(item=>byId.has(item.id)?[byId.get(item.id)]:[]);
 try{onDiagnostic({kind:'CLOSE_STOCK_COVERAGE',status:'CHECKED',
  verified:combined.map(x=>x.id),
  sources:combined.map(x=>({id:x.id,source:x.source}))});}catch{}
 return combined;
}

// Yahoo daily macro snapshots are annotated as prior completed US/FX sessions,
// never as current 17:00 spot/interest-rate quotes. Fail closed on stale dates.
export function validateClosingMacro(date,id,row){
 const definition=MACROS.find(m=>m.id===id);
 const expected=expectedMorningDate(id,date);
 if(!definition||!expected||row?.label!==definition.label||row.symbol!==definition.symbol
   ||row.source!=='Yahoo Finance 일봉'||row.date!==expected
   ||!Number.isFinite(row.value)||row.value<=0
   ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))return null;
 if(id==='UST10Y'&&!(row.value>0&&row.value<20))return null;
 return {id,label:definition.label,symbol:definition.symbol,date:expected,
   value:row.value,changePercent:row.changePercent,source:'YAHOO_DAILY_REFERENCE'};
}
export async function readClosingMacros(date,{fetchImpl=fetch,now=()=>new Date(),
 fetchDaily=fetchDatedDaily}={}){
 if(!closingStockSessions(date))return [];
 const entries=await Promise.all(MACROS.map(async definition=>{
   let result=null;
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
     try{
       const row=await fetchDaily(definition.label,definition.symbol,date,
         {fetchImpl,now:now(),host});
       result=validateClosingMacro(date,definition.id,row);
     }catch{result=null;}
     if(result)break;
   }
   return result;
 }));
 return entries.filter(Boolean);
}
export function formatClosingExtra(date,stocks=[],macros=[],{omitUs10y=false}={}){
 const safeStocks=stocks.filter(x=>validClosingStockReference(date,x));
 const safeMacros=macros.map(x=>validateClosingMacro(date,x?.id,
   x?.source==='YAHOO_DAILY_REFERENCE'?{...x,source:'Yahoo Finance 일봉'}:x)).filter(Boolean);
 const lines=['■ 주요 종목 (국내 당일 / 미국 직전 완료장)'];
 for(const item of STOCKS){
   const rows=safeStocks.filter(x=>x.id===item.id);
   const name=MORNING_SERIES.find(x=>x.id===item.id)?.label||item.id;
   if(rows.length!==1){lines.push(name+': 종가 미확보');continue;}
   const x=rows[0],unit=item.market==='KR'?'원':'USD';
   lines.push(name+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
     +' '+unit+(Number.isFinite(x.changePercent)?' ('+(x.changePercent>=0?'+':'')
     +x.changePercent.toFixed(2)+'%)':'')
     +' ['+x.date+(x.source==='NH_REGULAR_CLOSE'?'':x.source==='KRX_OFFICIAL'?' · KRX 공식 종가':x.source==='YAHOO_KR_DAILY_REFERENCE'?' · Yahoo 국내 일봉 참고 (공식 종가 아님)':' · Yahoo 일봉 참고')+']');
 }
 lines.push('','■ 환율·금리 (직전 완료 일봉, 실시간 아님)');
 for(const item of MACROS){
   if(omitUs10y&&item.id==='UST10Y')continue;
   const rows=safeMacros.filter(x=>x.id===item.id);
   if(rows.length!==1){lines.push(item.label+': 검증된 완료 일봉 미확보');continue;}
   const x=rows[0],unit=item.id==='UST10Y'?'%':item.id==='USDKRW'?' KRW/USD':' index';
   lines.push(item.label+': '+x.value.toLocaleString('en-US',
      {maximumFractionDigits:item.id==='UST10Y'?3:2})+unit
     +(Number.isFinite(x.changePercent)?' ('+(x.changePercent>=0?'+':'')
       +x.changePercent.toFixed(2)+'%)':'')
     +' ['+x.date+' · Yahoo 일봉 참고]');
 }
 return lines.join('\n');
}
export function closingExtraCounts(date,stocks=[],macros=[]){
 const text=formatClosingExtra(date,stocks,macros);
 return {
  stock:STOCKS.filter(item=>!text.includes((MORNING_SERIES.find(x=>x.id===item.id)?.label||item.id)+': 종가 미확보')).length,
  macro:MACROS.filter(item=>!text.includes(item.label+': 검증된 완료 일봉 미확보')).length
 };
}
