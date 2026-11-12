#!/usr/bin/env node
// #860 9.292 protected post-publish verification. GET/POST read-only actions.
// No scripts.run, no finance/Sheet/ScriptProperties mutation, no retry of writes.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const fail=code=>{throw Error('ISSUE860_9292_POSTDEPLOY_'+code);};
const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
async function request(url,token,action,fetchImpl,method='POST'){
 const endpoint=new URL(url),opts={method,redirect:'follow',
  signal:AbortSignal.timeout(method==='POST'?45000:30000)};
 if(method==='GET'){
  endpoint.searchParams.set('action',action);
  endpoint.searchParams.set('accessToken',token);
 }else{
  if(!['getSettings','getTrades'].includes(action))fail('UNREVIEWED_ACTION');
  opts.headers={'content-type':'application/x-www-form-urlencoded;charset=UTF-8'};
  opts.body=new URLSearchParams({action,accessToken:token});
 }
 let r;
 try{r=await fetchImpl(method==='GET'?endpoint.toString():url,opts);}
 catch{fail('NETWORK_OR_TIMEOUT');}
 if(r?.ok!==true)fail('HTTP_UNVERIFIED');
 let p;
 try{p=await r.json();}catch{fail('JSON_UNVERIFIED');}
 if(!p||p.status!=='ok')fail('RESPONSE_UNVERIFIED');
 return p;
}
export function assessGas9292PostDeploy({settings,ledger,gate}={}){
 if(settings?.gasVersion==='9.291'||gate?.gasVersion==='9.291')
  fail('PREVIOUS_VERSION_WARM');
 if(settings?.gasVersion!=='9.292'||!settings.settings||gate?.gasVersion!=='9.292')
  fail('VERSION_MISMATCH');
 if(ledger?.tradeLedgerProtocolVersion!==2||!Array.isArray(ledger.trades)
    ||ledger.trades.length<1||ledger.trades.length>5000
    ||!/^[0-9a-f]{64}$/.test(String(ledger.ledgerRevision||'')))
  fail('LEDGER_V2_UNVERIFIED');
 const ids=new Set();
 for(const tr of ledger.trades){
  if(!tr||!ID.test(tr.id)||ids.has(tr.id))fail('LEDGER_TRADE_IDS_UNVERIFIED');
  ids.add(tr.id);
 }
 const g=gate.writerGate;
 if(!g||g.mode!=='OPEN'||g.repairAuthorized!==false
    ||!Number.isSafeInteger(g.activeCount)||g.activeCount<0||g.activeCount>24
    ||!Array.isArray(g.activeOwners)||g.activeOwners.length!==g.activeCount
    ||!Number.isSafeInteger(g.expiredUnconfirmedCount)||g.expiredUnconfirmedCount<0
    ||!Number.isSafeInteger(g.timeoutRetirementCandidates)
    ||g.timeoutRetirementCandidates<0)
  fail('GATE_SCHEMA_UNVERIFIED');
 for(const owner of g.activeOwners){
  if(!owner||typeof owner.functionName!=='string'||!owner.functionName
    ||owner.functionName.length>100
    ||!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(owner.startedKst)
    ||!Number.isSafeInteger(owner.ageMinutes)||owner.ageMinutes<0
    ||typeof owner.terminalReceiptPresent!=='boolean'
    ||typeof owner.retirementEligible!=='boolean')fail('GATE_OWNER_UNVERIFIED');
 }
 const expiringOwners=g.activeOwners.filter(x=>x.retirementEligible);
 if(expiringOwners.length!==g.timeoutRetirementCandidates)
  fail('GATE_EXPIRY_COUNT_MISMATCH');
 // This GET endpoint is read-only. Old v9.291 ACTIVE leases can remain at
 // publish time; they are retired by the NEXT normal, Gate-locked writer
 // admission. Never claim their cleanup happened or rollback a healthy
 // publication merely because the next writer has not run yet.
 if(JSON.stringify(g).includes('"token"'))fail('GATE_TOKEN_EXPOSED');
 return {kind:'ISSUE860_9292_POSTDEPLOY_READONLY',status:'VERIFIED',
  gasVersion:'9.292',tradeLedgerVersion:2,tradeRows:ids.size,
  gateMode:'OPEN',recordedActive:g.activeCount,
  timeoutRetirementCandidates:g.timeoutRetirementCandidates,
  reconciliationState:expiringOwners.length
   ?'AWAITING_NEXT_NORMAL_WRITER':'NO_EXPIRED_ACTIVE_LEASES',
  expiredUnconfirmedCount:g.expiredUnconfirmedCount,
  gateOwnerDiagnosticsAvailable:true,readOnlyStatusNoWriterToken:true,
  closeFinality:'REQUIRES_INDEPENDENT_DAILY_STATUS_READ',
  financeWrites:0,propertyWrites:0,gasDeployments:0,apiReads:3};
}
export async function verifyGas9292PostDeploy({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const settings=await request(endpoint,token,'getSettings',fetchImpl);
 const ledger=await request(endpoint,token,'getTrades',fetchImpl);
 const gate=await request(endpoint,token,'getWriterGateStatus',fetchImpl,'GET');
 return assessGas9292PostDeploy({settings,ledger,gate});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  console.log(JSON.stringify(await verifyGas9292PostDeploy({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  })));
 }catch(e){
  const m=String(e?.message||'');
  console.error(/^ISSUE860_9292_POSTDEPLOY_[A-Z_]+$/.test(m)?
    m:'ISSUE860_9292_POSTDEPLOY_UNVERIFIED');
  process.exitCode=1;
 }
}
