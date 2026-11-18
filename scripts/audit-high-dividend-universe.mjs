import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {APPROVED_DIVIDEND_GAS} from './run-dividend-source-refresh.mjs';

const fail=reason=>{throw Error('HIGH_DIVIDEND_AUDIT_'+reason);};
const codeOf=value=>{
 const s=String(value??'').trim().toUpperCase();
 return /^\d{1,6}$/.test(s)?s.padStart(6,'0'):/^\d{4}[A-Z]\d$/.test(s)?s:'';
};
const marketOf=value=>({KOSPI:'KOSPI','유가':'KOSPI','유가증권':'KOSPI',KOSDAQ:'KOSDAQ','코스닥':'KOSDAQ'})[String(value??'').trim().toUpperCase()]||'';
function domesticStock(row){
 const type=String(row?.assetType||row?.type||'').trim().toUpperCase();
 const currency=String(row?.currency||row?.cur||'').trim().toUpperCase();
 const market=String(row?.market||'').trim().toUpperCase();
 return ['주식','STOCK'].includes(type)&&!['US','NASDAQ','NYSE','AMEX','해외'].includes(market)&&currency!=='USD'&&!!codeOf(row?.code);
}
export function auditHistoricalUniverse(candidateIndex,master,trades){
 if(candidateIndex?.classification!=='CANDIDATE_ONLY'||!Array.isArray(candidateIndex.matched)||!Array.isArray(candidateIndex.unresolved)||!candidateIndex.matched.length)fail('CANDIDATE_SOURCE');
 if(!Array.isArray(master)||!Array.isArray(trades))fail('LEDGER_RESPONSE');
 const candidates=new Map();
 const years=new Set();
 for(const item of candidateIndex.matched){
  const code=codeOf(item?.listedCode);
  if(!code||candidates.has(code)||!marketOf(item.market)||item.identityState!=='EXACT_LISTED_ISSUER'||item.taxEligibility!=='UNVERIFIED'||!Number.isInteger(item.businessYear))fail('CANDIDATE_IDENTITY');
  candidates.set(code,item);years.add(item.businessYear);
 }
 if(years.size!==1)fail('CANDIDATE_YEAR');
 const byCode=new Map(),byName=new Map();
 for(const row of master){
  if(!row||typeof row.name!=='string')fail('MASTER_ROW');
  const raw=String(row.code??'').trim().toUpperCase();
  if(!raw)continue;
  const code=codeOf(raw)||raw;
  if(byCode.has(code))fail('MASTER_DUPLICATE');
  byCode.set(code,row);
  const name=row.name.trim();
  if(!byName.has(name))byName.set(name,new Set());
  byName.get(name).add(code);
 }
 const history=new Map();
 let unresolvedTradeRows=0;
 for(const row of trades){
  if(!row||typeof row!=='object')fail('TRADE_ROW');
  const raw=String(row.code??'').trim().toUpperCase();
  let key=raw?(codeOf(raw)||raw):'';
  if(!key){
   const choices=byName.get(String(row.name??'').trim());
   if(choices?.size===1)key=[...choices][0];
  }
  // Keep sold and historical symbols. Missing master records remain visible
  // as unresolved counts, never treated as a negative eligibility decision.
  if(!key||!byCode.has(key)){unresolvedTradeRows++;continue;}
  history.set(key,byCode.get(key));
 }
 let domestic=0,matched=0,marketConflict=0,other=0,unmatched=0;
 for(const [code,row] of history){
  if(!domesticStock(row)){other++;continue;}
  domestic++;
  const candidate=candidates.get(code);
  if(!candidate){unmatched++;continue;}
  const market=marketOf(row.market);
  if(market&&market!==candidate.market){marketConflict++;continue;}
  matched++;
 }
 if(domestic!==matched+marketConflict+unmatched||history.size!==domestic+other)fail('COUNT_RECONCILIATION');
 return {mode:'HISTORICAL_TRADE_UNIVERSE_CANDIDATE_AUDIT',businessYear:[...years][0],
  officialMatchedIssuerCodes:candidates.size,officialUnresolvedIssuers:candidateIndex.unresolved.length,
  mappedHistoricalSymbols:history.size,domesticStockSymbols:domestic,candidateSymbols:matched,
  noExactCandidateCode:unmatched,marketConflicts:marketConflict,otherSymbols:other,unresolvedTradeRows,
  taxEligibilityVerified:false,financialOriginalWritten:false};
}
export async function auditFromGas({url,token,candidateIndex,fetchImpl=fetch,
 delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report=()=>{}}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<8)fail('AUTH_REQUIRED');
 // The whole audit may repeat at most one read, only on a transport
 // failure or a temporary gateway response. Never retry auth/schema errors.
 let retryRemaining=1;
 async function call(stage,action,accessToken=token){
  if(!['getCodeListReadOnly','getTrades'].includes(action))fail('ACTION');
  for(let attempt=1;;attempt++){
   let r,reason='',retryable=false;
   try{
    r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded'},
       body:new URLSearchParams({action,accessToken}),signal:AbortSignal.timeout(60000)});
   }catch{reason='NETWORK';retryable=true;}
   if(!reason&&r?.ok!==true){
    const status=r?.status;
    reason=[401,403,429,502,503,504].includes(status)?'HTTP_'+status:'HTTP_UNVERIFIED';
    retryable=[502,503,504].includes(status);
   }
   if(reason){
    if(retryable&&retryRemaining>0){
     retryRemaining--;
     report({kind:'HIGH_DIVIDEND_AUDIT_READ_RETRY',stage,reason,financeWrites:0});
     await delay(3000);continue;
    }
    fail(stage+'_'+reason);
   }
   try{return await r.json();}catch{fail(stage+'_JSON_UNVERIFIED');}
  }
 }
 const denied=await call('AUTH_PROBE','getCodeListReadOnly',token==='HIGH_DIVIDEND_INVALID_PROBE'?'HIGH_DIVIDEND_INVALID_PROBE_X':'HIGH_DIVIDEND_INVALID_PROBE');
 if(denied?.status!=='error'||denied.message!=='인증 실패')fail('AUTH_NOT_PROVEN');
 const master=await call('MASTER','getCodeListReadOnly');
 if(master?.status!=='ok'||master.readOnly!==true||!APPROVED_DIVIDEND_GAS.has(master.gasVersion)||!Array.isArray(master.codes))fail('MASTER_UNAVAILABLE');
 const ledger=await call('LEDGER','getTrades');
 if(ledger?.status!=='ok'||!Array.isArray(ledger.trades))fail('LEDGER_UNAVAILABLE');
 // This is a read-only, non-atomic inspection of historical symbol coverage,
 // not a verified entitlement or balance snapshot. No holdings leave GAS
 // except into this protected runner; output is aggregate counts only.
 return {...auditHistoricalUniverse(candidateIndex,master.codes,ledger.trades),gasVersion:master.gasVersion,atomicSnapshot:false};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  const candidateIndex=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  console.log(JSON.stringify(await auditFromGas({candidateIndex,url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,report:row=>console.log(JSON.stringify(row))})));
 }catch(e){console.error(/^HIGH_DIVIDEND_AUDIT_[A-Z_]+$/.test(e?.message||'')?e.message:'HIGH_DIVIDEND_AUDIT_FAILED');process.exitCode=1;}
}
