// Audit the last scheduled weekday cutoff, even if GitHub starts after
// midnight or on a weekend. Never send, claim, or change financial data.
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {verifyLateCloseSent} from './telegram-close-late-verdict.mjs';
import {verifyLateScheduledMorningSent} from './telegram-morning-late-sent-readonly.mjs';
const CUTOFF={morning:500,close:1090};
export function deliveryAuditTarget(kind,now=new Date()){
 if(!Object.hasOwn(CUTOFF,kind)||!(now instanceof Date)||!Number.isFinite(now.getTime()))
  throw Error('DELIVERY_AUDIT_CLOCK_INVALID');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now).map(x=>[x.type,x.value]));
 const clock=Number(p.hour)*60+Number(p.minute);
 const today=p.year+'-'+p.month+'-'+p.day;
 const d=new Date(today+'T00:00:00Z');
 if(clock<CUTOFF[kind])d.setUTCDate(d.getUTCDate()-1);
 while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);
 return {date:d.toISOString().slice(0,10),observedKstDate:today};
}
export async function auditScheduledDelivery({kind,now=new Date(),repository,token,fetchImpl=fetch,
 morningReader=verifyLateScheduledMorningSent,closeReader=verifyLateCloseSent}={}){
 const target=deliveryAuditTarget(kind,now),date=target.date;
 const base={...target,kind:'TELEGRAM_DELIVERY_AUDIT_READ_ONLY',delivery:kind,
  verified:false,telegramSends:0,financeWrites:0};
 const session=krxSessionStatus(date);
 if(session==='CLOSED')return {...base,status:'MARKET_CLOSED',verified:true};
 if(session!=='OPEN')return {...base,status:'CALENDAR_UNKNOWN'};
 try{
  const proof=kind==='morning'?await morningReader({date,repository,token,fetchImpl,detailed:true})
   :await closeReader({now:new Date(date+'T18:10:00+09:00'),repository,token,fetchImpl,detailed:true});
  if(proof?.date!==date)return {...base,status:'SENT_PROOF_UNVERIFIED'};
  const verified=kind==='morning'?proof.verifiedSent===true:proof.verified===true;
  const status=verified?'PRIOR_SENT_ARTIFACT_VERIFIED':
   ['NO_CLAIM_OR_SENT','CLAIM_WITHOUT_SENT','SENT_WITHOUT_CLAIM','SENT_PROOF_UNVERIFIED'].includes(proof.status)?proof.status:'SENT_PROOF_UNVERIFIED';
  return {...base,status,verified,...(Number.isSafeInteger(proof.runId)?{
   runId:proof.runId,runUrl:'https://github.com/cyyoung111-dev/portfolio/actions/runs/'+proof.runId
  }:{})};
 }catch{return {...base,status:'SENT_PROOF_UNVERIFIED'};}
}
