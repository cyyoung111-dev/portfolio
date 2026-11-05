// Existing published GAS v9.281 already supports getNhNightProxy from
// 07:30-07:59 KST. Take one earlier opportunity to preserve its verified
// 06:00 tick when the GitHub early-arm runner arrives on time.
// Failure remains a non-blocking absence: normal 07:40 recovery is retained.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {armedKstClock,authorizeArmedDelivery} from './telegram-punctual-arm.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {validateNhNight} from './nh-night-reference.mjs';
import {nightAuthStatus} from './nh-morning-capture.mjs';

export const PREFETCH_PATH='.telegram-runtime/nh-night-prefetch.json';
const HOUR=60*60000;
export function prefetchAdmission({now=new Date(),env,event}={}){
 const check=authorizeArmedDelivery('morning',env,event,now);
 const clock=armedKstClock(now);
 if(!check.allowed||!clock)return {allowed:false,reason:'PREFETCH_AUTH_OR_SESSION_REJECTED'};
 // Never delay an already-late dispatch: at/after 07:37 use existing
 // 07:40 single-shot recovery only.
 if(clock.minutes>=7*60+37||clock.minutes<7*60+20)
  return {allowed:false,reason:'PREFETCH_TOO_LATE_OR_EARLY'};
 return {allowed:true,date:clock.date};
}
export function loadPrefetchedNight(date,{path=PREFETCH_PATH,now=()=>new Date(),
  readFile=fs.readFileSync}={}){
 try{
  const at=now(),clock=armedKstClock(at);
  if(clock?.date!==date||clock.minutes<7*60+40||clock.minutes>=8*60)return null;
  const raw=readFile(path,'utf8');
  if(typeof raw!=='string'||raw.length>1600)return null;
  const ref=JSON.parse(raw);
  if(!ref||Array.isArray(ref)||Object.keys(ref).sort().join(',')!==
    'clock,contract,contractMonth,kind,officialClose,receivedAt,source,sourceUpdatedAt,tradingDate,value')
    return null;
  if(ref.source!=='NH'||ref.kind!=='REFERENCE'||ref.tradingDate!==date
    ||ref.clock!=='06:00:00'||ref.officialClose!==false
    ||ref.sourceUpdatedAt!==date+'T06:00:00+09:00')return null;
  const received=Date.parse(ref.receivedAt);
  if(!Number.isFinite(received)||received<Date.parse(date+'T07:30:00+09:00')
    ||received>Date.parse(date+'T07:40:00+09:00')
    ||received>at.getTime()+2000)return null;
  return validateNhNight({date,clock:ref.clock,contract:ref.contract,
    contractMonth:ref.contractMonth,value:ref.value},date,ref.receivedAt);
 }catch{return null;}
}
export async function collectMorningPrefetch({now=()=>new Date(),
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 env=process.env,event,requestNight=fetchNhNightFromGas,
 readAuthStatus=nightAuthStatus,writeFile=fs.writeFileSync,mkdir=fs.mkdirSync,path=PREFETCH_PATH
}={}){
 const admissible=prefetchAdmission({now:now(),env,event});
 if(!admissible.allowed)return {status:admissible.reason};
 const date=admissible.date;
 // The call must start strictly inside the published GAS 07:30-08:00
 // window, with a >3-minute reserve before the 07:40 send.
 const warmAt=Date.parse(date+'T07:30:15+09:00');
 const lateAt=Date.parse(date+'T07:37:00+09:00');
 let loops=0;
 while(now().getTime()<warmAt){
  if(++loops>85)return {status:'PREFETCH_CLOCK_UNVERIFIED'};
  const remaining=warmAt-now().getTime();
  await sleep(Math.min(10000,remaining));
 }
 const at=now();
 if(at.getTime()>=lateAt||at.getTime()<warmAt
   ||!prefetchAdmission({now:at,env,event}).allowed)
   return {status:'PREFETCH_WINDOW_MISSED'};
 const reasons=[];
 let ref=null;
 try{ref=await requestNight(date,{now,url:env.GAS_WEB_APP_URL,
  token:env.GAS_ACCESS_TOKEN,onError:reason=>{
    if(/^NH_(?:NIGHT|PROXY)_[A-Z0-9_]{1,70}$/.test(String(reason)))reasons.push(reason);
  }});
 }catch{reasons.push('NH_NIGHT_SOURCE_UNAVAILABLE');}
 if(!ref){
  // A separate status-only GAS read reports whether the central NH bearer is
  // cached. No new NH OAuth, no price and no server error payload is logged.
  let authStatus='AUTH_STATUS_UNAVAILABLE';
  try{
   const reply=await readAuthStatus({url:env.GAS_WEB_APP_URL,token:env.GAS_ACCESS_TOKEN});
   if(['TOKEN_CACHED','TOKEN_NOT_CACHED','AUTH_STATUS_UNVERIFIED',
        'AUTH_STATUS_UNAVAILABLE'].includes(reply))authStatus=reply;
  }catch{}
  return {status:'PREFETCH_NOT_VERIFIED',
    reason:reasons[0]||'NH_NIGHT_SOURCE_UNAVAILABLE',authStatus};
 }
 // Never persist a future/old/day-mismatched or pre-07:30 reference.
 const received=Date.parse(ref.receivedAt);
 if(ref.tradingDate!==date||ref.source!=='NH'
  ||ref.sourceUpdatedAt!==date+'T06:00:00+09:00'
  ||!Number.isFinite(received)||received<warmAt-15000
  ||received>Date.parse(date+'T07:40:00+09:00')
  ||received>now().getTime()+2000)return {status:'PREFETCH_NOT_VERIFIED',reason:'NH_NIGHT_REFERENCE_INVALID'};
 try{
  mkdir('.telegram-runtime',{recursive:true});
  writeFile(path,JSON.stringify(ref),{mode:0o600,flag:'wx'});
  return {status:'PREFETCH_VERIFIED',date};
 }catch{return {status:'PREFETCH_FILE_UNVERIFIED'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const r=await collectMorningPrefetch({event});
  console.log(JSON.stringify({kind:'NH_MORNING_PREFETCH',status:r.status,
   reason:r.reason||null,authStatus:r.authStatus||null,date:r.date||null}));
 }catch{console.log(JSON.stringify({kind:'NH_MORNING_PREFETCH',status:'PREFETCH_EXECUTION_UNVERIFIED'}));}
}
