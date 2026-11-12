#!/usr/bin/env node
// #734 read-only postmigration contract: actual reviewed GAS v9.292 getTrades + getHoldings.
// No synthetic financial writes, browser changes, migration reruns or raw PII logs.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
const ID=/^(?:tr|srv)_[A-Za-z0-9_-]{6,128}$/;
const fail=reason=>{throw Error('ISSUE734_POSTMIGRATION_'+reason);};
export async function inspectIssue734LiveProtocol({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 const read=async action=>{
  let response;
  try{response=await fetchImpl(endpoint,{
   method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token}),
   signal:AbortSignal.timeout(70000)
  });}catch{fail('NETWORK_OR_TIMEOUT');}
  if(response?.ok!==true)fail('HTTP_UNVERIFIED');
  try{const payload=await response.json();
   if(payload?.status!=='ok')fail('RESPONSE_UNVERIFIED');
   return payload;
  }catch(e){if(/^ISSUE734_POSTMIGRATION_/.test(String(e?.message||'')))throw e;
   fail('JSON_UNVERIFIED');}
 };
 const trades=await read('getTrades');
 if(!['9.288','9.289','9.290','9.291','9.292'].includes(trades.gasVersion)&&trades.gasVersion!==undefined)
  fail('GAS_VERSION_UNVERIFIED');
 if(trades.tradeLedgerProtocolVersion!==2
  ||typeof trades.ledgerRevision!=='string'
  ||!/^[0-9a-f]{64}$/.test(trades.ledgerRevision)
  ||!Array.isArray(trades.trades)||trades.trades.length<1||trades.trades.length>5000)
  fail('TRADE_LEDGER_UNVERIFIED');
 const seen=new Set();
 for(const trade of trades.trades){
  if(!trade||typeof trade!=='object'||Array.isArray(trade)
   ||typeof trade.id!=='string'||!ID.test(trade.id)||seen.has(trade.id))
   fail('TRADE_ID_INVALID');
  seen.add(trade.id);
 }
 const holdings=await read('getHoldings');
 if(!Array.isArray(holdings.holdings)||!holdings.holdings.length||
   holdings.holdings.length>10000)fail('HOLDINGS_READ_UNVERIFIED');
 return {kind:'ISSUE734_POSTMIGRATION_LIVE_READONLY',status:'READ_VERIFIED',
  ledgerProtocol:2,tradeRows:trades.trades.length,uniqueIds:seen.size,
  holdingsRows:holdings.holdings.length,liveReadRequests:2,
  mobileBrowserE2EVerified:false,tradeCrudE2EVerified:false,
  financialWrites:0,gasDeployments:0,telegramSends:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await inspectIssue734LiveProtocol({
  url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
 })));}catch(e){const m=String(e?.message||'');
  console.error(/^ISSUE734_POSTMIGRATION_[A-Z0-9_]+$/.test(m)?
    m:'ISSUE734_POSTMIGRATION_UNVERIFIED');process.exitCode=1;}
}
