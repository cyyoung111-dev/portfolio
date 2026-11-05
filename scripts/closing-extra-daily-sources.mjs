import {krxSessionStatus} from './krx-session-calendar.mjs';
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
// Fixed public watch list only. These references never enter portfolio holdings,
// price history, financial master or trade accounting.
export function validClosingStockRow(date,row){
 const session=closingStockSessions(date);
 const item=STOCKS.find(x=>x.id===row?.id);
 const config=item&&MORNING_SERIES.find(x=>x.id===item.id);
 const expected=item?.market==='KR'?session?.day:session?.us;
 if(!item||!config||row.label!==config.label||row.symbol!==config.symbol
   ||row.date!==expected||!Number.isFinite(row.value)||row.value<=0
   ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))return false;
 if(row.source==='NH_REGULAR_CLOSE')return true;
 if(item.market==='KR')return row.source==='KRX_OFFICIAL'
    &&row.role==='NON_NH_REFERENCE_ONLY'
    &&['KRX','KRX_OTP'].includes(row.providerSource);
 return row.source==='YAHOO_DAILY_REFERENCE'&&row.role==='NON_NH_REFERENCE_ONLY';
}
export async function readClosingStockReferences(date,{
 fetchImpl=fetch,now=()=>new Date(),gasUrl=process.env.GAS_WEB_APP_URL,
 gasToken=process.env.GAS_ACCESS_TOKEN,fetchDaily=fetchDatedDaily,
 onDiagnostic=()=>{}}={}){
 const session=closingStockSessions(date);
 if(!session)return [];
 const rows=[];
 const domestic=async()=>{
  if(!gasUrl||!gasToken)return;
  let endpoint;
  try{endpoint=validateGasEndpoint(gasUrl);}catch{return;}
  try{
   const form=new URLSearchParams({action:'getKrxOfficialStockCloses',
     accessToken:gasToken,date,codes:'005930,000660'});
   const res=await fetchImpl(endpoint,{method:'POST',
     headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
     body:form,redirect:'follow',signal:AbortSignal.timeout(17000)});
   if(!res?.ok)return;
   const data=await res.json();
   if(data?.status!=='ok'||data.requestedDate!==date||!data.closes
       ||typeof data.closes!=='object'||Array.isArray(data.closes))return;
   for(const item of STOCKS.filter(x=>x.market==='KR')){
    const price=data.closes[item.code],stamp=Date.parse(price?.receivedAt||'');
    const closeTime=Date.parse(date+'T15:30:00+09:00');
    if(price?.code!==item.code||price.requestedDate!==date
      ||price.usedDate!==date||price.source!=='KRX_OFFICIAL'
      ||!['KRX','KRX_OTP'].includes(price.providerSource)
      ||!Number.isFinite(stamp)||stamp<closeTime||stamp>now().getTime()
      ||!Number.isFinite(price.price)||price.price<=0)continue;
    const info=MORNING_SERIES.find(x=>x.id===item.id);
    rows.push({id:item.id,label:info.label,symbol:info.symbol,date,
      value:price.price,changePercent:null,source:'KRX_OFFICIAL',
      role:'NON_NH_REFERENCE_ONLY',providerSource:price.providerSource});
   }
  }catch{/* Unavailable official data stays missing. */}
 };
 const overseas=async item=>{
  const info=MORNING_SERIES.find(x=>x.id===item.id);
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const row=await fetchDaily(info.label,info.symbol,date,{fetchImpl,now:now(),host});
    if(!row||row.label!==info.label||row.symbol!==info.symbol
      ||row.source!=='Yahoo Finance 일봉'||row.date!==session.us
      ||!Number.isFinite(row.value)||row.value<=0
      ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))continue;
    rows.push({id:item.id,label:info.label,symbol:info.symbol,date:session.us,
      value:row.value,changePercent:row.changePercent,source:'YAHOO_DAILY_REFERENCE',
      role:'NON_NH_REFERENCE_ONLY'});
    return;
   }catch{/* Try second public host only. */}
  }
 };
 await Promise.all([domestic(),...STOCKS.filter(x=>x.market==='US').map(overseas)]);
 const result=rows.filter(x=>validClosingStockRow(date,x));
 try{onDiagnostic({kind:'CLOSE_STOCK_REFERENCES',date,verified:result.map(x=>x.id)});}
 catch{/* telemetry optional */}
 return result;
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
 const safeStocks=stocks.filter(x=>{
   const sessions=closingStockSessions(date),target=STOCKS.find(s=>s.id===x?.id);
   const expected=target?.market==='KR'?sessions?.day:sessions?.us;
   return target&&x.source==='NH_REGULAR_CLOSE'&&x.date===expected
     &&x.symbol===MORNING_SERIES.find(m=>m.id===target.id)?.symbol
     &&x.label===MORNING_SERIES.find(m=>m.id===target.id)?.label
     &&Number.isFinite(x.value)&&x.value>0;
 });
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
     +' ['+x.date+']');
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
