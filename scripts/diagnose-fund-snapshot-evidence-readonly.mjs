// Bounded, read-only representative-row evidence for one known fund/date.
// Output only enums and booleans; never output raw account, holdings, amounts or API bodies.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export const TARGET_DATE='2026-10-30', TARGET_CODE='F00001';
const SOURCE=/^(?:FUND_NAV|FUND_NAV_CARRY|FUND_NAV_CARRY_INPUT_REQUIRED|MANUAL)(?:@\d{4}-\d{2}-\d{2})?$/;

export function summarizeEvidence(history,prices,date=TARGET_DATE,code=TARGET_CODE){
 if(history?.status!=='ok'||history.date!==date||!Array.isArray(history.items)||history.items.length>1000
    ||prices?.status!=='ok'||!prices.prices||typeof prices.prices!=='object'
    ||Array.isArray(prices.prices))throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 const matches=history.items.filter(i=>i?.code===code);
 if(matches.length>1)throw Error('FUND_SNAPSHOT_AMBIGUOUS_ROWS');
 const fundPrices=prices.prices[code]||[];
 if(!Array.isArray(fundPrices)||fundPrices.length>5)throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 const exact=fundPrices.filter(r=>r?.date===date);
 if(exact.length>1)throw Error('FUND_SNAPSHOT_AMBIGUOUS_ROWS');
 const h=matches[0],p=exact[0];
 const result={code,date,snapshotRepresentativePresent:!!h,priceRepresentativePresent:!!p,
    amountMatches:null,sourceTextMatches:null,classification:''};
 if(!p){result.classification='PRICE_REPRESENTATIVE_ABSENT';return result;}
 if(!h){result.classification='SNAPSHOT_REPRESENTATIVE_ABSENT';return result;}
 if(!Number.isFinite(h.evalAmt)||!Number.isFinite(p.price)||h.evalAmt<=0||p.price<=0
    ||typeof h.source!=='string'||typeof p.source!=='string'
    ||!SOURCE.test(h.source.toUpperCase())||!SOURCE.test(p.source.toUpperCase()))
    throw Error('FUND_SNAPSHOT_BAD_RESPONSE');
 result.amountMatches=h.evalAmt===p.price;
 result.sourceTextMatches=h.source.toUpperCase()===p.source.toUpperCase();
 result.classification=!result.amountMatches
    ?'REPRESENTATIVE_AMOUNT_DIFFERENT'
    :!result.sourceTextMatches
      ?'REPRESENTATIVE_SOURCE_TEXT_DIFFERENT'
      :'REPRESENTATIVES_MATCH_CHECK_FULL_GAS_PROVENANCE';
 return result;
}
export async function diagnoseSnapshot({url,token,fetchImpl=fetch,emit=()=>{}}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('FUND_SNAPSHOT_TOKEN_MISSING');
 async function read(action,args){
  let r,payload;
  try{
   r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action,...args,accessToken:token}),
    signal:AbortSignal.timeout(180000)});
  }catch{throw Error('FUND_SNAPSHOT_NETWORK_UNVERIFIED');}
  if(!r?.ok)throw Error('FUND_SNAPSHOT_HTTP_UNVERIFIED');
  try{payload=await r.json();}catch{throw Error('FUND_SNAPSHOT_JSON_UNVERIFIED');}
  return payload;
 }
 const history=await read('getHistoryDetail',{date:TARGET_DATE});
 const prices=await read('getPriceHistory',{from:TARGET_DATE,to:TARGET_DATE,codes:TARGET_CODE});
 const result=summarizeEvidence(history,prices);
 emit(result);
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await diagnoseSnapshot({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   emit:v=>console.log(JSON.stringify(v))});}
 catch(e){const code=String(e?.message||'');
  console.error(/^FUND_SNAPSHOT_[A-Z_]+$/.test(code)?code:'FUND_SNAPSHOT_UNKNOWN');
  process.exitCode=1;
 }
}
