#!/usr/bin/env node
// #734 9.293 postdeploy: exact published protocol proof without mutating
// financial rows or attempting a replay.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
const fail=code=>{throw Error('ISSUE734_9293_POSTDEPLOY_'+code);};
const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
export function assessGas9293PostDeploy({settings,ledger,gate}={}){
 if(settings?.gasVersion==='9.292'||gate?.gasVersion==='9.292')
  fail('PREVIOUS_VERSION_WARM');
 if(settings?.status!=='ok'||settings.gasVersion!=='9.293'
    ||!settings.settings||gate?.gasVersion!=='9.293'
    ||gate?.status!=='ok')fail('VERSION_OR_SETTINGS_UNVERIFIED');
 const g=gate.writerGate;
 if(!g||g.mode!=='OPEN'||g.repairAuthorized!==false
    ||!Number.isSafeInteger(g.activeCount)||g.activeCount<0||g.activeCount>24
    ||!Array.isArray(g.activeOwners)||g.activeOwners.length!==g.activeCount
    ||!Number.isSafeInteger(g.expiredUnconfirmedCount)
    ||!Number.isSafeInteger(g.timeoutRetirementCandidates)
    ||g.timeoutRetirementCandidates<0||g.timeoutRetirementCandidates>g.activeCount)
  fail('WRITER_GATE_UNVERIFIED');
 if(JSON.stringify(g).includes('"token"'))fail('GATE_SECRET_EXPOSED');
 if(ledger?.status!=='ok'||ledger.tradeLedgerProtocolVersion!==2
    ||!Array.isArray(ledger.trades)||ledger.trades.length!==338
    ||!/^[0-9a-f]{64}$/.test(String(ledger.ledgerRevision||'')))
  fail('LEDGER_UNVERIFIED');
 const ids=new Set();
 for(const tr of ledger.trades){
  if(!tr||!ID.test(tr.id)||ids.has(tr.id))fail('TRADE_IDS_UNVERIFIED');
  ids.add(tr.id);
 }
 return {kind:'ISSUE734_9293_POSTDEPLOY_READONLY',status:'VERIFIED',
  gasVersion:'9.293',tradeLedgerVersion:2,tradeRows:ids.size,
  writerGateMode:'OPEN',recordedActive:g.activeCount,
  expiredUnconfirmedCount:g.expiredUnconfirmedCount,
  snapshotStillRequiresSeparateProof:true,
  financeWrites:0,propertyWrites:0,gasDeployments:0,apiReads:3};
}
async function request(url,token,action,fetchImpl){
 const isGet=action==='getWriterGateStatus';
 const u=new URL(url), opts={method:isGet?'GET':'POST',redirect:'follow',
  signal:AbortSignal.timeout(isGet?30000:60000)};
 if(isGet){u.searchParams.set('action',action);u.searchParams.set('accessToken',token);}
 else {
  opts.headers={'content-type':'application/x-www-form-urlencoded;charset=UTF-8'};
  opts.body=new URLSearchParams({action,accessToken:token});
 }
 let response;
 try{response=await fetchImpl(isGet?u.toString():url,opts);}
 catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 try{return await response.json();}catch{fail('JSON_UNVERIFIED');}
}
export async function verifyGas9293PostDeploy({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const settings=await request(endpoint,token,'getSettings',fetchImpl);
 const ledger=await request(endpoint,token,'getTrades',fetchImpl);
 const gate=await request(endpoint,token,'getWriterGateStatus',fetchImpl);
 return assessGas9293PostDeploy({settings,ledger,gate});
}
export async function verifyGas9293PostDeployWithRetry({verify,
 delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxAttempts=5}={}){
 if(typeof verify!=='function'||typeof delay!=='function'
    ||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)
  fail('RETRY_CONTRACT_INVALID');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  try{
   const result=await verify();
   if(result?.status!=='VERIFIED'||result.gasVersion!=='9.293'
      ||result.tradeLedgerVersion!==2||result.financeWrites!==0)
    fail('RETRY_RESULT_UNVERIFIED');
   return {...result,readbackAttempts:attempt};
  }catch(e){
   if(e?.message!=='ISSUE734_9293_POSTDEPLOY_PREVIOUS_VERSION_WARM'
     ||attempt===maxAttempts)throw e;
   await delay(attempt*3000);
  }
 }
 fail('RETRY_EXHAUSTED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await verifyGas9293PostDeployWithRetry({
  verify:()=>verifyGas9293PostDeploy({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  })
 })));}catch(e){
  const code=String(e?.message||'');
  console.error(/^ISSUE734_9293_POSTDEPLOY_[A-Z_]+$/.test(code)
   ?code:'ISSUE734_9293_POSTDEPLOY_UNVERIFIED');
  process.exitCode=1;
 }
}
