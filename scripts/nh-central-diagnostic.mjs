import {pathToFileURL} from 'node:url';
import {callNhGasProxy,fetchNhNightFromGas} from './nh-gas-proxy.mjs';

// This CLI never requests NH OAuth tokens; only the GAS backend holds them.
export function isSupportedNhCentralStatus(response) {
  const version = /^9\.(\d{3,})$/.exec(String(response?.gasVersion||''));
  return response?.status==='ok' && response?.provider==='NH' &&
    response?.readOnly===true && response?.enabled===true &&
    response?.tokenIssued===false && typeof response?.tokenCached==='boolean' &&
    !!version && Number(version[1])>=281;
}
export async function runCentralNhDiagnostic({mode='status',request=fetch,
  now=()=>new Date(),url=process.env.GAS_WEB_APP_URL,
  token=process.env.GAS_ACCESS_TOKEN,log=console.log}={}){
  if(mode==='status'){
    const response=await callNhGasProxy('getNhAuthStatusProxy',{url,token,request});
    if(!isSupportedNhCentralStatus(response))
      throw Error('NH_PROXY_STATUS_INVALID');
    log('NH_CENTRAL STATUS_OK TOKEN_CACHED_'+(response.tokenCached?'YES':'NO')+' NO_NH_OAUTH_REQUEST');
    return true;
  }
  if(mode==='night'){
    const time=now(),z=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time).map(x=>[x.type,x.value]));
    const minutes=Number(z.hour)*60+Number(z.minute);
    if(minutes<450||minutes>=480)throw Error('NH_PROXY_NIGHT_WINDOW');
    const date=z.year+'-'+z.month+'-'+z.day;
    const ref=await fetchNhNightFromGas(date,{now,request,url,token});
    if(!ref)throw Error('NH_PROXY_NIGHT_UNAVAILABLE');
    log('NH_CENTRAL NIGHT_REFERENCE_OK VERIFIED_0600_NOT_OFFICIAL_SETTLEMENT');
    return true;
  }
  throw Error('NH_PROXY_MODE_NOT_SUPPORTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{
    if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('NH_PROXY_MAIN_ONLY');
    await runCentralNhDiagnostic({mode:process.env.NH_CENTRAL_DIAG_MODE||'status'});
  }catch(e){console.error(/^NH_PROXY_[A-Z_]+$/.test(e?.message||'')?e.message:'NH_PROXY_DIAGNOSTIC_FAILED');process.exitCode=1;}
}
