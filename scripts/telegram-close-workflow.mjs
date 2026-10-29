import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {fetchDatedDaily,sendTelegram} from './telegram-morning-briefing.mjs';

const REPO='cyyoung111-dev/portfolio';
function previousKrxSession(date){
  const cursor=new Date(date+'T00:00:00Z');
  for(let n=0;n<20;n++){
    cursor.setUTCDate(cursor.getUTCDate()-1);
    const candidate=cursor.toISOString().slice(0,10),status=krxSessionStatus(candidate);
    if(status==='UNKNOWN')return null;
    if(status==='OPEN')return candidate;
  }
  return null;
}
const parts=instant=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
export function closeWindow(instant){
  const p=parts(instant),minute=Number(p.hour)*60+Number(p.minute);
  return {date:`${p.year}-${p.month}-${p.day}`,allowed:minute>=990&&minute<1030};
}
export async function fetchClosingIndex(label,symbol,date,{fetchImpl=fetch,now=new Date()}={}){
  try{
    if(!['^KS11','^KQ11'].includes(symbol)||krxSessionStatus(date)!=='OPEN')return null;
    const base=Date.parse(date+'T00:00:00Z');
    const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol));
    url.searchParams.set('period1',String(base/1000-10*86400));
    url.searchParams.set('period2',String(base/1000+86400));
    url.searchParams.set('interval','1d');
    const response=await fetchImpl(url.toString(),{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)return null;
    const chart=(await response.json())?.chart?.result?.[0];
    if(chart?.meta?.symbol!==symbol||chart.meta.exchangeTimezoneName!=='Asia/Seoul')return null;
    const regular=chart.meta.currentTradingPeriod?.regular,end=Number(regular?.end)*1000;
    if(!Number.isFinite(end)||end>now.getTime()||closeWindow(new Date(end)).date!==date)return null;
    if(!Array.isArray(chart.timestamp)||!Array.isArray(chart.indicators?.quote?.[0]?.close))return null;
    const rows=new Map();
    for(let i=0;i<chart.timestamp.length;i++){
      const instant=Number(chart.timestamp[i])*1000,value=chart.indicators.quote[0].close[i];
      if(!Number.isFinite(instant)||instant>now.getTime()||typeof value!=='number'||!Number.isFinite(value)||value<=0)continue;
      const day=closeWindow(new Date(instant)).date;
      if(day<=date){if(rows.has(day))return null;rows.set(day,value);}
    }
    const current=rows.get(date);if(!current)return null;
    const prior=rows.get(previousKrxSession(date));
    return {label,symbol,date,value:current,changePercent:prior>0?(current/prior-1)*100:null};
  }catch{return null;}
}
export function formatClose(date,rows){
  const lines=[`[${date} 장후 시장 브리핑]`,'Yahoo Finance 일봉 기준 · 지연 및 사후 정정 가능',''];
  for(const [label,symbol] of [['KOSPI','^KS11'],['KOSDAQ','^KQ11'],['S&P 500','^GSPC'],['NASDAQ','^IXIC'],['반도체지수 SOX','^SOX'],['VIX','^VIX']]){
    const row=rows.find(r=>r?.symbol===symbol);
    if(!row){lines.push(label+': 미확보');continue;}
    const change=Number.isFinite(row.changePercent)?` (${row.changePercent>=0?'+':''}${row.changePercent.toFixed(2)}%)`:'';
    lines.push(`${label}: ${row.value.toLocaleString('en-US',{maximumFractionDigits:2})}${change} · ${row.date}`);
  }
  lines.push('','한국은 당일 장 마감값, 미국은 직전 완료 거래일 자료입니다.','NH 포트폴리오 가격·계좌 평가손익 및 KRX 공식 확정자료와는 별도입니다.');
  return lines.join('\n');
}
export async function prepareClose({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,fetchKr=fetchClosingIndex,fetchPrior=fetchDatedDaily}={}){
  if(repository!==REPO||!githubToken||Number(attempt)!==1)throw Error('TELEGRAM_CLOSE_CONFIG');
  const window=closeWindow(now());if(!window.allowed)throw Error('TELEGRAM_CLOSE_LATE');
  const session=krxSessionStatus(window.date);
  if(session==='CLOSED')return {ready:false,status:'MARKET_CLOSED',date:window.date};
  if(session!=='OPEN')throw Error('TELEGRAM_CLOSE_CALENDAR_UNKNOWN');
  const artifactName='telegram-close-claim-'+window.date;
  let response,data;
  try{response=await fetchImpl(`https://api.github.com/repos/${REPO}/actions/artifacts?name=${artifactName}&per_page=100`,{headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('TELEGRAM_CLOSE_CLAIM_FAILED');}
  if(!Number.isSafeInteger(data.total_count)||data.total_count<0||!Array.isArray(data.artifacts)||data.total_count===0&&data.artifacts.length)throw Error('TELEGRAM_CLOSE_CLAIM_SCHEMA');
  if(data.total_count>0){if(!data.artifacts.some(a=>a.name===artifactName))throw Error('TELEGRAM_CLOSE_CLAIM_SCHEMA');return {ready:false,status:'ALREADY_CLAIMED',date:window.date};}
  const args={fetchImpl,now:now()};
  const rows=await Promise.all([
    ...[['KOSPI','^KS11'],['KOSDAQ','^KQ11']].map(([label,symbol])=>fetchKr(label,symbol,window.date,args)),
    ...[['S&P 500','^GSPC'],['NASDAQ','^IXIC'],['반도체지수 SOX','^SOX'],['VIX','^VIX']].map(([label,symbol])=>fetchPrior(label,symbol,window.date,args))
  ]);
  const last=closeWindow(now());if(!last.allowed||last.date!==window.date)throw Error('TELEGRAM_CLOSE_LATE');
  return {ready:true,status:'PREPARED',date:window.date,artifactName,message:formatClose(window.date,rows.filter(Boolean))};
}
export async function deliverClose(payload,{now=()=>new Date(),token,chatId,attempt=1,send=sendTelegram}={}){
  const window=closeWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date||payload?.artifactName!=='telegram-close-claim-'+window.date||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
  await send(token,chatId,payload.message);return {status:'SENT',date:window.date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_EVENT_NAME!=='schedule'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('TELEGRAM_CLOSE_EVENT_INVALID');
    if(process.argv[2]==='prepare'){
      const result=await prepareClose({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
      if(result.ready){fs.mkdirSync('.telegram-close-runtime',{recursive:true});fs.writeFileSync('.telegram-close-runtime/payload.json',JSON.stringify(result));fs.writeFileSync('.telegram-close-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));}
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
      console.log(JSON.stringify({status:result.status,date:result.date}));
    }else if(process.argv[2]==='send'){
      console.log(JSON.stringify(await deliverClose(JSON.parse(fs.readFileSync('.telegram-close-runtime/payload.json','utf8')),{token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,attempt:process.env.GITHUB_RUN_ATTEMPT})));
    }else throw Error('TELEGRAM_CLOSE_MODE_INVALID');
  }catch(e){console.error(/^TELEGRAM_CLOSE_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_CLOSE_FAILED');process.exitCode=1;}
}
