#!/usr/bin/env node
// Run ON the VM as root: sudo env TOSS_RELAY_DOMAIN=... node ops/toss-relay/verify-live.mjs
// Reads only the private relay key from /etc/toss-relay/env. No key/quote is logged.
import fs from 'node:fs';
import {isIP} from 'node:net';
const ALLOWED_FAILURES=new Set(['ip-not-allowed','forbidden','edge-blocked','UNKNOWN_403',
  'UNAUTHORIZED','RATE_LIMITED','UPSTREAM_UNAVAILABLE','UPSTREAM_ERROR',
  'TOSS_OAUTH_IP_NOT_ALLOWED','TOSS_OAUTH_UNKNOWN_403','TOSS_OAUTH_UNAUTHORIZED',
  'TOSS_OAUTH_UPSTREAM_UNAVAILABLE','TOSS_OAUTH_RATE_LIMITED']);
async function main(){
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  const host=String(process.env.TOSS_RELAY_DOMAIN||'');
  if(!/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(host)||!host.includes('.')||isIP(host))
    throw Error('INVALID_RELAY_DOMAIN');
  const contents=fs.readFileSync('/etc/toss-relay/env','utf8');
  const key=contents.split(/\r?\n/).find(x=>x.startsWith('TOSS_RELAY_SHARED_KEY='))?.slice(22).trim();
  if(!key||!/^[A-Za-z0-9_-]{32,}$/.test(key))throw Error('PRIVATE_SHARED_KEY_INVALID');
  const url='https://'+host+'/v1/fetch';
  const unauth=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'prices',params:{symbols:'005930'}}),
    redirect:'error',signal:AbortSignal.timeout(18000)});
  if(unauth.status!==401)throw Error('PUBLIC_RELAY_AUTH_BYPASS');
  const res=await fetch(url,{method:'POST',headers:{
    'content-type':'application/json','x-relay-key':key
  },body:JSON.stringify({action:'prices',params:{symbols:'005930'}}),
  redirect:'error',signal:AbortSignal.timeout(26000)});
  let data={};
  try{data=await res.json()}catch{throw Error('RELAY_INVALID_RESPONSE')}
  if(res.ok&&data?.ok===true&&data?.status===200){
    const rows=data?.data?.result;
    const row=Array.isArray(rows)?rows.find(x=>x.symbol==='005930'):null;
    if(!(Number(row?.lastPrice)>0)||!row?.timestamp)throw Error('TOSS_PRICE_DATE_UNVERIFIED');
    console.log(JSON.stringify({mode:'RELAY_LIVE_SMOKE',result:'PASS',unauthorizedProtected:true,
      requestedCode:'005930',positivePrice:true,timestampPresent:true,
      providerStatus:200,marketDateVerification:'NOT_A_FINAL_CLOSE_PROOF'}));
    return;
  }
  const c=String(data?.code||'');
  console.log(JSON.stringify({mode:'RELAY_LIVE_SMOKE',result:'FAIL',unauthorizedProtected:true,
    upstreamStatus:Number.isInteger(data?.status)?data.status:null,
    failureCode:ALLOWED_FAILURES.has(c)?c:'UNCLASSIFIED',
    noCredentialsOrMarketValuesLogged:true}));
  process.exitCode=1;
}
try{await main()}catch(e){
  const code=String(e?.message||'');
  console.error(JSON.stringify({mode:'RELAY_LIVE_SMOKE',result:'FAIL',
    errorCode:/^(?:ROOT_REQUIRED|INVALID_RELAY_DOMAIN|PRIVATE_SHARED_KEY_INVALID|PUBLIC_RELAY_AUTH_BYPASS|RELAY_INVALID_RESPONSE|TOSS_PRICE_DATE_UNVERIFIED)$/.test(code)?code:'RELAY_CHECK_FAILED'}));
  process.exitCode=1;
}
