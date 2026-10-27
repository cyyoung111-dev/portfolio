import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

// Read-only presence proof; the existing GAS endpoint intentionally omits price.
export async function diagnose({url,token,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url), date='2026-02-23';
  if(typeof token!=='string'||!token.trim())throw Error('AUTH_REQUIRED');
  async function request(key) {
    const response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action:'getKrxHeldCloseCoverage',date,code:'102970',accessToken:key}),
      signal:AbortSignal.timeout(240000)});
    if(!response.ok)throw Error('HTTP_ERROR');
    return response.json();
  }
  const bad=token==='DENIED_PROBE'?'DENIED_PROBE_2':'DENIED_PROBE';
  const denied=await request(bad);
  if(denied?.status!=='error'||denied.message!=='인증 실패')throw Error('AUTH_GUARD');
  const result=await request(token), t=result?.targetEvidence;
  if(result?.status!=='ok'||result.coverage?.mode!=='READ_ONLY'||result.coverage.requestedDate!==date||
    !t||t.requested!==true||typeof t.eligibleHeldDomestic!=='boolean'||typeof t.exactDateConfirmed!=='boolean'||
    !['KRX_OPENAPI','KRX_OTP','NOT_CONFIRMED'].includes(t.providerClass)||
    (t.exactDateConfirmed&&(!t.eligibleHeldDomestic||t.usedDate!==date||t.providerClass==='NOT_CONFIRMED'))||
    (!t.exactDateConfirmed&&(t.usedDate||t.providerClass!=='NOT_CONFIRMED')))throw Error('BAD_EVIDENCE');
  return {mode:'READ_ONLY',date,eligible:t.eligibleHeldDomestic,confirmed:t.exactDateConfirmed,provider:t.providerClass};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 if(process.argv.includes('--self-test')){
  const fetchImpl=async (_url,opts)=>({ok:true,json:async()=>opts.body.get('accessToken')==='secret'
    ? {status:'ok',coverage:{mode:'READ_ONLY',requestedDate:'2026-02-23'},targetEvidence:{requested:true,eligibleHeldDomestic:true,exactDateConfirmed:true,usedDate:'2026-02-23',providerClass:'KRX_OPENAPI'}}
    : {status:'error',message:'인증 실패'}});
  const x=await diagnose({url:'https://script.google.com/macros/s/AKfycbTest/exec',token:'secret',fetchImpl});
  assert.equal(x.confirmed,true);assert.equal(x.date,'2026-02-23');console.log('진단 계약 PASS');
 }else{
  try{console.log(JSON.stringify(await diagnose({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));}
  catch{console.error('DIAGNOSTIC_FAILED');process.exitCode=1;}
 }
}
