import {pathToFileURL} from 'node:url';
export function selectNhReadbackCodes(codes){
  if(!Array.isArray(codes)||codes.length>20000)throw Error('NH_RUNTIME_CODE_MASTER_INVALID');
  const seen=new Set(),domestic=[],overseas=[];
  for(const item of codes){
    if(typeof item?.code!=='string')throw Error('NH_RUNTIME_CODE_MASTER_INVALID');
    const code=item.code.trim().toUpperCase();
    if(seen.has(code))throw Error('NH_RUNTIME_CODE_MASTER_DUPLICATE');seen.add(code);
    const type=String(item.type||'').trim().toUpperCase();
    if(['FUND','펀드','TDF'].includes(type)||/^F\d{5}$/.test(code))continue;
    if(item.currency==='KRW'&&/^[A-Z0-9]{6}$/.test(code))domestic.push(code);
    if(item.currency==='USD'&&/^[A-Z][A-Z0-9.\-]{0,11}$/.test(code))overseas.push(code);
  }
  // Use ONLY registered quoteable codes. Inventing an AAPL fallback for
  // a domestic-only master makes 2/2 success impossible for some accounts.
  const primaryDomestic=domestic.includes('005930')?'005930':domestic[0];
  const primaryOverseas=overseas.includes('AAPL')?'AAPL':overseas[0];
  const selected=[];
  if(primaryDomestic)selected.push(primaryDomestic);
  if(primaryOverseas)selected.push(primaryOverseas);
  if(selected.length===1){
    const sameMarket=primaryDomestic?domestic:overseas;
    const next=sameMarket.find(code=>code!==selected[0]);
    if(next)selected.push(next);
  }
  if(selected.length===0)throw Error('NH_RUNTIME_CODE_MASTER_NO_QUOTE_TARGET');
  return selected;
}
// Only the validated NH-central contract introduced in GAS 9.281+ is supported.
// The exact deployed version must also match the read-only code-master reply.
export function isCompatibleNhGasVersion(value) {
  const match=/^9\.(\d{3,})$/.exec(String(value||''));
  return !!match&&Number(match[1])>=281;
}
export async function activateNhRuntime({url,token,key,secret,request=fetch,report=()=>{},skipReadbackIfActive=false}={}) {
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
  if(before?.status!=='ok'||!isCompatibleNhGasVersion(before.gasVersion))throw Error('NH_RUNTIME_GAS_VERSION_MISMATCH');
  if(!before.settings?.apiKeyStatus?.nh?.enabled){
    if(!key||!secret)throw Error('NH_RUNTIME_KEYS_NOT_CONFIGURED');
    const saved=await call('saveNhConfig',token,{key,secret});
    if(saved?.status!=='ok'||saved.nh?.enabled!==true)throw Error('NH_RUNTIME_ACTIVATION_UNCONFIRMED');
  }
  const retired=await call('retireLegacyMarketData');
  if(retired?.status!=='ok'||retired.retired!==true)throw Error('NH_RUNTIME_LEGACY_CONFIG_CLEANUP_FAILED');
  // On an automatic deploy with NH already active, activation has already
  // been verified by prior deployments. Repeating the price readback after
  // every unrelated commit can trigger unnecessary NH auth/quote requests.
  // Explicit manual deploys still perform full sample verification.
  if(before.settings.apiKeyStatus.nh.enabled===true && skipReadbackIfActive===true){
    return {status:'NH_ALREADY_ACTIVE_NO_TOKEN_REQUEST',sampleCount:0,legacyProviderRemoved:true,
      gasVersion:before.gasVersion,registeredUsTarget:false,fullCoverageVerified:false,closeVerified:false,
      sampleVerificationSkipped:true};
  }
  const master=await call('getCodeListReadOnly');
  if(master?.status!=='ok'||master.readOnly!==true||master.gasVersion!==before.gasVersion||!Array.isArray(master.codes))throw Error('NH_RUNTIME_CODE_MASTER_UNCONFIRMED');
  report({status:'NH_RUNTIME_CODE_MASTER_COUNTS',rows:Array.isArray(master.codes)?master.codes.length:0,krwRows:Array.isArray(master.codes)?master.codes.filter(row=>row?.currency==='KRW').length:0,usdRows:Array.isArray(master.codes)?master.codes.filter(row=>row?.currency==='USD').length:0});
  const codes=selectNhReadbackCodes(master.codes);
  const registeredUsTarget=codes.some(code=>master.codes.some(row=>
    row?.currency==='USD'&&String(row.code||'').trim().toUpperCase()===code));
  // No price-history / Snapshot write. Confirm the live web lookup is NH.
  let prices;
  try{const response=await request(endpoint.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'getPrices',accessToken:token,codes:codes.join(','),persist:'0'}),redirect:'follow',signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error();prices=await response.json();}catch{throw Error('NH_RUNTIME_READBACK_FAILED');}
  if(prices?.status!=='ok')throw Error('NH_RUNTIME_READBACK_RESPONSE_ERROR');
  const providerConfirmed=prices.priceLookup?.currentProvider==='NH';
  const reportedCount=Number(prices.priceLookup?.tossResultCount);
  const positiveReturned=codes.filter(code=>Number.isFinite(Number(prices.prices?.[code]))
    &&Number(prices.prices?.[code])>0).length;
  // Aggregate-only diagnostic: no codes, quotes, tokens or raw replies in logs.
  report({status:'NH_RUNTIME_PRICE_READBACK_COUNTS',requested:codes.length,
    registeredUsTarget,providerConfirmed,
    reportedCount:Number.isSafeInteger(reportedCount)&&reportedCount>=0?reportedCount:null,
    positiveReturned});
  if(!providerConfirmed)throw Error('NH_RUNTIME_READBACK_PROVIDER_MISMATCH');
  if(!Number.isSafeInteger(reportedCount)||reportedCount<codes.length)
    throw Error('NH_RUNTIME_READBACK_NH_PRICES_MISSING');
  if(positiveReturned!==codes.length)throw Error('NH_RUNTIME_READBACK_PRICE_MISSING');
  // At this point exact live NH provider and every sampled price are already
  // confirmed. diagnoseNhMarketData is a *secondary, read-only* deep probe.
  // A GAS six-minute timeout or network timeout in that probe must not
  // retrospectively label a successfully published GAS release as failed.
  // Preserve incomplete coverage explicitly; never claim EOD validation.
  let diagnostic;
  try {
    diagnostic=await call('diagnoseNhMarketData');
  } catch (ignored) {
    report({status:'NH_RUNTIME_DEEP_DIAGNOSTIC_UNAVAILABLE',
      sampleCount:codes.length,providerConfirmed:true,
      reason:'SECONDARY_GAS_READ_TIMEOUT_OR_UNAVAILABLE',
      closeSampleComplete:false,fullCoverageVerified:false});
    return {status:'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED_DIAGNOSTIC_PENDING',
      sampleCount:codes.length,legacyProviderRemoved:true,
      gasVersion:before.gasVersion,registeredUsTarget,
      fullCoverageVerified:false,closeVerified:false,
      deepDiagnosticVerified:false};
  }
  const diagnosticVerified=diagnostic?.status==='ok'&&diagnostic?.readOnly===true;
  report({status:'NH_REGULAR_CLOSE_SAMPLE_READBACK',
    readOnly:diagnostic?.readOnly===true,
    quotesConnected:diagnostic?.quotesConnected===true,
    closes:diagnostic?.closes||{},
    closeSampleComplete:diagnostic?.closeSampleComplete===true,
    fullCoverageVerified:false});
  return {status:diagnosticVerified
      ?'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED'
      :'NH_ACTIVE_SAMPLE_READBACK_CONFIRMED_DIAGNOSTIC_PENDING',
    sampleCount:codes.length,legacyProviderRemoved:true,
    gasVersion:before.gasVersion,registeredUsTarget,
    fullCoverageVerified:false,closeVerified:false,
    deepDiagnosticVerified:diagnosticVerified};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('NH_RUNTIME_MAIN_REQUIRED');
    console.log(JSON.stringify(await activateNhRuntime({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET,skipReadbackIfActive:process.env.NH_RUNTIME_SKIP_READBACK_IF_ACTIVE==='true',report:row=>console.log(JSON.stringify(row))})));
  }catch(error){console.error(/^NH_RUNTIME_[A-Z_]+$/.test(error?.message||'')?error.message:'NH_RUNTIME_FAILED');process.exitCode=1;}
}
