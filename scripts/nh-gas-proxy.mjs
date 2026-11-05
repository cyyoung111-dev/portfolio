import {validateNhNight} from './nh-night-reference.mjs';

// The caller NEVER receives an NH OAuth bearer or sends NH credentials.
// Only a fixed allowlisted GAS Web App can be contacted.
export function validateGasEndpoint(url){
  let parsed;
  try{parsed=new URL(url);}catch{throw Error('NH_PROXY_CONFIG');}
  if(parsed.protocol!=='https:'||parsed.hostname!=='script.google.com'
    ||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)
    ||parsed.username||parsed.password||parsed.search||parsed.hash)
    throw Error('NH_PROXY_CONFIG');
  return parsed.href;
}
// Fixed, non-sensitive transport diagnostics. No URLs, redirects' signed
// query strings, HTTP bodies, GAS access tokens or private error messages.
const safeTransportStatus=value=>[400,401,403,404,405,408,409,429,500,502,503,504]
 .includes(Number(value))?Number(value):0;
function classifyTransportResponse(res){
 let host='UNKNOWN';
 try{
  const name=new URL(res?.url).hostname;
  host=name==='script.google.com'?'GAS_WEB_APP'
   :name==='script.googleusercontent.com'?'GOOGLE_CONTENT':'OTHER';
 }catch{}
 let type='UNKNOWN';
 try{
  const mime=String(res?.headers?.get?.('content-type')||'').split(';')[0].trim().toLowerCase();
  type=/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(mime)?'JSON'
   :mime==='text/html'?'HTML':mime==='text/plain'?'PLAIN':'OTHER';
 }catch{}
 return {httpStatus:safeTransportStatus(res?.status),
  redirect:res?.redirected===true?'YES':res?.redirected===false?'NO':'UNKNOWN',
  responseHost:host,contentType:type};
}
// Classify (never persist) a bounded HTML response from Google's transport.
// Only fixed classification labels leave this function; never forward body,
// one-time content keys, cookies, access tokens or account identifiers.
export function classifyGasHtml(html){
 if(typeof html!=='string'||html.length>120000)return 'HTML_UNVERIFIED';
 const text=html.slice(0,60000);
 // Google may return HTTP 200 HTML with a doGet routing error to a POST
 // request, without executing the intended doPost action. Log only this enum.
 if(/Script function not found:\s*doGet\b/i.test(text))return 'GOOGLE_ROUTED_POST_TO_DOGET';
 if(/Script function not found:\s*doPost\b/i.test(text))return 'GOOGLE_DOPOST_NOT_FOUND';
 if(/accounts\.google\.com|Sign in - Google Accounts|to continue to Google/i.test(text))
  return 'GOOGLE_SIGN_IN';
 if(/you need access|request access|you need permission|access denied|권한이 없습니다|액세스 권한/i.test(text))
  return 'GOOGLE_PERMISSION';
 if(/sorry, unable to open the file|unable to open the file at this time|service temporarily unavailable/i.test(text))
  return 'GOOGLE_FILE_UNAVAILABLE';
 if(/Google Apps Script|Apps Script/i.test(text))return 'GOOGLE_APPS_SCRIPT_PAGE';
 if(/<!doctype\s+html|<html\b/i.test(text))return 'OTHER_HTML';
 return 'HTML_UNVERIFIED';
}
export async function callNhGasProxy(action,{url=process.env.GAS_WEB_APP_URL,
  token=process.env.GAS_ACCESS_TOKEN,date,request=fetch,onTransportDiagnostic=()=>{}}={}){
 const report=(phase,meta={})=>{
  try{onTransportDiagnostic({kind:'NH_GAS_TRANSPORT',phase,...meta});}catch{}
 };
  if(!['getNhNightProxy','getNhAuthStatusProxy','getNhNightProbe','bootstrapNhTokenOnce20261030'].includes(action)||!token||token.length<12)
    throw Error('NH_PROXY_CONFIG');
  const target=validateGasEndpoint(url);
  const payload=new URLSearchParams({action,accessToken:token,...(date?{date}:{})});
  let response,body;
  try{
    response=await request(target,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:payload,redirect:'follow',signal:AbortSignal.timeout(25000)});
  }catch(error){
    report(error?.name==='TimeoutError'||error?.name==='AbortError'
      ?'FETCH_TIMEOUT':'FETCH_FAILED');
    throw Error('NH_PROXY_NETWORK_OR_RESPONSE');
  }
  if(!response?.ok){
    report('HTTP_REJECTED',classifyTransportResponse(response));
    throw Error('NH_PROXY_NETWORK_OR_RESPONSE');
  }
  try{body=await response.json();}
  catch{
    report('JSON_PARSE_FAILED',classifyTransportResponse(response));
    throw Error('NH_PROXY_NETWORK_OR_RESPONSE');
  }
  if(body?.status!=='ok'||body?.provider!=='NH'||body.readOnly!==true) {
    const code=body?.message;
    const known=body?.status==='error'&&typeof code==='string'
      &&/^NH_PROXY_[A-Z0-9_]{1,70}$/.test(code)?code:null;
    report(known?'GAS_REJECTED':'GAS_CONTRACT_REJECTED',
      {errorCode:known||'UNVERIFIED'});
    if(known)throw Error(known);
    throw Error('NH_PROXY_UNAVAILABLE');
  }
  report('STATUS_OK');
  return body;
}
export async function fetchNhNightFromGas(date,{now=()=>new Date(),
  url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,request=fetch,onError=()=>{}}={}){
  const instant=now(),kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
  if(kst!==date){onError('NH_NIGHT_DATE_MISMATCH');return null;}
  let body;
  try{body=await callNhGasProxy('getNhNightProxy',{url,token,date,request});}
  catch(error){
    const code=String(error?.message||'');
    onError(/^NH_PROXY_[A-Z0-9_]{1,70}$/.test(code)?code:'NH_NIGHT_SOURCE_UNAVAILABLE');
    return null;
  }
  // Record the clock AFTER the response has been received. The server
  // timestamps its receipt during a GAS/NH call that may legitimately take
  // more than two seconds. Comparing that server timestamp to the PRE-request
  // clock rejects valid data as a future-dated observation.
  const completed=now(),completedMs=completed?.getTime?.();
  if(!Number.isFinite(completedMs)||completedMs<instant.getTime()){
    onError('NH_NIGHT_CLIENT_CLOCK_INVALID');return null;
  }
  const ref=body.reference;
  // Fail closed if the server ever accidentally returns more than the
  // canonical reference schema. In particular, bearer/key/secret fields may
  // never enter a GitHub artifact or an application log.
  const responseKeys=['status','provider','readOnly','bearerExposed','reference'];
  const referenceKeys=['source','kind','tradingDate','contract','contractMonth',
    'value','clock','sourceUpdatedAt','receivedAt','officialClose'];
  if(Object.keys(body).some(k=>!responseKeys.includes(k))||
    !ref||typeof ref!=='object'||Array.isArray(ref)||
    Object.keys(ref).some(k=>!referenceKeys.includes(k))){
    onError('NH_NIGHT_SCHEMA_INVALID');return null;
  }
  if(body.bearerExposed!==false||!ref||ref.source!=='NH'||ref.kind!=='REFERENCE'
    ||ref.tradingDate!==date||ref.officialClose!==false
    ||ref.sourceUpdatedAt!==date+'T06:00:00+09:00'
    ||typeof ref.receivedAt!=='string'||!Number.isFinite(Date.parse(ref.receivedAt))){
    onError('NH_NIGHT_REFERENCE_INVALID');return null;
  }
  if(Date.parse(ref.receivedAt)>completedMs+2000){
    onError('NH_NIGHT_RECEIPT_AFTER_RESPONSE');return null;
  }
  const validated=validateNhNight({date,clock:ref.clock,contract:ref.contract,
    contractMonth:ref.contractMonth,value:ref.value},date,ref.receivedAt);
  if(!validated)onError('NH_NIGHT_REFERENCE_INVALID');
  return validated;
}

