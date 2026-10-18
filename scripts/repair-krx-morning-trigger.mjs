#!/usr/bin/env node
// One-shot operational trigger registration via the existing v9.235
// authenticated getPrices(persist=0) self-heal path. Price history, Snapshot,
// holdings, NAV and trades are not written. Never print URL/token/price payload.
import { validateWebAppUrl } from './diagnose-krx-operational.mjs';

const REQUIRED=['closeCount','watchdogCount','backfillCount',
  'historicalBackfillCount','midnightBackfillCount'];
const VERSION='9.236';
export function checkStatus(body,{requireMorning=false}={}) {
  const a=body?.automation, t=a?.trigger;
  if(body?.status!=='ok'||body.gasVersion!==VERSION
    ||a?.gasVersion!==VERSION||!t||typeof t!=='object'
    ||REQUIRED.some(k=>t[k]!==1)
    ||t.hasLegacySplitTriggers===true)
    throw Error('KRX_MORNING_RUNTIME_BASELINE_UNVERIFIED');
  if(!Number.isSafeInteger(t.morningBackfillCount)
    ||typeof t.hasMorningBackfill!=='boolean'
    ||typeof t.hasDuplicateMorningBackfillTriggers!=='boolean')
    throw Error('KRX_MORNING_TRIGGER_SCHEMA_INVALID');
  if(requireMorning &&
    (t.morningBackfillCount!==1||t.hasMorningBackfill!==true||
      t.hasDuplicateMorningBackfillTriggers!==false))
    throw Error('KRX_MORNING_TRIGGER_NOT_REGISTERED');
  return {gasVersion:a.gasVersion,morningCount:t.morningBackfillCount,
    morningExists:t.hasMorningBackfill,
    duplicate:t.hasDuplicateMorningBackfillTriggers};
}
export async function operate({url,token,fetchImpl=fetch}) {
  const endpoint=validateWebAppUrl(url);
  if(!token||typeof token!=='string')throw Error('KRX_MORNING_AUTH_UNAVAILABLE');
  const request=async(action,fields={},authToken=token)=>{
    if(!['getAutomationStatus','getPrices'].includes(action))
      throw Error('KRX_MORNING_FORBIDDEN_ACTION');
    if(action==='getPrices'&&(fields.codes!=='005930'||fields.persist!=='0'))
      throw Error('KRX_MORNING_PERSIST_FORBIDDEN');
    let response;
    try {
      response=await fetchImpl(endpoint,{
        method:'POST',redirect:'follow',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({action,accessToken:authToken,...fields}),
        signal:AbortSignal.timeout(180000)
      });
    } catch { throw Error('KRX_MORNING_NETWORK_UNVERIFIED'); }
    if(!response?.ok)throw Error('KRX_MORNING_HTTP_UNVERIFIED');
    try{return await response.json();}
    catch{throw Error('KRX_MORNING_JSON_UNVERIFIED');}
  };
  const denied=await request('getAutomationStatus',{},
    'KRX_MORNING_NEGATIVE_AUTH_PROBE');
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('KRX_MORNING_AUTH_NOT_ENFORCED');
  const before=checkStatus(await request('getAutomationStatus'));
  if(before.morningExists&&before.morningCount===1&&!before.duplicate)
    return {mode:'ALREADY_REGISTERED',gasVersion:VERSION,
      morningBackfillCount:1,priorNightlyTriggersIntact:true,pricePersisted:false};
  // The already deployed production function calls _ensureDailyTriggersOncePerDay
  // before price fetching. 'persist=0' prohibits PRICE/Snapshot writes. The
  // returned prices and provider errors are never logged.
  let priceRequestStatus='ok';
  try {
    const data=await request('getPrices',{codes:'005930',persist:'0'});
    if(data?.status!=='ok')priceRequestStatus='provider_unavailable';
  } catch { priceRequestStatus='provider_unavailable'; }
  const after=checkStatus(await request('getAutomationStatus'),{requireMorning:true});
  return {mode:'TRIGGER_REGISTERED',gasVersion:VERSION,
    previousMorningBackfillCount:before.morningCount,
    morningBackfillCount:after.morningCount,
    priorNightlyTriggersIntact:true,
    pricePersisted:false,
    priceRequestStatus};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    const result=await operate({url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(result));
  } catch(error) {
    const code=String(error?.message||'');
    console.error(/^KRX_MORNING_[A-Z_]+$/.test(code)?code:'KRX_MORNING_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
