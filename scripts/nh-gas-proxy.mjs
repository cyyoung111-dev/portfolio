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
export async function callNhGasProxy(action,{url=process.env.GAS_WEB_APP_URL,
  token=process.env.GAS_ACCESS_TOKEN,date,request=fetch}={}){
  if(!['getNhNightProxy','getNhAuthStatusProxy','getNhNightProbe','bootstrapNhTokenOnce20261030'].includes(action)||!token||token.length<12)
    throw Error('NH_PROXY_CONFIG');
  const target=validateGasEndpoint(url);
  const payload=new URLSearchParams({action,accessToken:token,...(date?{date}:{})});
  let response,body;
  try{
    response=await request(target,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:payload,redirect:'follow',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error();
    body=await response.json();
  }catch{throw Error('NH_PROXY_NETWORK_OR_RESPONSE');}
  if(body?.status!=='ok'||body?.provider!=='NH'||body.readOnly!==true) {
    const code=body?.message;
    if(body?.status==='error'&&typeof code==='string'&&/^NH_PROXY_[A-Z0-9_]{1,70}$/.test(code))throw Error(code);
    throw Error('NH_PROXY_UNAVAILABLE');
  }
  return body;
}
export async function fetchNhNightFromGas(date,{now=()=>new Date(),
  url=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN,request=fetch}={}){
  const instant=now(),kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
  if(kst!==date)return null;
  let body;
  try{body=await callNhGasProxy('getNhNightProxy',{url,token,date,request});}catch{return null;}
  const ref=body.reference;
  // Fail closed if the server ever accidentally returns more than the
  // canonical reference schema. In particular, bearer/key/secret fields may
  // never enter a GitHub artifact or an application log.
  const responseKeys=['status','provider','readOnly','bearerExposed','reference'];
  const referenceKeys=['source','kind','tradingDate','contract','contractMonth',
    'value','clock','sourceUpdatedAt','receivedAt','officialClose'];
  if(Object.keys(body).some(k=>!responseKeys.includes(k))||
    !ref||typeof ref!=='object'||Array.isArray(ref)||
    Object.keys(ref).some(k=>!referenceKeys.includes(k)))return null;
  if(body.bearerExposed!==false||!ref||ref.source!=='NH'||ref.kind!=='REFERENCE'
    ||ref.tradingDate!==date||ref.officialClose!==false
    ||ref.sourceUpdatedAt!==date+'T06:00:00+09:00'
    ||typeof ref.receivedAt!=='string'||!Number.isFinite(Date.parse(ref.receivedAt))
    ||Date.parse(ref.receivedAt)>instant.getTime()+2000)
    return null;
  return validateNhNight({date,clock:ref.clock,contract:ref.contract,
    contractMonth:ref.contractMonth,value:ref.value},date,ref.receivedAt);
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
  ||!Number.isFinite(Date.parse(ref.receivedAt))
  ||Date.parse(ref.receivedAt)>instant.getTime()+2000)return null;
 return validateNhNight({date,clock:ref.clock,contract:ref.contract,
  contractMonth:ref.contractMonth,value:ref.value},date,ref.receivedAt);
}