export async function fetchNhNightProbeFromGas(date,{now=()=>new Date(),
 url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,request=fetch,
 onError=()=>{}}={}){
 const instant=now(),p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
 const minute=Number(p.hour)*60+Number(p.minute);
 if(date!==p.year+'-'+p.month+'-'+p.day||minute<480||minute>=780)return null;
 let body;
 try{body=await callNhGasProxy('getNhNightProbe',{url,token,date,request});}
 catch(error) {
   const code=String(error?.message||'');
   if(/^NH_PROXY_[A-Z0-9_]{1,70}$/.test(code))onError(code);
   return null;
 }
 const completed=now(),completedMs=completed?.getTime?.();
 if(!Number.isFinite(completedMs)||completedMs<instant.getTime()){
   onError('NH_NIGHT_CLIENT_CLOCK_INVALID');return null;
 }
 const ref=body.reference;
 const requiredOuter=['status','provider','readOnly','bearerExposed','diagnosticOnly','tokenIssued','reference'];
 const requiredRef=['source','kind','tradingDate','contract','contractMonth','value','clock',
 'sourceUpdatedAt','receivedAt','officialClose'];
 if(body.bearerExposed!==false||body.diagnosticOnly!==true||body.tokenIssued!==false
  ||!ref||typeof ref!=='object'||Array.isArray(ref)
  ||Object.keys(body).some(k=>!requiredOuter.includes(k))
  ||Object.keys(ref).some(k=>!requiredRef.includes(k))
  ||ref.source!=='NH'||ref.kind!=='REFERENCE'||ref.tradingDate!==date
  ||ref.officialClose!==false||ref.sourceUpdatedAt!==date+'T06:00:00+09:00'
  ||typeof ref.receivedAt!=='string'
  ||!Number.isFinite(Date.parse(ref.receivedAt)))return null;
 if(Date.parse(ref.receivedAt)>completedMs+2000){
   onError('NH_NIGHT_RECEIPT_AFTER_RESPONSE');return null;
 }
 return validateNhNight({date,clock:ref.clock,contract:ref.contract,
  contractMonth:ref.contractMonth,value:ref.value},date,ref.receivedAt);
}
