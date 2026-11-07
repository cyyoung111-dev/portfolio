// One-shot post-release NH quote verification against registered portfolio codes.
// Uses only authenticated GAS code-master read and getPrices(persist=0).
// Never calls saveNhConfig, retireLegacyMarketData, fund or Snapshot writers.
import {pathToFileURL} from 'node:url';
import {selectNhReadbackCodes} from './activate-nh-gas-runtime.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export async function runRegisteredNhReadOnly({url,token,fetchImpl=fetch,
 report=()=>{},expectedGasVersion=null}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('NH_MASTER_PROBE_AUTH_MISSING');
 const call=async(action,args={})=>{
  let response;
  try{
   response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,accessToken:token,...args}),
    signal:AbortSignal.timeout(90000)});
  }catch{throw Error('NH_MASTER_PROBE_NETWORK_UNVERIFIED');}
  if(!response?.ok)throw Error('NH_MASTER_PROBE_HTTP_UNVERIFIED');
  try{return await response.json();}
  catch{throw Error('NH_MASTER_PROBE_JSON_UNVERIFIED');}
 };
 const master=await call('getCodeListReadOnly');
 // During a 9.284 -> 9.285 cutover both versions are recognized.
 // Forensic callers can still request a single exact GAS version.
 const versionOk=expectedGasVersion===null
   ?['9.284','9.285'].includes(master?.gasVersion)
   :master?.gasVersion===expectedGasVersion;
 if(master?.status!=='ok'||master?.readOnly!==true
    ||!versionOk||!Array.isArray(master.codes))
  throw Error('NH_MASTER_PROBE_MASTER_UNVERIFIED');
 const codes=selectNhReadbackCodes(master.codes);
 if(codes.length<1||codes.length>2)throw Error('NH_MASTER_PROBE_SAMPLE_UNVERIFIED');
 const price=await call('getPrices',{codes:codes.join(','),persist:'0'});
 const providerConfirmed=price?.priceLookup?.currentProvider==='NH';
 const reportedCount=Number(price?.priceLookup?.tossResultCount);
 const positiveReturned=codes.filter(c=>Number.isFinite(Number(price?.prices?.[c]))
  &&Number(price.prices[c])>0).length;
 const summary={mode:'NH_MASTER_REGISTERED_QUOTE_READ_ONLY',
  gasVersion:master.gasVersion,
  masterRows:master.codes.length,
  krwRows:master.codes.filter(x=>x?.currency==='KRW').length,
  usdRows:master.codes.filter(x=>x?.currency==='USD').length,
  requested:codes.length,providerConfirmed,
  reportedCount:Number.isSafeInteger(reportedCount)&&reportedCount>=0?reportedCount:null,
  positiveReturned,persist:false,financialWrites:0};
 report(summary);
 if(price?.status!=='ok')throw Error('NH_MASTER_PROBE_RESPONSE_UNVERIFIED');
 if(!providerConfirmed)throw Error('NH_MASTER_PROBE_PROVIDER_UNVERIFIED');
 if(!Number.isSafeInteger(reportedCount)||reportedCount<codes.length)
  throw Error('NH_MASTER_PROBE_COUNT_UNVERIFIED');
 if(positiveReturned!==codes.length)throw Error('NH_MASTER_PROBE_PRICES_UNVERIFIED');
 return {...summary,status:'SAMPLE_CONFIRMED',fullCoverageVerified:false};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{const result=await runRegisteredNhReadOnly({
  url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
  report:row=>console.log(JSON.stringify(row))});
  console.log(JSON.stringify(result));
 }catch(e){
  console.error(/^NH_MASTER_PROBE_[A-Z_]+$/.test(e?.message||'')
    ?e.message:'NH_MASTER_PROBE_UNVERIFIED');
  process.exitCode=1;
 }
}
