// Issue #507: one-date read-only portfolio close coverage; report counts only.
// This does NOT authorize any price-history, snapshot, NAV or GAS write.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {runtimeProof,compareRuntimeProofs} from './diagnose-fund-snapshot-evidence-readonly.mjs';
export const DATE='2026-10-30';
const CODE=/^[A-Z0-9._-]{1,18}$/;
const DOMESTIC=/^[A-Z0-9]{6}$/;
const FUND=/^F\d{5}$/;
const VERIFIED=new Set(['KRX','KRX_OTP','NH_REGULAR_CLOSE']);
const CARRY=/^KRX_CARRY@20\d{2}-\d{2}-\d{2}$/;

function fail(code){throw Error('ISSUE507_CLOSE_'+code);}
export function auditCloseGap(history,historyPrices,authStatus=null){
 if(history?.status!=='ok'||history.date!==DATE||!Array.isArray(history.items)||
    !history.items.length||history.items.length>500)fail('HISTORY_UNVERIFIED');
 if(historyPrices?.status!=='ok'||!historyPrices.prices||
    typeof historyPrices.prices!=='object'||Array.isArray(historyPrices.prices))
    fail('PRICE_UNVERIFIED');
 const entries=history.items,known=new Set();
 let domestic=0,carried=0,exact=0,missing=0,unverified=0,funds=0,fundExact=0,others=0;
 for(const item of entries){
  const code=item?.code,source=String(item?.source||'');
  if(typeof code!=='string'||!CODE.test(code)||known.has(code)||!source)
    fail('HISTORY_SCOPE_UNVERIFIED');
  known.add(code);
  const prices=historyPrices.prices[code]||[];
  if(!Array.isArray(prices)||prices.length>5||prices.some(x=>x?.date!==DATE||
    !(Number(x?.price)>0)||!Number.isFinite(Number(x.price))))fail('PRICE_SCOPE_UNVERIFIED');
  if(prices.length>1)fail('DUPLICATE_PRICE_UNVERIFIED');
  const price=prices[0];
  if(FUND.test(code)){
   funds++;
   if(price && /^FUND_NAV(?:_CARRY(?:_INPUT_REQUIRED)?)?(?:@20\d{2}-\d{2}-\d{2})?$/.test(price.source||''))fundExact++;
  }else if(DOMESTIC.test(code)){
   domestic++;
   if(CARRY.test(source))carried++;
   if(!price)missing++;
   else if(VERIFIED.has(price.source)&&source===price.source)exact++;
   else unverified++;
  }else others++;
 }
 const unexpected=Object.keys(historyPrices.prices).filter(k=>!known.has(k));
 if(unexpected.length)fail('UNREQUESTED_PRICE_ROWS');
 const status=domestic>0&&exact===domestic&&carried===0&&missing===0&&unverified===0?
   'EXACT_DAY_DOMESTIC_HISTORY_PRESENT':'DOMESTIC_CLOSE_INCOMPLETE';
 return {
  mode:'ISSUE507_OCT30_DOMESTIC_CLOSE_READONLY',date:DATE,status,
  snapshotCodes:entries.length,domesticHeldCodes:domestic,
  domesticExactClosePrices:exact,domesticCarriedSnapshotCodes:carried,
  domesticMissingExactHistory:missing,domesticUnverifiedHistory:unverified,
  fundSnapshotCodes:funds,fundExactHistory:fundExact,otherCodes:others,
  nhAuthCurrent:authStatus?.status==='ok'&&authStatus.provider==='NH'?
    {enabled:authStatus.enabled===true,tokenCached:authStatus.tokenCached===true,
     tokenIssuedByStatusCall:authStatus.tokenIssued===true}:
    {status:'UNVERIFIED'},
  allHeldSameDayStoredSourcesPresent:status==='EXACT_DAY_DOMESTIC_HISTORY_PRESENT'&&
    funds===fundExact&&others===0,
  officialFinalityIndependentlyVerified:false,
  readOnly:true,writeAuthorized:false,financialWrites:0,
 };
}
export async function diagnoseCloseGap({url,token,fetchImpl=fetch,emit=()=>{}}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())fail('TOKEN_MISSING');
 async function read(action,args={}){
  let response,payload;
  try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(180000)});
  }catch{fail('NETWORK_UNVERIFIED');}
  if(!response?.ok)fail('HTTP_UNVERIFIED');
  try{payload=await response.json();}catch{fail('JSON_UNVERIFIED');}
  return payload;
 }
 const statusA=await read('getAutomationStatus');
 const strictArgs={dates:DATE,strictReadonly:'1'};
 const rangeA=await read('diagnoseSnapshotIntegrityRange',strictArgs);
 const proofA=runtimeProof(statusA,rangeA);
 const history=await read('getHistoryDetail',{date:DATE});
 if(history?.status!=='ok'||!Array.isArray(history.items))fail('HISTORY_UNVERIFIED');
 const codes=history.items.map(x=>x?.code);
 if(codes.length>500||!codes.length||codes.some(x=>typeof x!=='string'||!CODE.test(x))||
    new Set(codes).size!==codes.length)fail('HISTORY_SCOPE_UNVERIFIED');
 const prices=await read('getPriceHistory',{from:DATE,to:DATE,codes:codes.join(',')});
 const nhStatus=await read('getNhAuthStatusProxy'); // status only; never issues an NH token
 const rangeB=await read('diagnoseSnapshotIntegrityRange',strictArgs);
 const statusB=await read('getAutomationStatus');
 const coherence=compareRuntimeProofs(proofA,runtimeProof(statusB,rangeB));
 const result={...auditCloseGap(history,prices,nhStatus),
  gasVersionVerified:coherence.gasVersionVerified,
  sourceStableWithinRun:coherence.sourceStableWithinRun,
  nhTokenIssuanceRequested:false};
 emit(result);
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 diagnoseCloseGap({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
  emit:v=>{console.log(JSON.stringify(v));
   if(v.status!=='EXACT_DAY_DOMESTIC_HISTORY_PRESENT'||!v.allHeldSameDayStoredSourcesPresent)
     process.exitCode=2;}})
 .catch(e=>{const code=String(e?.message||'');
  console.error(/^ISSUE507_CLOSE_[A-Z_]+$/.test(code)?code:
    /^FUND_SNAPSHOT_[A-Z_]+$/.test(code)?code:'ISSUE507_CLOSE_UNVERIFIED');
  process.exitCode=1;});
}
