// One explicitly selected missing date only. Never log credentials/raw errors.
import {validateWebAppUrl,parseDates} from './diagnose-krx-operational.mjs';
export async function runTargetedRecovery({url,token,date,apply=false,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(parseDates(date).length!==1 || typeof token!=='string' || !token.trim())throw Error('TARGET_INVALID_INPUT');
  if(typeof apply!=='boolean')throw Error('TARGET_INVALID_APPLY');
  async function request(key,mode) {
    try {
      const response=await fetchImpl(endpoint,{method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({action:'recoverPendingKrxClose',date,apply:mode,accessToken:key}),
        redirect:'follow',signal:AbortSignal.timeout(240000)});
      if(!response.ok)throw Error();
      return await response.json();
    } catch {throw Error('TARGET_REQUEST_FAILED_VERIFY_BEFORE_RETRY');}
  }
  const invalid=token==='TARGET_AUTH_PROBE'?'TARGET_AUTH_PROBE_ALT':'TARGET_AUTH_PROBE';
  const denied=await request(invalid,'0');
  if(denied?.status!=='error'||denied.message!=='인증 실패')throw Error('TARGET_AUTH_NOT_ENFORCED');
  const preview=await request(token,'0');
  if(preview?.status!=='ok'||preview.mode!=='DRY_RUN'||preview.date!==date
      ||preview.ready!==true||!Number.isSafeInteger(preview.expected)||preview.expected<1)
    throw Error('TARGET_PREFLIGHT_BLOCKED');
  if(!apply)return {mode:'DRY_RUN',date,ready:true,expected:preview.expected};
  const result=await request(token,'1');
  if(result?.status!=='ok'||result.mode!=='APPLY'||result.date!==date
      ||result.attempted!==true||result.ok!==true||!Number.isSafeInteger(result.remaining)||result.remaining<0)
    throw Error('TARGET_APPLY_INCOMPLETE_VERIFY_BEFORE_RETRY');
  return {mode:'APPLY',date,ok:true,remaining:result.remaining};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    const flag=process.env.RECOVERY_APPLY||'false';
    if(!['true','false'].includes(flag))throw Error('TARGET_INVALID_APPLY');
    console.log(JSON.stringify(await runTargetedRecovery({url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN,date:process.env.RECOVERY_DATE,apply:flag==='true'})));
  }catch(error){
    console.error(/^TARGET_[A-Z_]+$/.test(error.message)?error.message:'TARGET_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
