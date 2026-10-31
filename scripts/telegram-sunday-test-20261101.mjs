import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {MORNING_SERIES,collectMorningSeries,hasExpectedMorningDate,formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {fetchDatedDaily,loadMorningDomesticDailyIndexes,sendTelegram} from './telegram-morning-briefing.mjs';
import {readNhMorningIndexes} from './nh-morning-index-source.mjs';
import {NH_ONLY_INDEX_SYMBOLS,loadMorningMaster,mergeMorningSourceRows} from './telegram-morning-master.mjs';

export const DATE='2026-11-01';
export const REPO='cyyoung111-dev/portfolio';
const CRONS={
  morning:new Set(['35 22 * * 6','50 22 * * 6','10 23 * * 6','45 23 * * 6']),
  close:new Set(['30 7 * * 0','50 7 * * 0','15 8 * * 0','15 9 * * 0'])
};
function parts(now){
  const xs=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(now);
  const p=Object.fromEntries(xs.map(x=>[x.type,x.value]));
  return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}
export function windowFor(period,instant){
  const p=parts(instant);
  const valid=period==='morning'?p.minute>=450&&p.minute<660:
    period==='close'?p.minute>=990&&p.minute<1200:false;
  return {date:p.date,period,allowed:p.date===DATE&&valid};
}
export function selectPeriod(eventName,event){
  if(eventName==='schedule'){
    const cron=event?.schedule;
    return Object.keys(CRONS).find(name=>CRONS[name].has(cron))||null;
  }
  if(eventName==='workflow_dispatch')
    return ['morning','close'].includes(event?.inputs?.period)?event.inputs.period:null;
  return null;
}
export const claimFor=period=>'telegram-sunday-20261101-'+period+'-claim';

function evidenceRows(date,rows){
  return MORNING_SERIES.flatMap(item=>{
    const accepted=rows.filter(r=>hasExpectedMorningDate(item,date,r));
    return accepted.length===1?[{id:item.id,...accepted[0]}]:[];
  });
}
export function formatClosingTest(rows=[]){
  const entries=evidenceRows(DATE,rows);
  const map=new Map(entries.map(r=>[r.id,r]));
  const label=id=>{
    const config=MORNING_SERIES.find(x=>x.id===id);
    const row=map.get(id);
    if(!row)return config.label+': 확정 출처 미확보';
    const value=row.value.toLocaleString('en-US',{maximumFractionDigits:2});
    const pct=Number.isFinite(row.changePercent)
      ?' ('+(row.changePercent>=0?'+':'')+row.changePercent.toFixed(2)+'%)':'';
    return config.label+': '+value+pct+' ['+row.date+' · '+row.source+']';
  };
  return [
    '[일요일 마감 브리핑 전송 테스트 | '+DATE+']',
    'TEST ONLY · 한국·미국 주식시장 일요일 휴장. 당일 마감/실시간 종가가 아닙니다.',
    '아래 수치는 원천·거래일이 일치한 최근 완료 일봉만 표시하며 새 종가를 생성하지 않습니다.','',
    '■ 국내 시장 — 직전 완료 거래일',
    ...['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX'].map(label),'',
    '■ 미국 시장 — 직전 완료 거래일',
    ...['SPX','DOW','NASDAQ','NDX','SOX','NVDA','MU','VIX'].map(label),'',
    '■ 환율·시장 참고',
    ...['USDKRW','DXY','UST10Y','WTI','GOLD','BTC'].map(label),'',
    '■ 점검: 텔레그램 전송·일자 검증·중복 방지 경로만 확인합니다.',
    'KRX 10/30 가격이력·Snapshot 복구 및 다음 거래일 정규 운영 검증과는 별개입니다.'
  ].join('\n');
}
export async function composeSunday(period,{now=()=>new Date(),fetchImpl=fetch,
    gasUrl=process.env.GAS_WEB_APP_URL,gasToken=process.env.GAS_ACCESS_TOKEN}={}){
  const date=DATE;
  // Existing GAS read-only endpoints only; never issue NH credentials/tokens or write sheets.
  const [master,nh,domestic,external]=await Promise.all([
    loadMorningMaster(date,{url:gasUrl,token:gasToken,fetchImpl,now:now()}).catch(()=>[]),
    readNhMorningIndexes(date,{url:gasUrl,token:gasToken,fetchImpl}).catch(()=>[]),
    loadMorningDomesticDailyIndexes(date,{fetchImpl,now}).catch(()=>[]),
    collectMorningSeries(date,{fetchDaily:fetchDatedDaily,now:now(),fetchImpl,
      skipSymbols:new Set([...NH_ONLY_INDEX_SYMBOLS,'^KS11','^KQ11','^KS200'])}).catch(()=>[])
  ]);
  const rows=mergeMorningSourceRows(external,master,nh,domestic);
  let text=period==='morning'
    ?'[일요일 장전 브리핑 전송 테스트 | '+DATE+']\nTEST ONLY · 일요일 휴장, 당일 거래/장전 신호 아님. 마지막 완료 거래일과 원천만 참고합니다.\n\n'
      +formatFullMorningBriefing(date,null,rows)
    :formatClosingTest(rows);
  if(text.length>4000||!text.startsWith('[일요일 '))throw Error('SUNDAY_TEST_MESSAGE_INVALID');
  return {text,sourceCount:evidenceRows(date,rows).length};
}
export async function prepareSunday({period,now=()=>new Date(),repository,gitToken,
    fetchImpl=fetch,compose=composeSunday}={}){
  if(!windowFor(period,now()).allowed)return {ready:false,status:'OUTSIDE_ONE_DAY_TEST_WINDOW'};
  if(repository!==REPO||!gitToken)throw Error('SUNDAY_TEST_CONFIG_INVALID');
  if(krxSessionStatus(DATE)!=='CLOSED')throw Error('SUNDAY_TEST_CALENDAR_INVALID');
  const claim=claimFor(period);
  let response;
  try{
    response=await fetchImpl('https://api.github.com/repos/'+REPO+
      '/actions/artifacts?name='+claim+'&per_page=100',{
      headers:{authorization:'Bearer '+gitToken,accept:'application/vnd.github+json'},
      redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('FAILED');
  }catch{throw Error('SUNDAY_TEST_CLAIM_LOOKUP_FAILED');}
  let data;
  try{data=await response.json();}catch{throw Error('SUNDAY_TEST_CLAIM_SCHEMA');}
  if(!Number.isSafeInteger(data?.total_count)||data.total_count<0
    ||!Array.isArray(data?.artifacts)||(data.total_count===0&&data.artifacts.length))
    throw Error('SUNDAY_TEST_CLAIM_SCHEMA');
  if(data.total_count>0){
    if(!data.artifacts.some(a=>a.name===claim))throw Error('SUNDAY_TEST_CLAIM_SCHEMA');
    return {ready:false,status:'ALREADY_CLAIMED',period,date:DATE};
  }
  const report=await compose(period,{now,fetchImpl});
  if(!windowFor(period,now()).allowed)throw Error('SUNDAY_TEST_WINDOW_EXPIRED');
  if(!report||typeof report.text!=='string'||report.text.length>4000
    ||!report.text.startsWith('[일요일 '))throw Error('SUNDAY_TEST_MESSAGE_INVALID');
  return {ready:true,status:'PREPARED',period,date:DATE,claim,
    message:report.text,sourceCount:report.sourceCount||0};
}
export async function deliverSunday(payload,{now=()=>new Date(),token,chatId,send=sendTelegram}={}){
  if(!payload||!windowFor(payload.period,now()).allowed||payload.date!==DATE
    ||payload.claim!==claimFor(payload.period)
    ||typeof payload.message!=='string'||!payload.message.startsWith('[일요일 ')
    ||payload.message.length>4000)throw Error('SUNDAY_TEST_SEND_DENIED');
  await send(token,chatId,payload.message);
  return {status:'SENT',testDate:DATE,period:payload.period,sourceCount:payload.sourceCount};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const eventName=process.env.GITHUB_EVENT_NAME;
    if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main'
      ||process.env.GITHUB_RUN_ATTEMPT!=='1'
      ||!['schedule','workflow_dispatch'].includes(eventName))
      throw Error('SUNDAY_TEST_EVENT_DENIED');
    const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const period=selectPeriod(eventName,event);
    if(!period)throw Error('SUNDAY_TEST_PERIOD_DENIED');
    if(process.argv[2]==='prepare'){
      const result=await prepareSunday({period,repository:REPO,gitToken:process.env.GITHUB_TOKEN});
      if(result.ready){
        fs.mkdirSync('.sunday-test-runtime',{recursive:true});
        fs.writeFileSync('.sunday-test-runtime/payload.json',JSON.stringify(result));
        fs.writeFileSync('.sunday-test-runtime/claim.json',
          JSON.stringify({date:DATE,period,runId:process.env.GITHUB_RUN_ID}));
      }
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        'ready='+result.ready+'\nclaim='+ (result.claim||'') +'\n');
      console.log(JSON.stringify({status:result.status,period,date:DATE,sourceCount:result.sourceCount||0}));
    }else if(process.argv[2]==='send'){
      const payload=JSON.parse(fs.readFileSync('.sunday-test-runtime/payload.json','utf8'));
      if(payload.period!==period)throw Error('SUNDAY_TEST_PERIOD_MISMATCH');
      console.log(JSON.stringify(await deliverSunday(payload,{
        token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID})));
    }else throw Error('SUNDAY_TEST_MODE_INVALID');
  }catch(e){console.error(/^SUNDAY_TEST_[A-Z_]+$/.test(e?.message||'')?e.message:'SUNDAY_TEST_FAILED');process.exitCode=1;}
}
