import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {sendTelegram} from './telegram-morning-briefing.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchSecondaryIndexes} from './closing-secondary-index-sources.mjs';

const REPO='cyyoung111-dev/portfolio';
const parts=instant=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
export function closeWindow(instant){
  const p=parts(instant),minute=Number(p.hour)*60+Number(p.minute);
  return {date:`${p.year}-${p.month}-${p.day}`,allowed:minute>=990&&minute<1030};
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
export function formatClose(date,rows,secondary=[]){
 const valid=verifiedNhCloseRows(date,rows),count=valid.length;
 const lines=['['+date+' 장후 시장 브리핑]',
  '기준: NH PLUG 완료 정규장 일봉 · KRX/Yahoo는 익거래일 사후 검산만','',
  '■ 국내 시장 (NH 지수 종가 검증 전)'];
 for(const label of NH_UNVERIFIED.slice(0,3))lines.push(label+': NH 지수 종가 코드 미검증');
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
 lines.push('','NH 지수 확인 '+count+'/'+NH_VERIFIED.length+' · 미검증 지수 '+NH_UNVERIFIED.length+'개',
  '당일 국내 종가/포트폴리오 손익은 NH 정규장 원천 연동 전까지 표시하지 않습니다.',
  'NH 기준값은 거래소 공식 정산가를 뜻하지 않으며, 다른 원천 수치로 대체하지 않습니다.');
 return lines.join('\n');
}
export async function prepareClose({now=()=>new Date(),fetchImpl=fetch,githubToken,repository,attempt=1,fetchNh=readNhMorningIndexes,
 gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN,
 fetchSecondary=fetchSecondaryIndexes}={}){
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
  // One central GAS cache-first NH index query. Neither KRX nor Yahoo may
  // supply a number in the actual closing message or block publication.
  const rows=await fetchNh(window.date,{url:gasUrl,token:gasToken,fetchImpl});
  const verified=verifiedNhCloseRows(window.date,rows);
  const last=closeWindow(now());
  if(!last.allowed||last.date!==window.date)throw Error('TELEGRAM_CLOSE_LATE');
  if(!verified.length)return {ready:false,status:'NH_INDEX_CLOSE_NOT_READY',date:window.date};
  // Supplemental providers are nonblocking, even when their adapter fails.
  let secondary=[];
  try {secondary=await fetchSecondary(window.date,{fetchImpl});}
  catch {secondary=[];}
  const after=closeWindow(now());
  if(!after.allowed||after.date!==window.date)throw Error('TELEGRAM_CLOSE_LATE');
  return {ready:true,status:'PREPARED',date:window.date,artifactName,
    nhConfirmed:verified.length,message:formatClose(window.date,verified,secondary)};
}
export async function deliverClose(payload,{now=()=>new Date(),token,chatId,attempt=1,send=sendTelegram}={}){
  const window=closeWindow(now());
  if(Number(attempt)!==1||!window.allowed||payload?.date!==window.date||payload?.artifactName!=='telegram-close-claim-'+window.date||!(Number.isSafeInteger(payload.nhConfirmed)&&payload.nhConfirmed>=1&&payload.nhConfirmed<=3)
  ||typeof payload.message!=='string'||!payload.message.length||payload.message.length>4000)throw Error('TELEGRAM_CLOSE_PAYLOAD_INVALID');
  await send(token,chatId,payload.message);return {status:'SENT',date:window.date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_EVENT_NAME!=='schedule'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('TELEGRAM_CLOSE_EVENT_INVALID');
    if(process.argv[2]==='prepare'){
      const result=await prepareClose({githubToken:process.env.GITHUB_TOKEN,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
      if(result.ready){fs.mkdirSync('.telegram-close-runtime',{recursive:true});fs.writeFileSync('.telegram-close-runtime/payload.json',JSON.stringify(result));fs.writeFileSync('.telegram-close-runtime/claim.json',JSON.stringify({date:result.date,runId:process.env.GITHUB_RUN_ID}));}
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nartifact_name=${result.artifactName||''}\n`);
      console.log(JSON.stringify({status:result.status,date:result.date,nhConfirmed:result.nhConfirmed||0}));
    }else if(process.argv[2]==='send'){
      console.log(JSON.stringify(await deliverClose(JSON.parse(fs.readFileSync('.telegram-close-runtime/payload.json','utf8')),{token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,attempt:process.env.GITHUB_RUN_ATTEMPT})));
    }else throw Error('TELEGRAM_CLOSE_MODE_INVALID');
  }catch(e){console.error(/^TELEGRAM_CLOSE_[A-Z_]+$/.test(e?.message||'')?e.message:'TELEGRAM_CLOSE_FAILED');process.exitCode=1;}
}
