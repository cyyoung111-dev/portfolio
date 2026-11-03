// External UTC cron only. The Worker is never allowed to send Telegram,
// mint NH tokens, write GAS/Sheets, or provide arbitrary GitHub API routes.
// GitHub's guarded early-arm workflows own the KST/date/claim/SENT contracts.
export const CONFIG=Object.freeze({
  '20 22 * * SUN-THU':Object.freeze({
    workflow:'telegram-morning-punctual-arm.yml',hour:7,minute:20
  }),
  '35 7 * * MON-FRI':Object.freeze({
    workflow:'telegram-close-punctual-arm.yml',hour:16,minute:35
  })
});
const API='https://api.github.com/repos/cyyoung111-dev/portfolio/actions/workflows/';
const UTC_TO_KST=9*60*60*1000;
const GRACE_MS=10*60*1000;

export function authorizeScheduledDispatch(controller,instant){
  const schedule=CONFIG[controller?.cron];
  const time=controller?.scheduledTime;
  const now=instant instanceof Date?instant:new Date(NaN);
  if(!schedule||!Number.isSafeInteger(time)||!Number.isFinite(now.getTime()))
    return {allowed:false,reason:'UNTRUSTED_EVENT'};
  const start=new Date(time),kst=new Date(time+UTC_TO_KST);
  const kstWeekday=kst.getUTCDay();
  const minute=kst.getUTCHours()*60+kst.getUTCMinutes();
  const expected=schedule.hour*60+schedule.minute;
  if(!Number.isFinite(start.getTime())||kstWeekday<1||kstWeekday>5||
    minute!==expected||start.getUTCSeconds()!==0||
    start.getUTCMilliseconds()!==0)
    return {allowed:false,reason:'INVALID_SCHEDULED_CLOCK'};
  const elapsed=now.getTime()-time;
  if(elapsed<0||elapsed>=GRACE_MS)
    return {allowed:false,reason:'EXPIRED_OR_FUTURE_EVENT'};
  const currentKst=new Date(now.getTime()+UTC_TO_KST);
  const sameDay=currentKst.getUTCFullYear()===kst.getUTCFullYear()&&
    currentKst.getUTCMonth()===kst.getUTCMonth()&&
    currentKst.getUTCDate()===kst.getUTCDate();
  if(!sameDay)return {allowed:false,reason:'CROSS_DATE_EVENT'};
  return {allowed:true,workflow:schedule.workflow,
    kstDate:kst.toISOString().slice(0,10)};
}

export async function dispatchProtectedWorkflow(controller,env,{
  now=()=>new Date(),fetchImpl=fetch
}={}){
  const result=authorizeScheduledDispatch(controller,now());
  if(!result.allowed)return {status:'SKIPPED',reason:result.reason};
  // Activation is a separate explicit production step after deployment
  // and synthetic review. Even a working cron remains inert by default.
  if(env?.DISPATCH_ENABLED!=='true')return {status:'DISABLED'};
  const token=env?.GITHUB_DISPATCH_TOKEN;
  if(typeof token!=='string'||token.trim().length<30)
    return {status:'CONFIG_UNVERIFIED'};
  const url=API+result.workflow+'/dispatches';
  try{
    const response=await fetchImpl(url,{
      method:'POST',redirect:'error',
      headers:{
        'Authorization':'Bearer '+token,
        'Accept':'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',
        'Content-Type':'application/json'
      },
      body:JSON.stringify({ref:'main'}),
      signal:AbortSignal.timeout(10000)
    });
    // GitHub currently documents 200 and historically returns 204.
    if(response?.status!==200&&response?.status!==204)
      return {status:'GITHUB_DISPATCH_REJECTED'};
  }catch{
    // Never emit upstream error text: URLs/authorization headers can leak.
    return {status:'GITHUB_NETWORK_UNVERIFIED'};
  }
  return {status:'DISPATCH_ACCEPTED',workflow:result.workflow,date:result.kstDate};
}

export default {
  async scheduled(controller,env){
    const outcome=await dispatchProtectedWorkflow(controller,env);
    // The log is deliberately enum-only; no token, URL, market value or user data.
    console.log(JSON.stringify({component:'EXTERNAL_BRIEFING_DISPATCH',
      status:outcome.status,workflow:outcome.workflow||null,
      reason:outcome.reason||null,date:outcome.date||null}));
    if(!['DISPATCH_ACCEPTED','DISABLED','SKIPPED'].includes(outcome.status))
      throw Error('EXTERNAL_DISPATCH_UNVERIFIED');
  },
  // No public HTTP route may initiate a run.
  fetch(){return new Response('Not found',{status:404});}
};
