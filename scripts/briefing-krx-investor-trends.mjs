// Optional KRX-trading investor flow reference from Naver public statistics.
// NOT a KRX official OpenAPI response and never a same-day confirmed close.
// A failed/changed public endpoint must omit the row rather than invent figures.
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

const HOST='https://stock.naver.com';
const CODES=Object.freeze(['1000','2000','3000','3100','4000','5000','6000',
 '7000','7100','8000','9000','9001']);
const INST=Object.freeze(['1000','2000','3000','3100','4000','5000','6000','7000']);
const FOREIGN=Object.freeze(['9000','9001']);
const MARKETS=Object.freeze(['KOSPI','KOSDAQ','ALL']);
const krDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&!Number.isNaN(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const amount=value=>{
 if(typeof value!=='string'||! /^-?(?:0|[1-9]\d*)(?:,\d{3})*(?:\.\d+)?$/.test(value.trim()))
  return null;
 const n=Number(value.replaceAll(',',''));
 return Number.isFinite(n)&&Math.abs(n)<1e16?n:null;
};
const kst=d=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).formatToParts(d).map(x=>[x.type,x.value]));
export function verifyInvestorTrendMarket(date,market,json){
 if(!krDay(date)||!MARKETS.includes(market)||!json
   ||!Array.isArray(json.content)||json.content.length>40)return null;
 const observed=json.content.filter(x=>x?.bizdate===date.replaceAll('-',''));
 if(observed.length!==1||observed[0].time!==''||
   !Array.isArray(observed[0].netAmounts)
   ||observed[0].netAmounts.length!==CODES.length)return null;
 const amounts={};
 for(const entry of observed[0].netAmounts){
  const code=entry?.investorGubun;
  if(!CODES.includes(code)||Object.hasOwn(amounts,code))return null;
  const sell=amount(entry.sellPrice),buy=amount(entry.buyPrice),
    diff=amount(entry.diffValue);
  if(sell===null||buy===null||diff===null||sell<0||buy<0
    ||Math.abs((buy-sell)-diff)>Math.max(3,Math.abs(diff)*1e-6))return null;
  amounts[code]=diff;
 }
 if(Object.keys(amounts).length!==CODES.length)return null;
 const total=CODES.reduce((s,c)=>s+amounts[c],0);
 const gross=CODES.reduce((s,c)=>s+Math.abs(amounts[c]),0);
 if(gross<100000000||Math.abs(total)>Math.max(10000000,gross*0.0001))
  return null;
 const sum=codes=>codes.reduce((s,c)=>s+amounts[c],0);
 return {market,date,foreignKrw:sum(FOREIGN),institutionKrw:sum(INST),
  retailKrw:amounts['8000'],otherKrw:amounts['7100'],amounts,
  source:'NAVER_KRX_INVESTOR_REFERENCE'};
}
export function verifyInvestorTrendCrossMarket(date,values){
 if(!krDay(date)||!Array.isArray(values)||values.length!==3)return null;
 const parsed=Object.fromEntries(values.map(x=>[x?.market,x]));
 if(Object.keys(parsed).length!==3||!MARKETS.every(m=>parsed[m]
  &&parsed[m].date===date&&parsed[m].source==='NAVER_KRX_INVESTOR_REFERENCE'))
   return null;
 for(const code of CODES){
  const total=parsed.ALL.amounts?.[code],parts=(parsed.KOSPI.amounts?.[code]||0)
    +(parsed.KOSDAQ.amounts?.[code]||0);
  if(!Number.isFinite(total)||!Number.isFinite(parts)
   ||Math.abs(total-parts)>Math.max(5000000,Math.abs(total)*0.0001))return null;
 }
 return {date,source:'NAVER_KRX_INVESTOR_REFERENCE',
  markets:[parsed.KOSPI,parsed.KOSDAQ],all:parsed.ALL};
}
export async function readInvestorTrends(date,{mode='morning',now=()=>new Date(),
 fetchImpl=fetch}={}){
 if(!krDay(date)||!['morning','close'].includes(mode)
  ||typeof fetchImpl!=='function'||krxSessionStatus(date)!=='OPEN')return null;
 const clock=now();
 if(!(clock instanceof Date)||!Number.isFinite(clock.getTime()))return null;
 const t=kst(clock),current=t.year+'-'+t.month+'-'+t.day;
 if(current!==date)return null;
 const minute=Number(t.hour)*60+Number(t.minute);
 if(mode==='morning'&&(minute<390||minute>=520))return null;
 if(mode==='close'&&(minute<990||minute>=1080))return null;
 const expected=mode==='morning'?expectedMorningDate('KOSPI',date):date;
 if(!expected||krxSessionStatus(expected)!=='OPEN')return null;
 const fetched=await Promise.all(MARKETS.map(async market=>{
  const url=new URL('/api/domestic/market/trend/daily',HOST);
  const params={tradeType:'KRX',marketType:market,
   bizdate:expected.replaceAll('-',''),startIdx:'0',pageSize:'20'};
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  try{
   const res=await fetchImpl(url.href,{method:'GET',redirect:'error',
    headers:{accept:'application/json',referer:HOST+'/'},
    signal:AbortSignal.timeout(4500)});
   if(!res?.ok||!String(res.headers?.get?.('content-type')||'')
     .toLowerCase().includes('json'))return null;
   const size=Number(res.headers?.get?.('content-length'));
   if(Number.isFinite(size)&&size>600000)return null;
   return verifyInvestorTrendMarket(expected,market,await res.json());
  }catch{return null;}
 }));
 if(fetched.some(x=>!x))return null;
 const verified=verifyInvestorTrendCrossMarket(expected,fetched);
 return verified?{...verified,mode,provisional:mode==='close'}:null;
}
export function formatInvestorTrends(result){
 if(!result||result.source!=='NAVER_KRX_INVESTOR_REFERENCE'
  ||!krDay(result.date)||!['morning','close'].includes(result.mode)
  ||!Array.isArray(result.markets)||result.markets.length!==2
  ||!verifyInvestorTrendCrossMarket(result.date,[...result.markets,result.all]))return '';
 const [kospi,kosdaq]=result.markets;
 if(kospi.market!=='KOSPI'||kosdaq.market!=='KOSDAQ'
  ||kospi.date!==result.date||kosdaq.date!==result.date
  ||![kospi.foreignKrw,kospi.institutionKrw,
    kosdaq.foreignKrw,kosdaq.institutionKrw].every(Number.isFinite))
   return '';
 for(const market of [kospi,kosdaq]){
  const sum=codes=>codes.reduce((acc,code)=>acc+(market.amounts?.[code]||0),0);
  if(sum(FOREIGN)!==market.foreignKrw
    ||sum(INST)!==market.institutionKrw)return '';
 }
 const fmt=n=>(n>=0?'+':'−')+Math.round(Math.abs(n)/1e8).toLocaleString('en-US')+'억';
 return '시장 수급 ['+result.date.slice(5)+' · KRX 거래 · 네이버 참고'
  +(result.provisional?' 잠정':'')+'] '
  +'KOSPI 외 '+fmt(kospi.foreignKrw)+'/기관 '+fmt(kospi.institutionKrw)
  +' · KOSDAQ 외 '+fmt(kosdaq.foreignKrw)+'/기관 '+fmt(kosdaq.institutionKrw);
}
