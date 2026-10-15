#!/usr/bin/env node
// Toss market-data-only relay for a single-public-IPv4 VM. No orders, accounts or assets.
// TLS terminates at Caddy; this Node listener MUST remain on 127.0.0.1.
// GAS integration remains opt-in and is intentionally NOT changed by this pilot PR.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOSS_ORIGIN='https://openapi.tossinvest.com';
const ALLOWED_MARKETS=new Set(['KR','US']);
const ALLOWED_INDICES=new Set(['KOSPI','KOSDAQ']);
const MAX_BODY_BYTES=4096;
const MAX_UPSTREAM_BYTES=384*1024;
const GET_TIMEOUT_MS=18000;
const TOKEN_TIMEOUT_MS=12000;

function reject(code, status=400) {const e=new Error(code);e.code=code;e.status=status;return e;}
function scalar(value,pattern,maxLength=120){
  if(typeof value!=='string'||value.length>maxLength||!pattern.test(value))throw reject('INVALID_REQUEST');
  return value;
}
const SYMBOL=/^[A-Z0-9_.:-]{1,32}$/;
const BEFORE=/^[A-Za-z0-9_.:+/=-]{1,256}$/;
function buildTossPath(action, p){
  if(!p || typeof p!=='object'||Array.isArray(p))throw reject('INVALID_REQUEST');
  const q=new URLSearchParams();
  let route;
  let allowed;
  switch(action){
    case 'prices': {
      const symbols=scalar(p.symbols,/^[A-Za-z0-9_.:,-]{1,4096}$/,4096).toUpperCase().split(',');
      if(symbols.length>200||new Set(symbols).size!==symbols.length||symbols.some(x=>!SYMBOL.test(x)))throw reject('INVALID_SYMBOLS');
      route='/api/v1/prices';q.set('symbols',symbols.join(','));allowed=['symbols'];break;
    }
    case 'candles':
      route='/api/v1/candles';q.set('symbol',scalar(p.symbol,SYMBOL));
      if(p.interval!==undefined&&p.interval!=='1d')throw reject('INVALID_REQUEST');
      q.set('interval','1d');
      const count=p.count===undefined?200:Number(p.count);
      if(!Number.isInteger(count)||count<1||count>200)throw reject('INVALID_REQUEST');
      q.set('count',String(count));
      if(p.before!==undefined&&p.before!=='')q.set('before',scalar(p.before,BEFORE,256));
      if(p.adjusted!==undefined&&p.adjusted!=='false')throw reject('INVALID_REQUEST');
      q.set('adjusted','false');allowed=['symbol','interval','count','before','adjusted'];break;
    case 'exchangeRate':
      route='/api/v1/exchange-rate';q.set('baseCurrency','USD');q.set('quoteCurrency','KRW');
      allowed=[];break;
    case 'calendar':{
      const market=scalar(p.market,/^(KR|US)$/);
      if(!ALLOWED_MARKETS.has(market))throw reject('INVALID_REQUEST');
      route='/api/v1/market-calendar/'+market;
      q.set('date',scalar(p.date,/^\d{4}-\d{2}-\d{2}$/));allowed=['market','date'];break;
    }
    case 'indicatorPrices': {
      route='/api/v1/market-indicators/prices';
      const indices=p.symbols===undefined?['KOSPI','KOSDAQ']:
        scalar(p.symbols,/^(KOSPI|KOSDAQ)(,(KOSPI|KOSDAQ))?$/).split(',');
      if(new Set(indices).size!==indices.length)throw reject('INVALID_REQUEST');
      q.set('symbols',indices.join(','));allowed=['symbols'];break;
    }
    case 'indicatorCandles':{
      const index=scalar(p.index,/^(KOSPI|KOSDAQ)$/);
      if(!ALLOWED_INDICES.has(index))throw reject('INVALID_REQUEST');
      route='/api/v1/market-indicators/'+index+'/candles';
      if(p.interval!==undefined&&p.interval!=='1d')throw reject('INVALID_REQUEST');
      q.set('interval','1d');
      const count=p.count===undefined?200:Number(p.count);
      if(!Number.isInteger(count)||count<1||count>200)throw reject('INVALID_REQUEST');
      q.set('count',String(count));
      if(p.before!==undefined&&p.before!=='')q.set('before',scalar(p.before,BEFORE,256));
      allowed=['index','interval','count','before'];break;
    }
    default:throw reject('ROUTE_NOT_ALLOWED',403);
  }
  if(Object.keys(p).some(key=>!allowed.includes(key)))throw reject('INVALID_REQUEST');
  return route+'?'+q.toString();
}
function errorCode(body,status){
  if(status===403){
    const err=body?.error;
    const c=typeof err==='string'?err:(err && typeof err==='object'?err.code:body?.code);
    return ['ip-not-allowed','forbidden','edge-blocked'].includes(c)?c:'UNKNOWN_403';
  }
  return status===401?'UNAUTHORIZED':status===429?'RATE_LIMITED':status>=500?'UPSTREAM_UNAVAILABLE':'UPSTREAM_ERROR';
}
async function readJsonLimited(response,limit){
  // Bound memory while reading, not after downloading the entire upstream body.
  const reader=response.body?.getReader();
  if(!reader)throw reject('UPSTREAM_INVALID_JSON',502);
  const chunks=[];let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>limit)throw reject('UPSTREAM_RESPONSE_TOO_LARGE',502);
      chunks.push(Buffer.from(value));
    }
  }catch(e){
    try{await reader.cancel()}catch{}
    // A broken upstream response stream is an upstream transport failure,
    // not an application/internal error. Preserve deliberate size/JSON guards.
    if (e?.code === 'UPSTREAM_RESPONSE_TOO_LARGE') throw e;
    throw reject('UPSTREAM_UNAVAILABLE',502);
  }finally{reader.releaseLock()}
  try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'))}
  catch{throw reject('UPSTREAM_INVALID_JSON',502)}
}
async function doRequest(fetchImpl,url,options,timeout){
  try{return await fetchImpl(url,{...options,signal:AbortSignal.timeout(timeout),redirect:'error'})}
  catch {throw reject('UPSTREAM_UNAVAILABLE',502)}
}
export function createTossRelay({clientId,clientSecret,sharedKey,fetchImpl=fetch,clock=Date.now}){
  if(!clientId||!clientSecret||!sharedKey||sharedKey.length<32)throw reject('RELAY_NOT_CONFIGURED',503);
  const keyHash=createHash('sha256').update(sharedKey).digest();
  let cached=null, inFlight=null;
  function authorized(key){
    const hash=createHash('sha256').update(String(key||'')).digest();
    return timingSafeEqual(keyHash,hash);
  }
  async function issueToken(){
    const body=new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret});
    const response=await doRequest(fetchImpl,TOSS_ORIGIN+'/oauth2/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body
    },TOKEN_TIMEOUT_MS);
    if(!response.ok){
      let failure={};
      if(response.status===403){
        try{failure=await readJsonLimited(response,32768)}
        catch(e){if(e?.code!=='UPSTREAM_INVALID_JSON')throw e}
      }else{
        try{await response.body?.cancel?.()}catch{}
      }
      throw reject('TOSS_OAUTH_'+errorCode(failure,response.status),502);
    }
    const result=await readJsonLimited(response,32768);
    if(result?.token_type!=='Bearer'||typeof result.access_token!=='string'
       ||!result.access_token||!(Number(result.expires_in)>0))
      throw reject('TOSS_OAUTH_INVALID_RESPONSE',502);
    cached={value:result.access_token,expires:clock()+Math.min(21600,Number(result.expires_in))*1000-60000};
    return cached.value;
  }
  async function token(){
    if(cached && cached.expires>clock())return cached.value;
    if(inFlight)return inFlight;
    inFlight=issueToken().finally(()=>{inFlight=null});
    return inFlight;
  }
  async function tossGet(path){
    let access=await token();
    for(let attempt=0;attempt<2;attempt++){
      const response=await doRequest(fetchImpl,TOSS_ORIGIN+path,{
        method:'GET',headers:{Authorization:'Bearer '+access,Accept:'application/json'}
      },GET_TIMEOUT_MS);
      // Authorization status is authoritative even when an intermediary replies with HTML/empty body.
      // Do not decode 401 as JSON before the single conditional token refresh.
      if(response.status===401){
        try { await response.body?.cancel?.(); } catch {}
        if(attempt===0){
          if(cached?.value===access)cached=null;
          access=await token();continue;
        }
        return {ok:false,status:401,code:'UNAUTHORIZED'};
      }
      // HTTP status is authoritative: 403/429/5xx must survive empty or HTML upstream bodies.
      if(!response.ok){
        let failure={};
        if(response.status===403){
          try{failure=await readJsonLimited(response,MAX_UPSTREAM_BYTES)}
          catch(e){if(e?.code!=='UPSTREAM_INVALID_JSON')throw e}
        }else{
          try{await response.body?.cancel?.()}catch{}
        }
        return {ok:false,status:response.status,code:errorCode(failure,response.status)};
      }
      const data=await readJsonLimited(response,MAX_UPSTREAM_BYTES);
      return {ok:true,status:response.status,data};
    }
    return {ok:false,status:401,code:'UNAUTHORIZED'};
  }
  async function handler(req,res){
    res.setHeader('cache-control','no-store');
    res.setHeader('content-type','application/json; charset=utf-8');
    function reply(code,body){res.writeHead(code);res.end(JSON.stringify(body));}
    if(req.method==='GET'&&req.url==='/healthz'){reply(200,{ok:true,relay:'toss-market-data',credentials:false});return;}
    if(req.url!=='/v1/fetch'||req.method!=='POST'){reply(404,{ok:false,code:'NOT_FOUND'});return;}
    if(!authorized(req.headers['x-relay-key'])){
      reply(401,{ok:false,code:'UNAUTHORIZED'});return;
    }
    let raw='';
    try{
      for await(const chunk of req){
        raw+=chunk.toString('utf8');
        if(Buffer.byteLength(raw)>MAX_BODY_BYTES)throw reject('REQUEST_TOO_LARGE',413);
      }
      let parsed;
      try{parsed=JSON.parse(raw)}catch{throw reject('INVALID_JSON')}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)
         ||Object.keys(parsed).some(k=>!['action','params'].includes(k)))
        throw reject('INVALID_REQUEST');
      const path=buildTossPath(parsed.action,parsed.params||{});
      const result=await tossGet(path);
      reply(result.ok?200:502,result);
    }catch(e){
      const code=typeof e?.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'INTERNAL_ERROR';
      const status=Number.isInteger(e?.status)?e.status:500;
      reply(status,{ok:false,code});
    }
  }
  return {handler};
}
export function createServer(config){return http.createServer(createTossRelay(config).handler)}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||18761);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');
  const server=createServer({
    clientId:process.env.TOSS_CLIENT_ID,
    clientSecret:process.env.TOSS_CLIENT_SECRET,
    sharedKey:process.env.TOSS_RELAY_SHARED_KEY
  });
  server.listen(port,'127.0.0.1',()=>console.log('Toss read-only relay listening on localhost'));
}
