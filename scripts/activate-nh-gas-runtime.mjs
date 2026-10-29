import {pathToFileURL} from 'node:url';
export function selectNhReadbackCodes(codes){
  if(!Array.isArray(codes)||codes.length>20000)throw Error('NH_RUNTIME_CODE_MASTER_INVALID');
  const seen=new Set(),domestic=[],overseas=[];
  for(const item of codes){
    if(typeof item?.code!=='string')throw Error('NH_RUNTIME_CODE_MASTER_INVALID');
    const code=item.code.trim().toUpperCase();
    if(seen.has(code))throw Error('NH_RUNTIME_CODE_MASTER_DUPLICATE');seen.add(code);
    const type=String(item.type||'').trim().toUpperCase(),market=String(item.market||'').trim().toUpperCase();
    if(!['STOCK','주식','ETF'].includes(type))continue;
    if(item.currency==='KRW'&&/^[A-Z0-9]{6}$/.test(code))domestic.push(code);
    if(item.currency==='USD'&&['','US','USA','NYSE','NASDAQ','AMEX','OTC'].includes(market)&&/^[A-Z][A-Z0-9.\-]{0,11}$/.test(code))overseas.push(code);
  }
  if(!domestic.length||!overseas.length)throw Error('NH_RUNTIME_CODE_TARGETS_MISSING');
  return [domestic.includes('005930')?'005930':domestic[0],overseas.includes('AAPL')?'AAPL':overseas[0]];
}
export async function activateNhRuntime({url,token,key,secret,request=fetch}={}) {
  let endpoint;try{endpoint=new URL(url);}catch{throw Error('NH_RUNTIME_GAS_URL_MISSING');}
  if(endpoint.protocol!=='https:'||endpoint.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname)||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw Error('NH_RUNTIME_GAS_URL_INVALID');
  if(!token)throw Error('NH_RUNTIME_GAS_AUTH_NOT_CONFIGURED');
  const call=async(action,accessToken=token,data)=>{
    let result;
    try{const response=await request(endpoint.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,accessToken,...(data?{data:JSON.stringify(data)}:{})}),redirect:'follow',signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error();result=await response.json();}catch{throw Error('NH_RUNTIME_GAS_REQUEST_FAILED');}
    return result;
  };
  const denied=await call('getSettings',token+'-DENY-PROBE');
  if(denied?.status!=='error')throw Error('NH_RUNTIME_GAS_AUTH_NOT_ENFORCED');
  const before=await call('getSettings');
  if(before?.status!=='ok'||before.gasVersion!=='9.276')throw Error('NH_RUNTIME_GAS_VERSION_MISMATCH');
  if(!before.settings?.apiKeyStatus?.nh?.enabled){
    if(!key||!secret)throw Error('NH_RUNTIME_KEYS_NOT_CONFIGURED');
    const saved=await call('saveNhConfig',token,{key,secret});
    if(saved?.status!=='ok'||saved.nh?.enabled!==true)throw Error('NH_RUNTIME_ACTIVATION_UNCONFIRMED');
  }
  const master=await call('getCodeListReadOnly');
  if(master?.status!=='ok'||master.readOnly!==true||master.gasVersion!=='9.276')throw Error('NH_RUNTIME_CODE_MASTER_UNCONFIRMED');
  const codes=selectNhReadbackCodes(master.codes);
  // No price-history / Snapshot write. Confirm the live web lookup is NH.
  let prices;
  try{const response=await request(endpoint.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'getPrices',accessToken:token,codes:codes.join(','),persist:'0'}),redirect:'follow',signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error();prices=await response.json();}catch{throw Error('NH_RUNTIME_READBACK_FAILED');}
  if(prices?.status!=='ok')throw Error('NH_RUNTIME_READBACK_RESPONSE_ERROR');
  if(prices.priceLookup?.currentProvider!=='NH')throw Error('NH_RUNTIME_READBACK_PROVIDER_MISMATCH');
  if(Number(prices.priceLookup.tossResultCount)<codes.length)throw Error('NH_RUNTIME_READBACK_NH_PRICES_MISSING');
  if(codes.some(code=>!(Number(prices.prices?.[code])>0)))throw Error('NH_RUNTIME_READBACK_PRICE_MISSING');
  return {status:'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED',sampleCount:2,gasVersion:'9.276',fullCoverageVerified:false,closeVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('NH_RUNTIME_MAIN_REQUIRED');
    console.log(JSON.stringify(await activateNhRuntime({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET})));
  }catch(error){console.error(/^NH_RUNTIME_[A-Z_]+$/.test(error?.message||'')?error.message:'NH_RUNTIME_FAILED');process.exitCode=1;}
}
