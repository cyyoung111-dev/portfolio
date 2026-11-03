// 2026-11-03 source-level mobile sanity probe: authenticated GAS financial reads only.
// No raw trade/holding data, private codes or credentials may enter stdout.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const ACTIONS=Object.freeze(['getTrades','getHoldings']);
export function summarizeMobileReads(trades,holdings){
  const validTrades=trades?.status==='ok'&&Array.isArray(trades.trades)&&trades.trades.length>0;
  const validHoldings=holdings?.status==='ok'&&Array.isArray(holdings.holdings)&&holdings.holdings.length>0;
  return {mode:'ISSUE507_MOBILE_REMOTE_READONLY',
    tradeRead:validTrades?'CONFIRMED':'UNVERIFIED',
    holdingRead:validHoldings?'CONFIRMED':'UNVERIFIED',
    remoteReadReady:validTrades&&validHoldings,
    browserFirstLoadVerified:false,mobileDeviceVerified:false,financialWrites:0};
}
export async function probeMobileSources({url,token,fetchImpl=fetch}={}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||token.length<12)throw Error('MOBILE_READONLY_AUTH_MISSING');
  const read=async action=>{
    if(!ACTIONS.includes(action))throw Error('MOBILE_READONLY_ACTION_FORBIDDEN');
    let response;
    try {
      response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({action,accessToken:token}),signal:AbortSignal.timeout(60000)});
    } catch {throw Error('MOBILE_READONLY_NETWORK_UNVERIFIED');}
    if(!response?.ok)throw Error('MOBILE_READONLY_HTTP_UNVERIFIED');
    try{return await response.json();}catch{throw Error('MOBILE_READONLY_RESPONSE_UNVERIFIED');}
  };
  const trades=await read('getTrades');
  const holdings=await read('getHoldings');
  return summarizeMobileReads(trades,holdings);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    if(process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio'
      ||process.env.GITHUB_REF!=='refs/heads/main'
      ||process.env.GITHUB_RUN_ATTEMPT!=='1'
      ||process.env.GITHUB_EVENT_NAME!=='push')
      throw Error('MOBILE_READONLY_MAIN_ONLY');
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(day!=='2026-11-03')throw Error('MOBILE_READONLY_DATE_EXPIRED');
    const result=await probeMobileSources({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(result));
    if(!result.remoteReadReady)process.exitCode=1;
  } catch(e){
    console.error(/^MOBILE_READONLY_[A-Z_]+$/.test(String(e?.message||''))?e.message:'MOBILE_READONLY_UNVERIFIED');
    process.exitCode=1;
  }
}
