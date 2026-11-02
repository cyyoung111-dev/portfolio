import {krxSessionStatus} from './krx-session-calendar.mjs';

// Pure simulation: no GitHub Actions dispatch, artifact upload, GAS, NH request
// or Telegram send. Changing this module never changes production schedules.
export const BRIEFING_WINDOWS=Object.freeze({
  MORNING:Object.freeze({target:'07:40',fallback:'07:49',end:'08:10'}),
  CLOSE:Object.freeze({target:'17:00',fallback:'17:08',end:'20:00'}),
});
const clock=/^([01]\d|2[0-3]):([0-5]\d)$/;
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
function validDay(day) {
  return typeof day==='string'&&isoDate.test(day)
    &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
    &&new Date(Date.parse(day+'T00:00:00Z')).toISOString().slice(0,10)===day;
}
function kstParts(value) {
  const stamp=value instanceof Date ? value : new Date(value);
  if(!Number.isFinite(stamp.getTime()))return null;
  const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(stamp).map(x=>[x.type,x.value]));
  return {date:fields.year+'-'+fields.month+'-'+fields.day,
    seconds:Number(fields.hour)*3600+Number(fields.minute)*60+Number(fields.second)};
}
function minuteOf(clockValue) {
  const match=clock.exec(clockValue);
  if(!match)throw Error('BRIEFING_CLOCK_INVALID');
  return Number(match[1])*60+Number(match[2]);
}
export function kstWeekdayCron(time) {
  const minute=minuteOf(time);
  const utc=(minute-540+1440)%1440;
  const weekdays=minute<540?'0-4':'1-5'; // prior UTC calendar day if before 09:00 KST
  return (utc%60)+' '+Math.floor(utc/60)+' * * '+weekdays;
}
export function proposedBriefingCrons() {
  return Object.fromEntries(Object.entries(BRIEFING_WINDOWS).map(([name,window])=>[
    name,Object.freeze({target:kstWeekdayCron(window.target),fallback:kstWeekdayCron(window.fallback)})
  ]));
}
export function deliveryClaimKey(kind,tradingDate) {
  if(!Object.hasOwn(BRIEFING_WINDOWS,kind)||!validDay(tradingDate))throw Error('BRIEFING_CLAIM_INPUT_INVALID');
  return 'telegram-'+(kind==='MORNING'?'morning':'close')+'-claim-'+tradingDate;
}
export function planBriefingAttempt({kind,now,claimState='UNKNOWN',payloadState='UNKNOWN',
  lockHeld=false,attempt=1}={}) {
  if(!Object.hasOwn(BRIEFING_WINDOWS,kind))return Object.freeze({status:'KIND_INVALID'});
  const parts=kstParts(now);
  if(!parts||!validDay(parts.date))return Object.freeze({status:'TIME_INVALID'});
  const date=parts.date;
  const base=Object.freeze({kind,date,claimKey:deliveryClaimKey(kind,date)});
  if(attempt!==1)return {...base,status:'ACTION_RERUN_BLOCKED'};
  const session=krxSessionStatus(date);
  if(session==='CLOSED')return {...base,status:'MARKET_CLOSED'};
  if(session!=='OPEN')return {...base,status:'CALENDAR_UNVERIFIED'};
  const window=BRIEFING_WINDOWS[kind];
  if(parts.seconds<minuteOf(window.target)*60)return {...base,status:'TOO_EARLY'};
  if(parts.seconds>=minuteOf(window.end)*60)return {...base,status:'TOO_LATE'};
  // GitHub concurrency must serialize *every* run of a briefing kind,
  // including the fallback. Artifact lookup/upload alone is not atomic.
  if(lockHeld!==true)return {...base,status:'NO_EXCLUSIVE_DELIVERY_OWNER'};
  if(claimState==='CLAIMED')return {...base,status:'ALREADY_CLAIMED'};
  if(claimState!=='ABSENT')return {...base,status:'CLAIM_STATUS_UNVERIFIED'};
  if(payloadState!=='VALID')return {...base,status:'PAYLOAD_NOT_READY'};
  return {...base,status:'READY_TO_CLAIM'};
}

// Simulated state transition, intentionally independent of any real storage.
// A claimed date never retries a Telegram timeout: at-most-once > lost-send recovery.
export function simulateBriefingAttempt({kind,now,state={claims:{}},payloadState='VALID',
  lockHeld=true,attempt=1,claimResult='CONFIRMED',sendResult='SUCCESS'}={}) {
  const original=state?.claims;
  if(!original||typeof original!=='object'||Array.isArray(original))
    return {status:'SIMULATOR_STATE_INVALID',state,sendCalls:0};
  const claims={...original};
  const stamp=kstParts(now);
  const id=stamp&&validDay(stamp.date)&&Object.hasOwn(BRIEFING_WINDOWS,kind)
    ?deliveryClaimKey(kind,stamp.date):null;
  const claimState=id && Object.hasOwn(claims,id)
    ?claims[id]==='CONFIRMED'?'CLAIMED':'UNKNOWN':'ABSENT';
  const plan=planBriefingAttempt({kind,now,claimState,payloadState,lockHeld,attempt});
  if(plan.status!=='READY_TO_CLAIM')return {status:plan.status,state:{claims},sendCalls:0,plan};
  if(claimResult!=='CONFIRMED') {
    // ACK lost or unknown GitHub artifact state: never auto resend.
    claims[id]='UNKNOWN';
    return {status:'CLAIM_UNCONFIRMED_NO_SEND',state:{claims},sendCalls:0,plan};
  }
  claims[id]='CONFIRMED'; // durable claim simulated before *any* send.
  if(sendResult==='SUCCESS')return {status:'SENT',state:{claims},sendCalls:1,plan};
  return {status:'SEND_UNCONFIRMED_NO_AUTO_RETRY',state:{claims},sendCalls:1,plan};
}
