#!/usr/bin/env node
// #860 v9.291 post-deployment exact endpoint verification. Read-only GET
// writer gate + authenticated getAutomationStatus/getTrades; no finance writes.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const err=code=>{throw Error('ISSUE860_9291_POSTDEPLOY_'+code)};
async function request(url,token,action,fetchImpl,method='POST'){
 const endpoint=new URL(url),opts={method,redirect:'follow'};
 if(method==='GET'){
  endpoint.searchParams.set('action',action);
  endpoint.searchParams.set('accessToken',token);
  opts.signal=AbortSignal.timeout(30000);
 }else{
  if(!['getAutomationStatus','getTrades'].includes(action))err('ACTION_REJECTED');
  opts.headers={'content-type':'application/x-www-form-urlencoded;charset=UTF-8'};
  opts.body=new URLSearchParams({action,accessToken:token});
  opts.signal=AbortSignal.timeout(45000);
 }
 let response;
 try{response=await fetchImpl(method==='GET'?endpoint.toString():url,opts);}
 catch{err('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)err('HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}catch{err('JSON_UNVERIFIED');}
 if(payload?.status!=='ok')err('RESPONSE_UNVERIFIED');
 return payload;
}
export async function verifyGas9291PostDeploy({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)err('AUTH_MISSING');
 const state=await request(endpoint,token,'getAutomationStatus',fetchImpl);
 const a=state.automation;
 if(state.gasVersion!=='9.291'||a?.gasVersion!=='9.291')
  err('WEBAPP_VERSION_MISMATCH');
 if(!DATE.test(a.snapshotLastDate)||a.snapshotLastDate!==a.priceHistoryLastDate||
   a.snapshotStale!==false||a.tradeLedgerWriteUnverified!==false||
   a.pendingTradeSnapshotRebuildFrom!==''||
   a.tradeSnapshotDeferredCount!==0)
  err('FINANCIAL_STATE_UNVERIFIED');
 const ledger=await request(endpoint,token,'getTrades',fetchImpl);
 if(ledger.tradeLedgerProtocolVersion!==2||!Array.isArray(ledger.trades)||
   ledger.trades.length<1||ledger.trades.length>5000||
   !/^[0-9a-f]{64}$/.test(String(ledger.ledgerRevision||'')))
  err('TRADE_LEDGER_UNVERIFIED');
 const ids=new Set();
 for(const tr of ledger.trades){
  if(!tr||typeof tr.id!=='string'||!ID.test(tr.id)||ids.has(tr.id))
   err('TRADE_IDS_UNVERIFIED');
  ids.add(tr.id);
 }
 const gate=await request(endpoint,token,'getWriterGateStatus',fetchImpl,'GET');
 if(gate.gasVersion!=='9.291'||gate.writerGate?.mode!=='OPEN'||
    gate.writerGate.activeCount!==0||gate.writerGate.repairAuthorized!==false)
  err('WRITER_GATE_NOT_IDLE');
 return {
  kind:'ISSUE860_9291_POSTDEPLOY_READONLY',
  status:'VERIFIED',deployedVersion:'9.291',
  snapshotLastDate:a.snapshotLastDate,
  priceHistoryLastDate:a.priceHistoryLastDate,
  tradeLedgerVersion:2,tradeRows:ids.size,
  writerGate:'OPEN',recordedActive:0,
  closeFinality:a.closeRun?.state||'UNKNOWN',
  fundAttemptState:a.fundAttempt?.state||'UNVERIFIED',
  closeMarkedCompleteByProbe:false,
  financialWrites:0,scriptPropertyWrites:0,gasDeployments:0,telegramSends:0,
  apiReads:3
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await verifyGas9291PostDeploy({
  url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
 })));}
 catch(e){let m=String(e?.message||'');
  console.error(/^ISSUE860_9291_POSTDEPLOY_[A-Z_]+$/.test(m)?m:'ISSUE860_9291_POSTDEPLOY_UNVERIFIED');
  process.exitCode=1;}
}
