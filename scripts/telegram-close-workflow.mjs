import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {sendTelegram} from './telegram-morning-briefing.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';
import domesticIndexEod from '../src/web/domain/market/domestic_index_eod.js';
import {fetchOfficialDailyIndexes} from './krx-official-daily-index.mjs';
import {fetchShinhanIndexEod} from './shinhan-korean-index-eod.mjs';
import {verifyCrosscheckedYahooIndexes} from './yahoo-shinhan-crosschecked-close.mjs';
import {deliveryTrigger} from './telegram-delivery-trigger.mjs';

const REPO='cyyoung111-dev/portfolio';
const parts=instant=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
export function closeWindow(instant){
  const p=parts(instant),minute=Number(p.hour)*60+Number(p.minute);
  return {date:`${p.year}-${p.month}-${p.day}`,allowed:minute>=990&&minute<1200};
}

const NH_VERIFIED=Object.freeze([
 {label:'S&P 500',symbol:'^GSPC'},
 {label:'NASDAQ',symbol:'^IXIC'},
 {label:'NASDAQ100',symbol:'^NDX'}
]);
const NH_UNVERIFIED=Object.freeze(['KOSPI','KOSDAQ','KOSPI 200','다우존스','SOX','VIX','VKOSPI']);
export function verifiedNhCloseRows(date,rows){
 const expected=expectedMorningDate('SPX',date);
 if(!expected||!Array.isArray(rows)||rows.length>10)return [];
 const accepted=[];
 for(const target of NH_VERIFIED){
  const matches=rows.filter(row=>row?.symbol===target.symbol);
  if(matches.length!==1)continue;
  const row=matches[0];
  if(row.label!==target.label||row.source!=='NH_INDEX_DAILY'
    ||row.date!==expected||!Number.isFinite(row.value)||row.value<=0
    ||(row.changePercent!==null&&!Number.isFinite(row.changePercent)))continue;
  accepted.push({label:target.label,symbol:target.symbol,source:'NH_INDEX_DAILY',
    date:expected,value:row.value,changePercent:row.changePercent});
 }
 return accepted;
}
function previousOpenDate(date){
 const start=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(start))return null;
 for(let n=1;n<=14;n++){
  const candidate=new Date(start-n*86400000).toISOString().slice(0,10);
  const session=krxSessionStatus(candidate);
  if(session==='UNKNOWN')return null;
  if(session==='OPEN')return candidate;
 }
 return null;
}
export async function fetchDomesticCloseIndexes(date,{fetchImpl=fetch,now=()=>new Date(),
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 fetchOfficial=fetchOfficialDailyIndexes,fetchShinhan=fetchShinhanIndexEod}={}){
 const previous=previousOpenDate(date);
 if(!previous||krxSessionStatus(date)!=='OPEN')return [];
 const from=new Date(Date.parse(previous+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);
 // KRX official same-day result takes precedence when GAS confirms actual publication.
 let gasPayload=null;
 const [official,out,shinhan]=await Promise.all([
  Promise.resolve().then(()=>fetchOfficial(date,{url:gasUrl,token:gasToken,fetchImpl,now,
    onResponse:payload=>{gasPayload=payload;}})).catch(()=>[]),
  domesticIndexEod.loadSeries(['KOSPI','KOSDAQ','KOSPI200'],from,date,{fetchImpl,now})
    .catch(()=>({seriesMap:{}})),
  Promise.resolve().then(()=>fetchShinhan(date,{fetchImpl,now})).catch(()=>null)
 ]);
 const crosschecked=verifyCrosscheckedYahooIndexes(date,gasPayload,shinhan,previous,out.seriesMap||{});
 const labels={KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI 200'};
 return Object.keys(labels).flatMap(type=>{
  const verified=Array.isArray(official)?official.filter(r=>r?.type===type&&r.date===date
    &&r.source==='KRX_OFFICIAL'&&r.role==='NON_NH_DAILY_INDEX'
    &&r.priceType==='CONFIRMED_REGULAR_CLOSE'
    &&Number.isFinite(r.value)&&r.value>0):[];
  if(verified.length===1)return verified;
  if(verified.length>1)return [];
  const independent=crosschecked.filter(r=>r.type===type);
  if(independent.length===1)return independent;
  if(independent.length>1)return [];
  const list=out.seriesMap[type]||[],current=list.filter(x=>x.date===date);
  const prior=list.filter(x=>x.date<date).at(-1);
  if(current.length!==1||!prior||prior.date!==previous||current[0].source!=='FDR_KRX_CACHE'
   ||current[0].role!=='NON_NH_DAILY_INDEX'||current[0].priceType!=='PUBLISHED_EOD_REFERENCE')
    return [];
  return [{type,label:labels[type],date,source:'FDR_KRX_CACHE',role:'NON_NH_DAILY_INDEX',
    value:current[0].value,changePercent:(current[0].value/prior.value-1)*100,
    priceType:'PUBLISHED_EOD_REFERENCE'}];
 });
}
// The domestic KRX/FDR EOD reference can independently justify a closing
// briefing. This does not promote it to an NH stock/ETF operating close.
export function verifiedDomesticCloseRows(date,rows){
 if(!Array.isArray(rows)||rows.length>12)return [];
 const valid=[];
 for(const [label,type] of [['KOSPI','KOSPI'],['KOSDAQ','KOSDAQ'],['KOSPI 200','KOSPI200']]){
  const candidates=rows.filter(r=>r?.label===label);
  if(candidates.length!==1)continue;
  const r=candidates[0];
  if(r.type!==type||r.date!==date||r.role!=='NON_NH_DAILY_INDEX'
    ||!Number.isFinite(r.value)||r.value<=0)continue;
  if(r.source==='KRX_OFFICIAL'){
   if(r.priceType!=='CONFIRMED_REGULAR_CLOSE'
     ||r.changePercent!==null&&r.changePercent!==undefined&&!Number.isFinite(r.changePercent))continue;
  }else if(r.source==='FDR_KRX_CACHE'){
   if(r.priceType!=='PUBLISHED_EOD_REFERENCE'||!Number.isFinite(r.changePercent))continue;
  }else if(r.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'){
   if(r.priceType!=='INDEPENDENT_CROSSCHECKED_EOD'
     ||r.comparisonSource!=='SHINHAN_PUBLIC_INDEX'
     ||!Number.isFinite(Date.parse(r.comparisonPublishedAt||''))
     ||r.changePercent!==null&&!Number.isFinite(r.changePercent))continue;
  }else continue;
  valid.push(r);
 }
 return valid;
}
export function formatClose(date,rows,secondary=[],domestic=[]){
 const valid=verifiedNhCloseRows(date,rows),count=valid.length;
 const validDomestic=verifiedDomesticCloseRows(date,domestic);
 const lines=['['+date+' 장후 시장 브리핑]',
  '기준: NH PLUG(지원 지수) · 국내 지수 KRX 공식 우선 / Yahoo·신한 교차검증 / FDR 공개 EOD','',
  '■ 국내 시장 (비NH 공개 일별 종가)'];
 for(const label of NH_UNVERIFIED.slice(0,3)){
  const matches=validDomestic.filter(x=>x.label===label);
  if(matches.length!==1){lines.push(label+': 검증된 당일 종가 미확보');continue;}
  const x=matches[0];
  const change=Number.isFinite(x.changePercent)
    ?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'';
  const provenance=x.source==='KRX_OFFICIAL'?'KRX 공식 종가'
    :x.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'?'Yahoo·신한 일치 참고 종가':'FDR/KRX 공개 참고';
  lines.push(label+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +change+' · '+date+' · '+provenance+' (NH 아님)');
 }
 lines.push('','■ 미국 시장 (직전 완료 거래일)');
 for(const target of NH_VERIFIED){
  const row=valid.find(r=>r.symbol===target.symbol);
  if(!row){lines.push(target.label+': NH 완료 일봉 미확보');continue;}
  const change=Number.isFinite(row.changePercent)
    ?' ('+(row.changePercent>=0?'+':'')+row.changePercent.toFixed(2)+'%)':'';
  lines.push(target.label+': '+row.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +change+' · '+row.date+' · NH');
 }
 lines.push('','■ 비NH 공식 외부 참고 지표');
 for(const label of NH_UNVERIFIED.slice(3)){
  const candidates=secondary.filter(row=>row?.label===label&&row.role==='NON_NH_REFERENCE_ONLY'
    &&row.date===expectedMorningDate('SPX',date)
    &&Number.isFinite(row.value)&&row.value>0
    &&((label==='다우존스'&&row.source==='FRED_DJIA')
      ||(label==='SOX'&&row.source==='FRED_NASDAQSOX')
      ||(label==='VIX'&&row.source==='CBOE_VIX_DAILY')));
  if(candidates.length!==1){lines.push(label+': NH 지수 코드 미검증 · 별도 참고값 미확보');continue;}
  const item=candidates[0];
  lines.push(label+': '+item.value.toLocaleString('en-US',{maximumFractionDigits:2})
    +' · '+item.date+' · '+item.source+' 참고 (NH 아님)');
 }
 lines.push('','NH 지수 확인 '+count+'/'+NH_VERIFIED.length+' · NH 별도 검증 대상 지수 '+NH_UNVERIFIED.length+'개',
  '국내 3대 지수는 KRX 공식 또는 날짜·값이 교차검증된 비NH 공개 참고값입니다.',
  '보유 주식·ETF 종가 및 포트폴리오 손익의 기준은 NH PLUG로 유지합니다.',
  'NH 지수 일봉은 거래소의 별도 정산가격으로 오인하지 않습니다.');
 return lines.join('\n');
}
export async function prepareClose({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,fetchNh=readNhMorningIndexes,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 fetchSecondary=fetchSecondaryIndexes,fetchDomestic=fetchDomesticCloseIndexes}={}){
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
  // US NH indices and Korean KRX/FDR EOD references are independently
  // eligible. A missing NH response must not block verified domestic closes.
  // FRED/CBOE secondary references alone NEVER authorize sending.
  let rows=[],secondary=[],domestic=[];
  await Promise.all([
   (async()=>{try{rows=await fetchNh(window.date,{url:gasUrl,token:gasToken,fetchImpl});}catch{rows=[];}})(),
   (async()=>{try{secondary=await fetchSecondary(window.date,{fetchImpl});}catch{secondary=[];}})(),
   (async()=>{try{domestic=await fetchDomestic(window.date,{fetchImpl,now,gasUrl,gasToken});}catch{domestic=[];}})()
  ]);
  const verified=verifiedNhCloseRows(window.date,rows);
  const domesticVerified=verifiedDomesticCloseRows(window.date,domestic);
  const after=closeWindow(now());
  if(!after.allowed||after.date!==window.date)throw Error('TELEGRAM_CLOSE_LATE');
  if(verified.length+domesticVerified.length===0)
    return {ready:false,status:'NO_VERIFIED_INDEX_CLOSE',date:window.date};
  return {ready:true,status:'PREPARED',date:window.date,artifactName,
    nhConfirmed:verified.length,domesticConfirmed:domesticVerified.length,
    message:formatClose(window.date,verified,secondary,domesticVerified)};
}
export async function deliverClose(payload,{now=()=>new Date(),token,chatId,attempt=1,send=sendTelegram}={}){
  const window=closeWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date||payload?.artifactName!=='telegram-close-claim-'+window.date||!(Number.isSafeInteger(payload.nhConfirmed)&&payload.nhConfirmed>=0&&payload.nhConfirmed<=3)
  ||!(Number.isSafeInteger(payload.domesticConfirmed)&&payload.domesticConfirmed>=0&&payload.domesticConfirmed<=3)
  ||payload.nhConfirmed+payload.domesticConfirmed<1
  ||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
  await send(token,chatId,payload.message);return {status:'SENT',date:window.date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(!deliveryTrigger('close',process.env,JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),closeWindow(new Date()).allowed)){
      if(process.argv[2]==='prepare')fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready=false\n');
      console.log(JSON.stringify({status:'OUTSIDE_DELIVERY_WINDOW'}));
      process.exit(0);
    }
    if(process.argv[2]==='prepare'){
      const result=await prepareClose({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
      if(result.ready){fs.mkdirSync('.telegram-close-runtime',{recursive:true});fs.writeFileSync('.telegram-close-runtime/payload.json',JSON.stringify(result));fs.writeFileSync('.telegram-close-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));}
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
      console.log(JSON.stringify({status:result.status,date:result.date,
        nhConfirmed:result.nhConfirmed||0,domesticConfirmed:result.domesticConfirmed||0}));
    }else if(process.argv[2]==='send'){
      console.log(JSON.stringify(await deliverClose(JSON.parse(fs.readFileSync('.telegram-close-runtime/payload.json','utf8')),{token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,attempt:process.env.GITHUB_RUN_ATTEMPT})));
    }else throw Error('TELEGRAM_CLOSE_MODE_INVALID');
  }catch(e){console.error(/^TELEGRAM_CLOSE_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_CLOSE_FAILED');process.exitCode=1;}
}
