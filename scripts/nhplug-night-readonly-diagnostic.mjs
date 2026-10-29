import {pathToFileURL} from 'node:url';
import {issueToken} from './nhplug-readonly-diagnostic.mjs';
import {parsePublicFutureMaster} from './nhplug-public-future-master.mjs';

// MANUAL ONLY: one read-only night futures request. No scheduling, orders,
// GAS, original price/snapshot history or Telegram access. Never print prices,
// raw API responses, request URLs, bearer token, key or secret.
const ROOT='https://api.nhplug.com:8443';
const MASTER='https://www.nhplug.com/instruments/m_future';
const LIMIT=1_000_000;
function kstParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now).map(x=>[x.type,x.value]));
}
function validPrice(value) {
  if(typeof value!=='number' && !(typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value.trim())))return false;
  const n=Number(value);
  return Number.isFinite(n)&&n>0&&Math.abs(n*20-Math.round(n*20))<1e-7;
}
function safeHttp(response) {
  return Number.isInteger(response?.status) && response.status>=100 && response.status<=599 ? response.status : 0;
}
function validDate(text) {
  if(!/^\d{8}$/.test(String(text||'')))return false;
  const value=String(text),date=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  const t=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date;
}
function safeClock(text) {
  if(!/^\d{6}$/.test(String(text||'')))return null;
  const str=String(text),hh=Number(str.slice(0,2)),mm=Number(str.slice(2,4)),ss=Number(str.slice(4,6));
  return hh<24&&mm<60&&ss<60 ? hh*3600+mm*60+ss : null;
}
export function inspectNightTickResult(data, code, targetYYYYMMDD) {
  const header=data?.Output_0;
  if(!header||Array.isArray(header)||typeof header!=='object'||header.iem_cd!==code)
    return {status:'INSTRUMENT_UNVERIFIED'};
  const rows=data?.Output_1;
  if(!Array.isArray(rows))return {status:'TICK_ROWS_UNAVAILABLE'};
  let count=0,latestOffset=-Infinity;
  for(const row of rows) {
    if(!row||row.work_bsop_date!==targetYYYYMMDD||!validDate(row.work_bsop_date))continue;
    const clock=safeClock(row.bsop_time);
    if(clock===null||!(clock<=6*3600||clock>=18*3600)||!validPrice(row.prpr))continue;
    const absolute=clock>=18*3600?clock-86400:clock;
    count++;
    if(absolute>latestOffset)latestOffset=absolute;
  }
  // Existence of a valid trade is NOT proof of official overnight close or
  // that the endpoint returned the final tick; cap count to logging classes.
  const lastFound=count>0;
  // Presence of ticks close to the 06:00 boundary is useful diagnostic evidence,
  // NOT proof that the exchange finalized the contract or that data is complete.
  const nearClose=latestOffset>=5*3600+50*60 && latestOffset<=6*3600;
  const closeWindow=lastFound?(nearClose?'LATE_TICK_PRESENT':'NO_LATE_TICK'):'NO_VALID_TICK';
  const endClock=header.end_time_n;
  const sessionEnd=endClock===undefined||endClock===null||endClock==='' ? 'END_UNVERIFIED'
    : endClock==='060000'?'END_0600':'END_CONFLICT';
  return {
    status:sessionEnd==='END_CONFLICT'?'SESSION_END_CONFLICT'
      :lastFound?'DATED_TICK_REFERENCE_PRESENT':'DATED_TICK_UNVERIFIED',
    countClass:count?count>=20?'20_PLUS':'1_TO_19':'ZERO',
    closeWindow,sessionEnd,
  };
}

async function loadCandidate({request,now,log}) {
  try {
    const head=await request(MASTER+'.h',{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!head.ok)return null;
    const h=await head.text();
    if(h.length>100_000||!/@record\s+30\b/.test(h)||!/char\s+sCode\[9\]/.test(h)||!/char\s+sName\[20\]/.test(h))return null;
    const res=await request(MASTER+'.mst',{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!res.ok||Number(res.headers?.get?.('content-length')||0)>LIMIT)return null;
    const buf=Buffer.from(await res.arrayBuffer());
    const rows=parsePublicFutureMaster(buf).candidates;
    const month=kstParts(now).year+'-'+kstParts(now).month;
    const future=rows.filter(x=>x.contractMonth&&x.contractMonth>=month).sort((a,b)=>a.contractMonth.localeCompare(b.contractMonth));
    if(!future.length)return null;
    const nearest=future[0];
    if(future.filter(x=>x.contractMonth===nearest.contractMonth).length!==1)return null;
    log('NIGHT_CONTRACT PUBLIC_MASTER_NEAREST_MONTH_CANDIDATE_ONLY');
    return nearest;
  }catch{return null;}
}

export async function diagnoseNight({key,secret,request=fetch,log=console.log,now=()=>new Date(),getToken=issueToken}={}) {
  const p=kstParts(now()),minute=Number(p.hour)*60+Number(p.minute);
  // No nighttime intraday data: test only after the 06:00 session close and
  // before the next session. Historical runs cannot prove 06:30 availability.
  if(minute<360||minute>=1080){log('NIGHT_READONLY OUTSIDE_POST_NIGHT_WINDOW');return false;}
  if(!key||!secret){log('NIGHT_AUTH CREDENTIALS_MISSING');return false;}
  const candidate=await loadCandidate({request,now:now(),log});
  if(!candidate){log('NIGHT_CONTRACT MASTER_UNVERIFIED');return false;}
  const today=p.year+p.month+p.day;
  const token=await getToken({key,secret,request,log});
  if(!token)return false;
  let response,data;
  try{
    response=await request(ROOT+'/krfuture/quote/v1/nightPeriod',{
      method:'POST',headers:{
        'content-type':'application/json; charset=UTF-8',
        'x-client-id':key,'x-client-secret':secret,authorization:'Bearer '+token
      },
      body:JSON.stringify({Input_0:{
        iem_cd:candidate.code,mrkt_div_cls_code:'F',gubun:'7',
        out1_scale_change:'0',out2_scale_change:'0',today_cls_code:'0',
        edate:today,array_cnt:'20',xtick:'001'
      }}),
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
    data=await response.json();
  }catch{log('NIGHT_API NETWORK_OR_RESPONSE_ERROR');return false;}
  const status=inspectNightTickResult(data,candidate.code,today);
  log('NIGHT_API HTTP_'+safeHttp(response)+' '+status.status);
  if(status.countClass)log('NIGHT_TICK_COUNT '+status.countClass);
  if(status.closeWindow)log('NIGHT_CLOSE_WINDOW '+status.closeWindow);
  if(status.sessionEnd)log('NIGHT_SESSION_END '+status.sessionEnd);
  // A 200 with validated rows proves only that this read-only path returns
  // at least one correctly dated candidate trade, not the 06:00 last trade.
  const passed=response.ok&&status.status==='DATED_TICK_REFERENCE_PRESENT';
  log('NIGHT_READONLY_PREFLIGHT '+(passed?'PASS_REFERENCE_ONLY':'FAIL')+' OFFICIAL_CLOSE_UNVERIFIED LAST_TRADE_COMPLETENESS_UNVERIFIED');
  return passed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const ok=await diagnoseNight({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});
  if(!ok)process.exitCode=1;
}
