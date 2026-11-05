import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateNhNight} from './nh-night-reference.mjs';
import {fetchNhNightFromGas,callNhGasProxy} from './nh-gas-proxy.mjs';

// Status-only diagnosis: no new OAuth, no bearer returned or logged.
export async function nightAuthStatus({request=fetch,url=process.env.GAS_WEB_APP_URL,
 token=process.env.GAS_ACCESS_TOKEN}={}){
 try{
  const state=await callNhGasProxy('getNhAuthStatusProxy',{request,url,token});
  return state?.enabled===true&&state.tokenIssued===false
   ?state.tokenCached===true?'TOKEN_CACHED':'TOKEN_NOT_CACHED'
   :'AUTH_STATUS_UNVERIFIED';
 }catch{return 'AUTH_STATUS_UNAVAILABLE';}
}
import {krxSessionStatus} from './krx-session-calendar.mjs';

export function captureWindow(now) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`,minute=Number(parts.hour)*60+Number(parts.minute);
  return {date,allowed:minute>=450&&minute<480};
}
export async function captureMorning({now=()=>new Date(),fetchNight=fetchNhNightFromGas,
 readAuthStatus=nightAuthStatus}={}) {
  const start=captureWindow(now());
  if(!start.allowed)return {status:'OUTSIDE_CAPTURE_WINDOW',ready:false,date:start.date};
  if(krxSessionStatus(start.date)!=='OPEN')return {status:'MARKET_NOT_OPEN',ready:false,date:start.date};
  let reason='NH_NIGHT_REFERENCE_UNAVAILABLE';
  const reference=await fetchNight(start.date,{now,onError:code=>{
    if(/^NH_(?:NIGHT|PROXY)_[A-Z0-9_]{1,70}$/.test(code))reason=code;
  }});
  const end=captureWindow(now());
  if(!end.allowed||end.date!==start.date||!reference){
    // A missing reference has multiple causes: token, session date, absent
    // 06:00 trade, contract, or network. Status-only read distinguishes one.
    const auth=end.allowed&&end.date===start.date
      ?await readAuthStatus().catch(()=> 'AUTH_STATUS_UNAVAILABLE')
      :'AUTH_STATUS_NOT_QUERIED';
    return {status:'REFERENCE_UNAVAILABLE',ready:false,date:start.date,reason,
      authStatus:['TOKEN_CACHED','TOKEN_NOT_CACHED','AUTH_STATUS_UNVERIFIED',
        'AUTH_STATUS_UNAVAILABLE','AUTH_STATUS_NOT_QUERIED'].includes(auth)
        ?auth:'AUTH_STATUS_UNVERIFIED'};
  }
  const received=Date.parse(reference.receivedAt), upper=Date.parse(`${start.date}T08:00:00+09:00`), lower=Date.parse(`${start.date}T07:30:00+09:00`);
  if(reference.source!=='NH'||reference.tradingDate!==start.date||reference.officialClose!==false||reference.sourceUpdatedAt!==`${start.date}T06:00:00+09:00`||!Number.isFinite(received)||received<lower||received>=upper||received>now().getTime()||!validateNhNight({date:start.date,clock:'06:00:00',value:reference.value,contract:reference.contract,contractMonth:reference.contractMonth},start.date,reference.receivedAt))return {status:'REFERENCE_INVALID',ready:false,date:start.date};
  return {status:'CAPTURED',ready:true,date:start.date,reference};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_EVENT_NAME!=='schedule'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('CAPTURE_EVENT_INVALID');
    const r=await captureMorning();
    if(r.ready){fs.mkdirSync('.nh-night-runtime',{recursive:true});fs.writeFileSync('.nh-night-runtime/reference.json',JSON.stringify(r.reference));}
    fs.appendFileSync(process.env.GITHUB_OUTPUT,`ready=${r.ready}\ndate=${r.date}\n`);
    console.log(JSON.stringify({status:r.status,date:r.date,reason:r.reason||null,authStatus:r.authStatus||null,receivedAt:r.reference?.receivedAt||null}));
  }catch{console.error('NH_CAPTURE_FAILED');process.exitCode=1;}
}
