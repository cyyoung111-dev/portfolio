#!/usr/bin/env node
// Fail a delayed GitHub schedule BEFORE any protected GAS NAV request.
// A failed stale slot is deliberate: the independent 10:20/20:30 fallback
// must not mistake an unexecuted NAV collector for a successful import.
// No credentials, workbook data, retries or financial writes are involved.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const SLOTS=Object.freeze({
 '30 0 * * 1-5':Object.freeze({name:'WEEKDAY_0930',from:570,through:609,days:[1,2,3,4,5]}),
 '10 0 * * 0,6':Object.freeze({name:'WEEKEND_0910',from:550,through:609,days:[0,6]}),
 '10 9 * * *':Object.freeze({name:'EVENING_1810',from:1090,through:1156,days:[0,1,2,3,4,5,6]}),
 '17 10 * * *':Object.freeze({name:'EVENING_1917',from:1157,through:1219,days:[0,1,2,3,4,5,6]})
});
export function assessNavScheduledAdmission({eventName,cron,now=new Date()}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw Error('NAV_ADMISSION_CLOCK_INVALID');
 if(eventName!=='schedule')return {status:'NON_SCHEDULE_EVENT',admit:true,slot:'NONE'};
 const slot=SLOTS[String(cron||'')];
 if(!slot)return {status:'SCHEDULE_UNRECOGNIZED',admit:false,slot:'UNKNOWN'};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(p=>[p.type,p.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day;
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();
 const minute=Number(parts.hour)*60+Number(parts.minute);
 const admit=slot.days.includes(weekday)&&minute>=slot.from&&minute<=slot.through;
 return {status:admit?'SCHEDULE_ON_TIME':'STALE_OR_WRONG_DAY_SCHEDULE',
  admit,slot:slot.name};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  const result=assessNavScheduledAdmission({
   eventName:process.env.GITHUB_EVENT_NAME,cron:process.env.NAV_SCHEDULE_CRON
  });
  console.log(JSON.stringify({kind:'NAV_SCHEDULE_ADMISSION',...result,
   gasCalls:0,financialWrites:0}));
  if(process.env.GITHUB_STEP_SUMMARY){
   fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    'NAV scheduled admission: '+result.status+' / '+result.slot+
    ' (protected GAS calls 0 during this check)\n');
  }
  // GitHub scheduled-run success is used by the independent fallback as
  // evidence that normal NAV collection ran. Never mark a skipped private
  // collector as a successful scheduled run.
  if(!result.admit)process.exitCode=1;
 }catch(ignore){
  console.error('NAV_SCHEDULE_ADMISSION_UNVERIFIED');
  process.exitCode=1;
 }
}
