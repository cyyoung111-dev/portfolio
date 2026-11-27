#!/usr/bin/env node
// Fail a delayed GitHub schedule BEFORE any protected GAS NAV request.
// A failed stale slot is deliberate: the independent 10:20/20:30 fallback
// must not mistake an unexecuted NAV collector for a successful import.
// No credentials, workbook data, retries or financial writes are involved.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const SLOTS=Object.freeze({
 '30 0 * * 1-5':Object.freeze({name:'WEEKDAY_0930',from:570,through:609,continuationThrough:730,days:[1,2,3,4,5]}),
 '10 9 * * 1-5':Object.freeze({name:'EVENING_1810',from:1090,through:1156,continuationThrough:1270,days:[1,2,3,4,5]}),
 '17 10 * * 1-5':Object.freeze({name:'EVENING_1917',from:1157,through:1219,continuationThrough:1270,days:[1,2,3,4,5]})
});
function kstClock(now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(p=>[p.type,p.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day;
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();
 const minute=Number(parts.hour)*60+Number(parts.minute);
 return {date,weekday,minute};
}
// The second private collector belongs to the same serial workflow. An
// admitted KB job can run beyond its original START slot. Only its actual
// same-run start timestamp may authorize a bounded continuation, never a
// new stale scheduled start. Existing independent morning/evening recovery
// cutoffs (12:10 / 21:10 KST) and all GAS writer/lease checks remain binding.
export function assessNavScheduledAdmission({eventName,cron,now=new Date(),priorAdmittedAt}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw Error('NAV_ADMISSION_CLOCK_INVALID');
 if(eventName!=='schedule')return {status:'NON_SCHEDULE_EVENT',admit:true,slot:'NONE'};
 const slot=SLOTS[String(cron||'')];
 if(!slot)return {status:'SCHEDULE_UNRECOGNIZED',admit:false,slot:'UNKNOWN'};
 const {date,weekday,minute}=kstClock(now);
 const admit=slot.days.includes(weekday)&&minute>=slot.from&&minute<=slot.through;
 if(!admit&&typeof priorAdmittedAt==='string'&&priorAdmittedAt){
  const previous=new Date(priorAdmittedAt);
  const elapsed=now.getTime()-previous.getTime();
  if(Number.isFinite(previous.getTime())&&previous.toISOString()===priorAdmittedAt
    &&elapsed>=0&&elapsed<=120*60000){
   const first=kstClock(previous);
   if(first.date===date&&slot.days.includes(weekday)
     &&first.minute>=slot.from&&first.minute<=slot.through
     &&minute>=slot.from&&minute<=slot.continuationThrough)
    return {status:'ADMITTED_SAME_RUN_CONTINUATION',admit:true,slot:slot.name};
  }
 }
 return {status:admit?'SCHEDULE_ON_TIME':'STALE_OR_WRONG_DAY_SCHEDULE',
  admit,slot:slot.name};
}
// Main pushes are compatibility checks, not an instruction to request
// public fund prices on a weekend. Manual dispatch remains explicit.
export function assessNavPublicAdmission({eventName,cron,now=new Date()}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('NAV_ADMISSION_CLOCK_INVALID');
 if(eventName==='push'&&[0,6].includes(kstClock(now).weekday))
  return {status:'WEEKEND_PUSH_SOURCE_NOT_EXPECTED',admit:false,slot:'NONE'};
 return assessNavScheduledAdmission({eventName,cron,now});
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  const now=new Date();
  const result=assessNavScheduledAdmission({
   eventName:process.env.GITHUB_EVENT_NAME,cron:process.env.NAV_SCHEDULE_CRON,
   now,priorAdmittedAt:process.env.NAV_PRIOR_ADMITTED_AT
  });
  console.log(JSON.stringify({kind:'NAV_SCHEDULE_ADMISSION',...result,
   gasCalls:0,financialWrites:0}));
  if(process.env.GITHUB_STEP_SUMMARY){
   fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    'NAV scheduled admission: '+result.status+' / '+result.slot+
    ' (protected GAS calls 0 during this check)\n');
  }
  // A same-run success output distinguishes an admitted collector (whose
  // writer/ACK may later fail) from a runner that never entered private GAS.
  // Postflight must not independently enter GAS after both admissions deny.
  if(process.env.GITHUB_OUTPUT)
   fs.appendFileSync(process.env.GITHUB_OUTPUT,
    'admitted='+String(result.admit)+'\n'+
    'admitted_at='+(result.admit?now.toISOString():'')+'\n');
  // GitHub scheduled-run success is used by the independent fallback as
  // evidence that normal NAV collection ran. Never mark a skipped private
  // collector as a successful scheduled run.
  if(!result.admit)process.exitCode=1;
 }catch(ignore){
  console.error('NAV_SCHEDULE_ADMISSION_UNVERIFIED');
  process.exitCode=1;
 }
}
