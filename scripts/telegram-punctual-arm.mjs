// GitHub Actions schedule is best-effort. This worker starts before the target
// minute and holds a runner until the existing morning/closing delivery window.
// It NEVER sends or creates claims; the production prepare/send scripts perform
// date, source, artifact-claim, Telegram API and at-most-once checks.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {krxSessionStatus} from './krx-session-calendar.mjs';

export const ARMED_DELIVERY=Object.freeze({
 morning:Object.freeze({cron:'20 22 * * 0-4',arm:7*60+20,target:7*60+40,cutoff:8*60+10}),
 close:Object.freeze({cron:'35 7 * * 1-5',arm:16*60+35,target:17*60,cutoff:17*60+30})
});
const REPO='cyyoung111-dev/portfolio';
export function armedKstClock(at){
 const d=new Date(at);
 if(!Number.isFinite(d.getTime()))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minutes:Number(p.hour)*60+Number(p.minute)};
}
export function authorizeArmedDelivery(kind,env,event,at){
 const config=ARMED_DELIVERY[kind],clock=armedKstClock(at);
 if(!config||!clock||env?.GITHUB_EVENT_NAME!=='schedule'
  ||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==REPO
  ||env.GITHUB_RUN_ATTEMPT!=='1'
  ||event?.schedule!==config.cron||event?.repository?.full_name!==REPO
  ||krxSessionStatus(clock.date)!=='OPEN')
  return {allowed:false,reason:'ARM_AUTH_OR_SESSION_REJECTED',clock};
 if(clock.minutes<config.arm||clock.minutes>=config.cutoff)
  return {allowed:false,reason:'ARM_OUTSIDE_DELIVERY_DAY_WINDOW',clock};
 return {allowed:true,clock,config};
}
export async function waitUntilPunctualWindow(kind,{now=()=>new Date(),
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 env=process.env,event}={}){
 const first=authorizeArmedDelivery(kind,env,event,now());
 if(!first.allowed)return {ready:false,reason:first.reason,date:first.clock?.date||null};
 // At most 25 minutes (the schedule's early reservation interval). A delayed
 // scheduled job that starts inside the normal send window may attempt once.
 const {date}=first.clock,targetAt=Date.parse(date+'T'+
  (kind==='morning'?'07:40:00':'17:00:00')+'+09:00'),
  cutoffAt=Date.parse(date+'T'+(kind==='morning'?'08:10:00':'17:30:00')+'+09:00');
 let rounds=0;
 while(true){
  const instant=now(),ms=instant.getTime();
  const check=authorizeArmedDelivery(kind,env,event,instant);
  if(!check.allowed||check.clock.date!==date||ms>=cutoffAt)
   return {ready:false,reason:'ARM_WINDOW_EXPIRED',date};
  if(ms>=targetAt)return {ready:true,reason:'ARM_TARGET_REACHED',date};
  // Hard upper bound prevents a mocked or frozen clock spinning indefinitely.
  if(++rounds>360)return {ready:false,reason:'ARM_WAIT_BOUND_EXCEEDED',date};
  await sleep(Math.min(10000,targetAt-ms));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const kind=process.argv[2],event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const r=await waitUntilPunctualWindow(kind,{event});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'ready='+String(r.ready)+'\n');
  console.log(JSON.stringify({status:r.reason,date:r.date,kind,ready:r.ready}));
 }catch{
  console.error('ARM_EXECUTION_FAILED');process.exitCode=1;
 }
}
