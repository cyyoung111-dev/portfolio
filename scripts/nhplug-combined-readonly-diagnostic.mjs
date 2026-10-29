import { pathToFileURL } from 'node:url';
import { issueToken, diagnose } from './nhplug-readonly-diagnostic.mjs';
import { diagnoseClose } from './nhplug-close-readonly-diagnostic.mjs';

// One process, one ephemeral token: no token artifact, cache, sheet, or network writes.
export async function diagnoseCombined({key,secret,request=fetch,log=console.log,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>new Date()}={}) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now()).map(x=>[x.type,x.value]));
  if(Number(p.hour)*60+Number(p.minute)<15*60+30){log('COMBINED NOT_AFTER_REGULAR_CLOSE');return false;}
  let blocked=false;
  const monitored=async (...args)=>{const response=await request(...args);if(response.status===401||response.status===429)blocked=true;return response;};
  const token=await issueToken({key,secret,request:monitored,log});
  if(!token)return false;
  const quotes=await diagnose({key,secret,request:monitored,log,wait,accessToken:token});
  if(blocked){log('COMBINED CLOSE_SKIPPED_AUTH_OR_RATE_LIMIT');return false;}
  const close=await diagnoseClose({key,secret,request:monitored,log,wait,now,accessToken:token});
  log(`COMBINED ${quotes && close ? 'PASS' : 'FAIL'} NIGHT_FUTURE_UNVERIFIED`);
  return quotes && close;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const ok=await diagnoseCombined({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});
  if(!ok)process.exitCode=1;
}
