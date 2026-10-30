import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateNhNight} from './nh-night-reference.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

export function captureWindow(now) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`,minute=Number(parts.hour)*60+Number(parts.minute);
  return {date,allowed:minute>=450&&minute<480};
}
export async function captureMorning({now=()=>new Date(),fetchNight=fetchNhNightFromGas}={}) {
  const start=captureWindow(now());
  if(!start.allowed)return {status:'OUTSIDE_CAPTURE_WINDOW',ready:false,date:start.date};
  if(krxSessionStatus(start.date)!=='OPEN')return {status:'MARKET_NOT_OPEN',ready:false,date:start.date};
  const reference=await fetchNight(start.date,{now});
  const end=captureWindow(now());
  if(!end.allowed||end.date!==start.date||!reference)return {status:'REFERENCE_UNAVAILABLE',ready:false,date:start.date};
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
    console.log(JSON.stringify({status:r.status,date:r.date,receivedAt:r.reference?.receivedAt||null}));
  }catch{console.error('NH_CAPTURE_FAILED');process.exitCode=1;}
}
