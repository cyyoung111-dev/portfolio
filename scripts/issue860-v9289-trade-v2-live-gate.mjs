#!/usr/bin/env node
// #860 release gate: EXACTLY TWO authenticated read-only GAS calls.
// Verify published 9.288 and the migrated 14-column v2 ledger before
// any 9.289 write. No raw trade data, IDs, URLs or credentials are logged.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
function fail(code){throw Error('ISSUE860_9289_GATE_'+code);}
async function read(url,token,action,fetchImpl){
 let response;
 try{response=await fetchImpl(url,{
  method:'POST',redirect:'follow',
  headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
  body:new URLSearchParams({action,accessToken:token}),
  signal:AbortSignal.timeout(90000)
 });}catch{fail('NETWORK_OR_TIMEOUT');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}catch{fail('JSON_UNVERIFIED');}
 if(payload?.status!=='ok'||!payload||typeof payload!=='object'||Array.isArray(payload))
  fail('RESPONSE_UNVERIFIED');
 return payload;
}
export async function verifyIssue8609289TradeV2LiveGate({
 url,token,fetchImpl=fetch,expectedInitialRows=338
}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 if(expectedInitialRows!==338)fail('ROW_CONTRACT_DRIFT');
 const status=await read(endpoint,token,'getAutomationStatus',fetchImpl);
 if(status.gasVersion!=='9.288'||status.automation?.gasVersion!=='9.288')
  fail('PUBLISHED_9288_UNVERIFIED');
 const state=String(status.automation?.portfolioClose?.stage||status.automation?.closeRun?.stage||'');
 const fundState=String(status.automation?.fundAttempt?.state||'');
 if(['PRICE','FUND','START','STARTED','IN_PROGRESS','RUNNING','BACKUP','NAV_WRITE'].includes(state)
    ||['START','IN_PROGRESS','RUNNING','RETRYING'].includes(fundState))
  fail('ACTIVE_WRITER');
 const data=await read(endpoint,token,'getTrades',fetchImpl);
 if(data.tradeLedgerProtocolVersion!==2
  ||typeof data.ledgerRevision!=='string'||!/^[a-f0-9]{64}$/.test(data.ledgerRevision)
  ||!Array.isArray(data.trades)||data.trades.length!==expectedInitialRows)
   fail('MIGRATED_LEDGER_NOT_VERIFIED');
 const ids=new Set();
 for(const trade of data.trades){
  if(!trade||typeof trade!=='object'||Array.isArray(trade)
   ||typeof trade.id!=='string'||!ID.test(trade.id)
   ||ids.has(trade.id))fail('TRADE_IDS_UNVERIFIED');
  ids.add(trade.id);
 }
 if(ids.size!==expectedInitialRows)fail('ID_COUNT_MISMATCH');
 return {kind:'ISSUE860_9289_LIVE_POSTMIGRATION_GATE',status:'VERIFIED',
  gasVersion:'9.288',v2Protocol:2,uniqueTradeRows:ids.size,
  versionReadCount:1,tradeReadCount:1,financeWrites:0,
  gasDeployments:0,telegramSends:0,sourceAtCopyVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const x=await verifyIssue8609289TradeV2LiveGate({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(x));
 }catch(e){
  const m=String(e?.message||'');
  console.error(/^ISSUE860_9289_GATE_[A-Z0-9_]+$/.test(m)?m:'ISSUE860_9289_GATE_UNVERIFIED');
  process.exitCode=1;
 }
}
