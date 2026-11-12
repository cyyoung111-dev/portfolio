#!/usr/bin/env node
// #860 exact 9.291 -> 9.292 preflight: protected authenticated GET/POST only.
// This is a maintenance release that changes NO financial writer or ledger.
import {pathToFileURL} from 'node:url';
import {readIssue860Once} from './issue860-close-single-status-readonly.mjs';
import {readIssue860WriterGate} from './issue860-writer-gate-v9289-readonly.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const fail=code=>{throw Error('ISSUE860_9292_PREFLIGHT_'+code);};
export function assessGas9292Preflight(close,gate,ledger){
 if(close?.gasVersion!=='9.291'||gate?.gasVersion!=='9.291')
  fail('PUBLISHED_9291_REQUIRED');
 if(close.closeState!=='COMPLETE'||close.closeStage!=='COMPLETE'
   ||close.closeComplete!==true||close.priceOk!==true||close.fundOk!==true
   ||close.fundAttemptState!=='DONE'||close.fundErrorPresent!==false
   ||close.snapshotStale!==false
   ||!(Number.isSafeInteger(close.storedPriceRows)&&close.storedPriceRows>=37)
   ||!/^\d{4}-\d{2}-\d{2}$/.test(String(close.closeRunDate||''))
   ||close.closeRunDate!==close.storedPriceDate
   ||close.storedPriceDate!==close.snapshotLastDate
   ||close.snapshotLastDate!==close.priceHistoryLastDate
   ||close.fundAttemptDate!==close.closeRunDate
   ||close.pendingKrxDatesCount!==0)fail('CLOSE_SETTLEMENT_UNVERIFIED');
 if(gate.gateMode!=='OPEN'||!Number.isSafeInteger(gate.recordedActive)
   ||gate.recordedActive<0||gate.recordedActive>2)
  fail('WRITER_GATE_CAPACITY_OR_MODE_UNVERIFIED');
 if(ledger?.tradeLedgerProtocolVersion!==2
   ||!Array.isArray(ledger.trades)||ledger.trades.length<1
   ||ledger.trades.length>5000
   ||!/^[0-9a-f]{64}$/.test(String(ledger.ledgerRevision||'')))
  fail('TRADE_LEDGER_V2_UNVERIFIED');
 return {kind:'ISSUE860_9292_PREDEPLOY_PROOF',
  status:'VERIFIED',publishedVersion:'9.291',
  settledCloseDate:close.closeRunDate,settledPriceRows:close.storedPriceRows,
  fundDone:true,financeLedgerV2:true,tradeRowCount:ledger.trades.length,
  gateMode:'OPEN',gateRecordedActive:gate.recordedActive,
  ownerTerminalProofProvided:false,gateIdleNotRequired:true,
  approvedMaintenanceScope:'GATE_AND_READ_ONLY_STATUS_ONLY',
  financialWrites:0,propertyWrites:0,deployments:0,readRequests:3};
}
export async function verifyGas9292Preflight({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const [close,gate]=await Promise.all([
  readIssue860Once({url:endpoint,token,fetchImpl}),
  readIssue860WriterGate({url:endpoint,token,fetchImpl})
 ]);
 let response;
 try{response=await fetchImpl(endpoint,{
  method:'POST',redirect:'follow',
  headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
  body:new URLSearchParams({action:'getTrades',accessToken:token}),
  signal:AbortSignal.timeout(45000)
 });}catch{fail('TRADE_NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('TRADE_HTTP_UNVERIFIED');
 let ledger;
 try{ledger=await response.json();}catch{fail('TRADE_RESPONSE_INVALID');}
 if(ledger?.status!=='ok')fail('TRADE_RESPONSE_INVALID');
 return assessGas9292Preflight(close,gate,ledger);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await verifyGas9292Preflight({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  });
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT){
   const {appendFileSync}=await import('node:fs');
   appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
  }
 }catch(e){
  const m=String(e?.message||'');
  console.error(/^ISSUE860_9292_PREFLIGHT_[A-Z_]+$/.test(m)?
   m:'ISSUE860_9292_PREFLIGHT_UNVERIFIED');
  process.exitCode=1;
 }
}
