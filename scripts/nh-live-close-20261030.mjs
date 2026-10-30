import {pathToFileURL} from 'node:url';
import {supportedNhGasVersion} from './nh-gas-version.mjs';
// One-shot production readback: no financial writes or standalone GitHub NH OAuth.
// No secrets, raw response bodies, or request headers may enter stdout.
export function inspectNhCloses(status,diagnostic,emit=()=>{}) {
  if(status?.status!=='ok'||status.provider!=='NH'||status.enabled!==true
    ||status.tokenCached!==true||status.tokenIssued!==false)
    throw Error('NH_LIVE_CACHED_TOKEN_NOT_READY');
  if(diagnostic?.status!=='ok'||diagnostic?.readOnly!==true
    ||diagnostic?.provider!=='NH'||!supportedNhGasVersion(diagnostic?.gasVersion))
    throw Error('NH_LIVE_READONLY_DIAGNOSTIC_INVALID');
  const results=[];
  for(const [code,currency] of [['005930','KRW'],['AAPL','USD']]){
    const row=diagnostic.closes?.[code],date=String(row?.usedDate||'');
    const valid=Boolean(row&&Number(row.price)>0&&Number.isFinite(Number(row.price))
      &&row.currency===currency&&row.source==='NH_REGULAR_CLOSE'
      &&row.status==='CONFIRMED'&&row.priceType==='REGULAR_CLOSE'
      &&row.marketDate===date&&/^\d{4}-\d{2}-\d{2}$/.test(date));
    const result=valid?{status:'NH_REGULAR_CLOSE_VERIFIED',code,price:Number(row.price),currency,
      marketDate:date,source:'NH_REGULAR_CLOSE',officialExchangeClose:false}
      :{status:'NH_REGULAR_CLOSE_MISSING',code,marketDate:null};
    emit(result);results.push(result);
  }
  return {total:results.length,confirmed:results.filter(r=>r.status==='NH_REGULAR_CLOSE_VERIFIED').length,
    fullHoldingsVerified:false,quotesConnected:diagnostic.quotesConnected===true};
}
function endpoint(url) {
  let u;try{u=new URL(url);}catch{throw Error('NH_LIVE_GAS_URL_INVALID');}
  if(u.protocol!=='https:'||u.hostname!=='script.google.com'
    ||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname)||u.search||u.hash||u.username||u.password)
    throw Error('NH_LIVE_GAS_URL_INVALID');
  return u.href;
}
async function main() {
  if(process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio'
    ||process.env.GITHUB_REF!=='refs/heads/main'
    ||process.env.GITHUB_EVENT_NAME!=='push'
    ||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('NH_LIVE_MAIN_ONLY');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(today!=='2026-10-30')throw Error('NH_LIVE_DATE_WINDOW_CLOSED');
  const url=endpoint(process.env.GAS_WEB_APP_URL),accessToken=process.env.GAS_ACCESS_TOKEN;
  if(!accessToken)throw Error('NH_LIVE_GAS_AUTH_MISSING');
  const post=async(action)=>{
    let response;
    try{
      response=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({action,accessToken}),redirect:'follow',signal:AbortSignal.timeout(90000)});
    }catch{throw Error('NH_LIVE_GAS_REQUEST_FAILED');}
    if(!response.ok)throw Error('NH_LIVE_GAS_HTTP_FAILED');
    try{return await response.json();}catch{throw Error('NH_LIVE_GAS_JSON_FAILED');}
  };
  const status=await post('getNhAuthStatusProxy');
  // Warm bearer is a prerequisite. GAS may centrally renew a token if NH returns 401;
  // this is NOT a zero-issuance guarantee, and no GitHub-side OAuth is attempted.
  if(status?.status!=='ok'||status.tokenCached!==true)throw Error('NH_LIVE_CACHED_TOKEN_NOT_READY');
  const diagnostic=await post('diagnoseNhMarketData');
  const result=inspectNhCloses(status,diagnostic,row=>console.log(JSON.stringify(row)));
  console.log(JSON.stringify({status:'NH_LIVE_CLOSE_SAMPLE_SUMMARY',...result}));
  if(result.confirmed!==2)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{console.error(/^NH_LIVE_[A-Z_]+$/.test(e?.message||'')?e.message:'NH_LIVE_FAILED');process.exitCode=1;});
}
