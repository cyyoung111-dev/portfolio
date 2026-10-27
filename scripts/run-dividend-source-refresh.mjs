import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {pathToFileURL} from 'node:url';
export async function runDividendRefresh({url:rawUrl,token,fetchImpl=fetch,asOf=new Date()}) {
const url=validateWebAppUrl(rawUrl);
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(asOf);
async function call(action,args={},access=token) {
 let r;
 try{r=await fetchImpl(url,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,...args,accessToken:access||''}),signal:AbortSignal.timeout(300000)});}catch{throw Error('DIVIDEND_REQUEST_UNCERTAIN_VERIFY_BEFORE_RETRY');}
 if(!r.ok)throw Error('DIVIDEND_HTTP_UNCERTAIN_VERIFY_BEFORE_RETRY');
 try{return await r.json();}catch{throw Error('DIVIDEND_JSON_UNCERTAIN_VERIFY_BEFORE_RETRY');}
}
 if(!token)throw Error('DIVIDEND_AUTH_REQUIRED');
 const deny=await call('getDividendSettings',{},'DIVIDEND_BAD_AUTH_PROBE');
 if(deny.status==='ok')throw Error('DIVIDEND_AUTH_NOT_ENFORCED');
 const state=await call('getAutomationStatus');
 if(state.status!=='ok'||state.gasVersion!=='9.272')throw Error('DIVIDEND_VERSION');
 const refreshed=await call('refreshEtfDividends',{force:'1'});
 if(refreshed.status!=='ok'||(!(refreshed.saved===true&&refreshed.refreshed===true)&&!(refreshed.skipped===true&&refreshed.reason==='NO_TARGETS')))throw Error('DIVIDEND_ETF_REFRESH_FAILED');
 const etfCodes=refreshed.targetCodes;
 if(!Array.isArray(etfCodes)||etfCodes.length!==refreshed.targetCount||new Set(etfCodes).size!==etfCodes.length||etfCodes.some(code=>! /^[A-Z0-9]{6}$/.test(String(code))))throw Error('DIVIDEND_ETF_TARGETS_INVALID');
 let cached=await call('getDividendSettings');
 if(cached.status!=='ok'||!cached.divData)throw Error('DIVIDEND_READBACK_FAILED');
 const catalog=await call('getCodeListReadOnly');
 if(catalog.status!=='ok'||catalog.readOnly!==true||catalog.gasVersion!=='9.272'||!Array.isArray(catalog.codes)) {
  const reason=['CODE_LIST_READ_ONLY_BUSY','CODE_LIST_READ_ONLY_PENDING','CODE_LIST_READ_ONLY_FAILED'].includes(catalog.message)?catalog.message:'READ_FAILED';
  throw Error('DIVIDEND_MASTER_'+reason);
 }
 const checked=etfCodes.filter(code=>{const x=cached.divData[code];return x&&(String(x.updatedAt||'').slice(0,10)===date||String(x.providerCheckedAt||'').slice(0,10)===date);});
 if(checked.length!==etfCodes.length)throw Error('DIVIDEND_ETF_READBACK_INCOMPLETE');
 const stocks=catalog.codes.filter(c=>/^\d{6}$/.test(String(c.code))&&!['ETF','TDF','펀드','FUND'].includes(String(c.type||c.assetType).toUpperCase()));
 let stockUpdated=0,stockNoEvents=0,stockManual=0,stockUnverified=stocks.length,stockKeyConfigured=catalog.publicDataApiKeyConfigured===true;
 if(stockKeyConfigured&&stocks.length){
  const pub=await call('dividendPublic',{codes:stocks.map(c=>c.code).join(','),names:stocks.map(c=>c.name).join('|')});
  if(pub.status!=='ok'||!pub.dividends)throw Error('DIVIDEND_PUBLIC_REQUEST_FAILED');
  const patch={};
  for(const c of stocks){const x=pub.dividends[c.code],old=cached.divData[c.code];
   if(String(old?.source).toUpperCase()==='MANUAL'){stockManual++;continue;}
   const retry=pub.diagnostics?.retry?.[c.code];
   const source=retry?.returnedRows>0?retry:pub.diagnostics?.dividend?.[c.code];
   if(source?.status==='OK'&&x?.source==='PUBLIC_DATA'&&Number(x.perShare)>0&&Array.isArray(x.events)&&x.events.length&&x.events.every(e=>Number(e.amount)>0&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.date))))patch[c.code]={...old,...x,updatedAt:new Date().toISOString(),refreshState:'VERIFIED'};
  }
  for(const c of stocks){
   if(patch[c.code]||String(cached.divData[c.code]?.source).toUpperCase()==='MANUAL')continue;
   const retry=pub.diagnostics?.retry?.[c.code];
   const source=retry?.returnedRows>0?retry:pub.diagnostics?.dividend?.[c.code];
   const n=pub.diagnostics?.normalized?.[c.code];
   // A complete successful response with no positive in-range events is not a provider failure.
   // Keep old amounts/events; this does not assert that the company never pays dividends.
   if(['OK','NO_ROWS'].includes(source?.status)&&n?.acceptedEvents===0&&n.inputRows===source.returnedRows&&
      n.rejected?.identity===0&&n.rejected?.date===0)stockNoEvents++;
  }
  stockUpdated=Object.keys(patch).length;stockUnverified=stocks.length-stockUpdated-stockNoEvents-stockManual;
  if(stockUpdated){
   const saved=await call('saveDividendSettings',{data:JSON.stringify(patch)});
   if(saved.status!=='ok'||saved.saved!==true)throw Error('DIVIDEND_STOCK_SAVE_FAILED');
   const verified=await call('getDividendSettings');
   if(verified.status!=='ok'||Object.keys(patch).some(code=>verified.divData?.[code]?.source!=='PUBLIC_DATA'||JSON.stringify(verified.divData[code].events)!==JSON.stringify(patch[code].events)))throw Error('DIVIDEND_STOCK_READBACK_FAILED');
  }
 }
 return {mode:'VERIFIED_DIVIDEND_REFRESH',etfTargets:etfCodes.length,etfChecked:checked.length,etfNoEventWindows:Number(refreshed.noEventCount||0),historyRows:Number(refreshed.historyRows||0),stockKeyConfigured,stockUpdated,stockNoEvents,stockManual,stockUnverified};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{console.log(JSON.stringify(await runDividendRefresh({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));}catch(e){console.error(/^DIVIDEND_[A-Z_]+$/.test(e?.message||'')?e.message:'DIVIDEND_REFRESH_FAILED');process.exitCode=1;}}
