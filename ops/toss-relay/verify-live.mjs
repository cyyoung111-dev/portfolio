#!/usr/bin/env node
// Run ON the VM as root with BOTH domain and expected OCI Reserved Public IP.
// The TLS socket is pinned to the expected IP; a DNS rebind cannot leak the
// private relay key to another valid HTTPS server. No key/quote is logged.
import fs from 'node:fs';
import https from 'node:https';
import dns from 'node:dns/promises';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';

const ALLOWED_FAILURES=new Set(['ip-not-allowed','forbidden','edge-blocked','UNKNOWN_403',
  'UNAUTHORIZED','RATE_LIMITED','UPSTREAM_UNAVAILABLE','UPSTREAM_ERROR',
  'TOSS_OAUTH_IP_NOT_ALLOWED','TOSS_OAUTH_UNKNOWN_403','TOSS_OAUTH_UNAUTHORIZED',
  'TOSS_OAUTH_UPSTREAM_UNAVAILABLE','TOSS_OAUTH_RATE_LIMITED']);
const BODY=JSON.stringify({action:'prices',params:{symbols:'005930'}});
function hostValid(host){return /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(host)
  && host.includes('.')&&!host.includes('..')&&isIP(host)===0;}
function publicV4(ip){
  if(isIP(ip)!==4)return false;
  const n=ip.split('.').map(Number);
  return n[0]>0&&n[0]<224&&n[0]!==10&&n[0]!==127
    &&n[0]!==169&&!(n[0]===172&&n[1]>=16&&n[1]<=31)
    &&!(n[0]===192&&n[1]===168)&&!(n[0]===100&&n[1]>=64&&n[1]<=127);
}
// The actual Node socket resolver (not merely a preflight DNS check).
// Handle Node >=22's options.all=true callback contract as well.
export function pinnedLookup(ip){
  return (_name,options,done)=>options?.all===true
    ? done(null,[{address:ip,family:4}]) : done(null,ip,4);
}
// IP fixed for the actual TCP socket, domain retained for Host + TLS SNI and
// certificate verification. Never use a redirect or an untrusted IP response.
export function pinnedPost({host,ip,sharedKey='',transport=https,timeoutMs=26000}){
  if(!hostValid(host)||!publicV4(ip))return Promise.reject(Error('PINNED_TARGET_INVALID'));
  return new Promise((resolve,reject)=>{
    const headers={'content-type':'application/json','content-length':Buffer.byteLength(BODY)};
    if(sharedKey)headers['x-relay-key']=sharedKey;
    const req=transport.request({
      protocol:'https:',hostname:host,servername:host,port:443,path:'/v1/fetch',
      method:'POST',headers,agent:false,rejectUnauthorized:true,
      // Node >=22 defaults to auto address-family selection; explicitly lock
      // IPv4 and support both lookup(all) callback shapes without DNS fallback.
      family:4,autoSelectFamily:false,
      lookup:pinnedLookup(ip)
    },response=>{
      let raw='',bytes=0;
      response.on('data',chunk=>{
        bytes+=chunk.length;
        if(bytes>384*1024){req.destroy(Error('RELAY_RESPONSE_TOO_LARGE'));return;}
        raw+=chunk.toString('utf8');
      });
      response.once('error',reject);
      response.once('end',()=>{
        let body={};
        try{body=JSON.parse(raw)}catch{return reject(Error('RELAY_INVALID_RESPONSE'))}
        resolve({status:response.statusCode,data:body});
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Error('RELAY_TIMEOUT')));
    req.once('error',reject);
    req.end(BODY);
  });
}
export async function verifyLive({host,ip,key,lookupDns=()=>dns.resolve4(host),post=pinnedPost}){
  if(!hostValid(host)||!publicV4(ip))throw Error('PINNED_TARGET_INVALID');
  let dnsA;
  try{dnsA=await lookupDns()}catch{throw Error('DNS_LOOKUP_FAILED')}
  if(!Array.isArray(dnsA)||!dnsA.includes(ip))throw Error('DNS_TARGET_MISMATCH');
  const unauth=await post({host,ip,sharedKey:'',timeoutMs:18000});
  if(unauth.status!==401||unauth.data?.code!=='UNAUTHORIZED')
    throw Error('PUBLIC_RELAY_AUTH_BYPASS');
  const res=await post({host,ip,sharedKey:key,timeoutMs:26000});
  const data=res.data;
  if(res.status===200&&data?.ok===true&&data?.status===200){
    const rows=data?.data?.result;
    const row=Array.isArray(rows)?rows.find(x=>x.symbol==='005930'):null;
    if(!(Number(row?.lastPrice)>0)||!row?.timestamp)throw Error('TOSS_PRICE_DATE_UNVERIFIED');
    return {mode:'RELAY_LIVE_SMOKE',result:'PASS',unauthorizedProtected:true,
      requestedCode:'005930',positivePrice:true,timestampPresent:true,
      providerStatus:200,marketDateVerification:'NOT_A_FINAL_CLOSE_PROOF'};
  }
  const code=String(data?.code||'');
  return {mode:'RELAY_LIVE_SMOKE',result:'FAIL',unauthorizedProtected:true,
    upstreamStatus:Number.isInteger(data?.status)?data.status:null,
    failureCode:ALLOWED_FAILURES.has(code)?code:'UNCLASSIFIED',
    noCredentialsOrMarketValuesLogged:true};
}
async function main(){
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  const host=String(process.env.TOSS_RELAY_DOMAIN||'');
  const ip=String(process.env.TOSS_RESERVED_IP||'');
  if(!hostValid(host)||!publicV4(ip))throw Error('PINNED_TARGET_INVALID');
  const contents=fs.readFileSync('/etc/toss-relay/env','utf8');
  const key=contents.split(/\r?\n/).find(x=>x.startsWith('TOSS_RELAY_SHARED_KEY='))?.slice(22).trim();
  if(!key||!/^[A-Za-z0-9_+/=-]{32,512}$/.test(key))throw Error('PRIVATE_SHARED_KEY_INVALID');
  const result=await verifyLive({host,ip,key});
  console.log(JSON.stringify(result));
  if(result.result!=='PASS')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await main()}catch(e){
    const code=String(e?.message||'');
    console.error(JSON.stringify({mode:'RELAY_LIVE_SMOKE',result:'FAIL',
      errorCode:/^(?:ROOT_REQUIRED|PINNED_TARGET_INVALID|DNS_LOOKUP_FAILED|DNS_TARGET_MISMATCH|PRIVATE_SHARED_KEY_INVALID|PUBLIC_RELAY_AUTH_BYPASS|RELAY_INVALID_RESPONSE|TOSS_PRICE_DATE_UNVERIFIED|RELAY_RESPONSE_TOO_LARGE|RELAY_TIMEOUT)$/.test(code)?code:'RELAY_CHECK_FAILED'}));
    process.exitCode=1;
  }
}
