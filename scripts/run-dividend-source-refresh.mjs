import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {pathToFileURL} from 'node:url';
// Explicitly reviewed deployed sources. Do not accept unknown future GAS builds.
const APPROVED_DIVIDEND_GAS = new Set(['9.281','9.282','9.283','9.284','9.285','9.291','9.292','9.293','9.294','9.295','9.296','9.297']);
// An issuer-level public response may contain different share classes for
// one payment. Reject conflicting company-level events without a verified
// share identifier. Existing persisted settings are left unchanged.
export function hasConflictingPublicDividendAmounts(events) {
 const byPayment=new Map();
 for(const e of (Array.isArray(events)?events:[])){
  const d=String(e?.date||'').slice(0,10),p=String(e?.payDate||'').slice(0,10);
  const amount=Number(e?.amount);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!(amount>0))continue;
  const key=d+'|'+p;
  if(!byPayment.has(key))byPayment.set(key,new Set());
  byPayment.get(key).add(amount);
  if(byPayment.get(key).size>1)return true;
 }
 return false;
}

// A company-wide feed might return only the preferred-share amount on a
// later run. Never overwrite a previously verified PUBLIC_DATA payment with
// a different amount for the SAME record/pay date without independent proof.
export function hasChangedVerifiedPublicDividendAmounts(previousEvents, nextEvents) {
 const known=new Map();
 for(const e of (Array.isArray(previousEvents)?previousEvents:[])){
  const d=String(e?.date||'').slice(0,10),p=String(e?.payDate||'').slice(0,10),v=Number(e?.amount);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!(v>0))continue;
  const key=d+'|'+p;
  if(!known.has(key))known.set(key,new Set());
  known.get(key).add(v);
 }
 for(const e of (Array.isArray(nextEvents)?nextEvents:[])){
  const d=String(e?.date||'').slice(0,10),p=String(e?.payDate||'').slice(0,10),v=Number(e?.amount);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!(v>0))continue;
  const old=known.get(d+'|'+p);
  if(old&&!old.has(v))return true;
 }
 return false;
}

export async function runDividendRefresh({url:rawUrl,token,fetchImpl=fetch,asOf=new Date()}) {
const url=validateWebAppUrl(rawUrl);
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(asOf);
async function call(action,args={},access=token,stage=action) {
 // Record the exact failed step, never the URL, body, token or provider response.
 // A lost writer acknowledgement is still uncertain; never retry automatically.
 const fail=reason=>{const e=new Error(reason);e.dividendStage=stage;throw e;};
 let r;
 try{r=await fetchImpl(url,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,...args,accessToken:access||''}),signal:AbortSignal.timeout(300000)});}catch{fail('DIVIDEND_REQUEST_UNCERTAIN_VERIFY_BEFORE_RETRY');}
 if(!r.ok)fail('DIVIDEND_HTTP_UNCERTAIN_VERIFY_BEFORE_RETRY');
 try{return await r.json();}catch{fail('DIVIDEND_JSON_UNCERTAIN_VERIFY_BEFORE_RETRY');}
}
 if(!token)throw Error('DIVIDEND_AUTH_REQUIRED');
 const deny=await call('getDividendSettings',{},'DIVIDEND_BAD_AUTH_PROBE','authProbe');
 if(deny.status==='ok')throw Error('DIVIDEND_AUTH_NOT_ENFORCED');
 const state=await call('getAutomationStatus');
 if(state.status!=='ok'||!APPROVED_DIVIDEND_GAS.has(state.gasVersion))throw Error('DIVIDEND_VERSION');
 const refreshed=await call('refreshEtfDividends',{force:'1'});
 if(refreshed.status!=='ok'||(!(refreshed.saved===true&&refreshed.refreshed===true)&&!(refreshed.skipped===true&&refreshed.reason==='NO_TARGETS')))throw Error('DIVIDEND_ETF_REFRESH_FAILED');
 const etfCodes=refreshed.targetCodes;
 if(!Array.isArray(etfCodes)||etfCodes.length!==refreshed.targetCount||new Set(etfCodes).size!==etfCodes.length||etfCodes.some(code=>! /^[A-Z0-9]{6}$/.test(String(code))))throw Error('DIVIDEND_ETF_TARGETS_INVALID');
 let cached=await call('getDividendSettings',{},token,'etfReadback');
 if(cached.status!=='ok'||!cached.divData)throw Error('DIVIDEND_READBACK_FAILED');
 const catalog=await call('getCodeListReadOnly');
 if(catalog.status!=='ok'||catalog.readOnly!==true||!APPROVED_DIVIDEND_GAS.has(catalog.gasVersion)||!Array.isArray(catalog.codes)) {
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
   if(source?.status==='OK'&&x?.source==='PUBLIC_DATA'&&Number(x.perShare)>0&&Array.isArray(x.events)&&x.events.length&&!hasConflictingPublicDividendAmounts(x.events)&&!(String(old?.source).toUpperCase()==='PUBLIC_DATA'&&hasChangedVerifiedPublicDividendAmounts(old?.events,x.events))&&x.events.every(e=>Number(e.amount)>0&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.date))))patch[c.code]={...old,...x,updatedAt:new Date().toISOString(),refreshState:'VERIFIED'};
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
   const verified=await call('getDividendSettings',{},token,'stockReadback');
   if(verified.status!=='ok'||Object.keys(patch).some(code=>verified.divData?.[code]?.source!=='PUBLIC_DATA'||JSON.stringify(verified.divData[code].events)!==JSON.stringify(patch[code].events)))throw Error('DIVIDEND_STOCK_READBACK_FAILED');
  }
 }
 return {mode:'VERIFIED_DIVIDEND_REFRESH',etfTargets:etfCodes.length,etfChecked:checked.length,etfNoEventWindows:Number(refreshed.noEventCount||0),historyRows:Number(refreshed.historyRows||0),stockKeyConfigured,stockUpdated,stockNoEvents,stockManual,stockUnverified};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){try{console.log(JSON.stringify(await runDividendRefresh({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));}catch(e){console.error(/^DIVIDEND_[A-Z_]+$/.test(e?.message||'')?e.message:'DIVIDEND_REFRESH_FAILED');if(['authProbe','getAutomationStatus','refreshEtfDividends','etfReadback','getCodeListReadOnly','dividendPublic','saveDividendSettings','stockReadback'].includes(e?.dividendStage))console.error('DIVIDEND_FAILED_STAGE='+e.dividendStage);process.exitCode=1;}}
