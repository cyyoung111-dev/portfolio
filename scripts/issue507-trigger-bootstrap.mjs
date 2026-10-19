#!/usr/bin/env node
// #507: one-shot, narrowly scoped trigger bootstrap using GAS v9.237's
// existing authenticated, zero-code, persist=0 getPrices self-heal entrypoint.
// No ledger/Snapshot/price/NAV writes and no raw response/secret logs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const EXPECTED_VERSION='9.237';
const NEED=['hasIntegrityEdit','hasLedgerRebuild'];
const OTHER=['hasClean','hasMortgage','hasSave','hasFund','hasClose',
  'hasWatchdog','hasBackfill','hasHistoricalBackfill',
  'hasMidnightBackfill','hasMorningBackfill','hasIntegrityChange'];
const COUNTS=['closeCount','watchdogCount','backfillCount',
  'historicalBackfillCount','midnightBackfillCount','morningBackfillCount'];
const DUPLICATES=['hasDuplicateCloseTriggers','hasDuplicateWatchdogTriggers',
  'hasDuplicateBackfillTriggers','hasDuplicateHistoricalBackfillTriggers',
  'hasDuplicateMidnightBackfillTriggers','hasDuplicateMorningBackfillTriggers'];

// Detect a future change in production code that could turn this harmless
// zero-code probe into a data writer. In that case fail before any network call.
export function assertProductionContract(code) {
  const start=code.indexOf('function handleGetPricesCompat(codesParam, persist)');
  const end=code.indexOf('function _latestDateFromPriceDates',start);
  const impl=code.slice(start,end<0?undefined:end);
  if(start<0||end<start)throw new Error('BOOT_SOURCE_LAYOUT_CHANGED');
  const heal=impl.indexOf('_ensureDailyTriggersOncePerDay(todayStr)');
  const parse=impl.indexOf("codesParam.split(',')");
  if(heal<0||parse<0||heal>parse
      ||!impl.includes('if (reqCodes.length > 0) {')
      ||!impl.includes('if (persist) Object.keys(newItemsByDate)')
      ||!impl.includes('if (persist) _updateTodaySnapshotSource(')
      ||!impl.includes('if (persist && confirmedPersistDates.length)')
      ||!code.includes("params.action === 'getPrices'      && params.codes")
      ||!code.includes("'getPrices', 'dividend'"))
    throw new Error('BOOT_UNSAFE_GETPRICES_CONTRACT');
}

function validatedStatus(payload){
  const a=payload?.automation, t=a?.trigger;
  if(payload?.status!=='ok'||!a||!t||a.gasVersion!==EXPECTED_VERSION
      ||payload.gasVersion!==EXPECTED_VERSION)
    throw new Error('BOOT_VERSION_OR_STATUS_INVALID');
  for(const f of [...OTHER,...NEED,...DUPLICATES,'hasLegacySplitTriggers'])
    if(typeof t[f]!=='boolean')throw new Error('BOOT_TRIGGER_SCHEMA_INVALID');
  for(const f of COUNTS)
    if(!Number.isSafeInteger(t[f])||t[f]<0)
      throw new Error('BOOT_TRIGGER_SCHEMA_INVALID');
  return t;
}

function unrelatedHealthy(t){
  return OTHER.every(f=>t[f]===true)
      && COUNTS.every(f=>t[f]===1)
      && DUPLICATES.every(f=>t[f]===false)
      && t.hasLegacySplitTriggers===false;
}

async function request(url, token, params, fetchImpl) {
  let response;
  try {
    response=await fetchImpl(url,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({accessToken:token,...params}),
      redirect:'follow',
      signal:AbortSignal.timeout(90000)
    });
  }catch { throw new Error('BOOT_REQUEST_FAILED'); }
  if(!response?.ok)throw new Error('BOOT_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('BOOT_RESPONSE_NOT_JSON');}
}

// Only the absence of the *two* newly introduced triggers may be repaired.
// Existing trigger changes, duplicates or ledger/Snapshot data errors are
// independent incidents; never use the general self-heal to mask them.
export async function bootstrap({url,token,apply=false,fetchImpl=fetch,
                                 source=null}){
  assertProductionContract(source??readFileSync('src/gas/apps_script.gs','utf8'));
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('BOOT_TOKEN_MISSING');
  const denied=await request(endpoint,'ISSUE507_INVALID_AUTH_PROBE',
    {action:'getAutomationStatus'},fetchImpl);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw new Error('BOOT_AUTH_NOT_ENFORCED');
  const initial=validatedStatus(await request(endpoint,token,
    {action:'getAutomationStatus'},fetchImpl));
  if(!unrelatedHealthy(initial))throw new Error('BOOT_UNRELATED_TRIGGER_PROBLEM');
  const missing=NEED.filter(f=>!initial[f]);
  if(!missing.length)return{mode:'READ_ONLY',result:'ALREADY_INSTALLED',
    ready:true,initialMissing:0};
  if(!apply)return{mode:'READ_ONLY',result:'READY_FOR_APPLY',
    ready:false,initialMissing:missing.length};
  // codes=' ' is deliberately truthy in doGet, but becomes [] after
  // split/trim/filter. It calls ONLY trigger self-heal and data reads;
  // no Toss/KRX/provider request, trade sync, Snapshot or price persistence.
  const answer=await request(endpoint,token,
    {action:'getPrices',codes:' ',persist:'0'},fetchImpl);
  const q=answer?.priceLookup;
  if(answer?.status!=='ok'||!q||q.requestedCount!==0||
      q.tossAttempted!==false||q.krxExecuted!==false||
      q.googleFinanceExecuted!==false||
      Object.keys(answer?.prices??{}).length!==0||
      !Array.isArray(answer?.missing)||answer.missing.length!==0)
    throw new Error('BOOT_ZERO_CODE_RESPONSE_INVALID');
  const after=validatedStatus(await request(endpoint,token,
    {action:'getAutomationStatus'},fetchImpl));
  if(!unrelatedHealthy(after))throw new Error('BOOT_OTHER_TRIGGERS_CHANGED');
  if(!NEED.every(f=>after[f]))throw new Error('BOOT_INSTALL_NOT_CONFIRMED');
  return{mode:'TRIGGER_INSTALL_ONLY',result:'INSTALLED_AND_VERIFIED',
    ready:true,initialMissing:missing.length};
}

export async function selfTest(){
  const code=readFileSync('src/gas/apps_script.gs','utf8');
  assertProductionContract(code);
  const fakeUrl='https://script.google.com/macros/s/AKfycbxIssue507SafeTest/exec';
  const good={status:'ok',gasVersion:EXPECTED_VERSION,automation:{
    gasVersion:EXPECTED_VERSION,trigger:Object.fromEntries([
      ...OTHER.map(f=>[f,true]),...NEED.map(f=>[f,false]),
      ...COUNTS.map(f=>[f,1]),...DUPLICATES.map(f=>[f,false]),
      ['hasLegacySplitTriggers',false]])}};
  const clone=x=>JSON.parse(JSON.stringify(x));
  const mocked=({old=good,after=null,deny=true,badPrice=false})=>{
    const seen=[];
    const fetchImpl=async (url,init)=>{
      const v=Object.fromEntries(new URLSearchParams(init.body));
      seen.push(v);
      let answer;
      if(v.accessToken!=='VALID')answer=deny
        ?{status:'error',message:'인증 실패'}:clone(good);
      else if(v.action==='getAutomationStatus')
        answer=seen.filter(s=>s.action==='getAutomationStatus'&&s.accessToken==='VALID').length>1
          ?clone(after??old):clone(old);
      else if(v.action==='getPrices')
        answer={status:'ok',prices:{},missing:[],priceLookup:{
          requestedCount:badPrice?1:0,tossAttempted:false,krxExecuted:false,
          googleFinanceExecuted:false}};
      else throw Error('Unexpected action');
      return{ok:true,json:async()=>answer};
    };
    return {seen,fetchImpl};
  };
  const common={url:fakeUrl,token:'VALID',source:code};
  const dry=mocked({});
  const dr=await bootstrap({...common,fetchImpl:dry.fetchImpl});
  assert.equal(dr.result,'READY_FOR_APPLY');
  assert.equal(dry.seen.filter(x=>x.action==='getPrices').length,0);
  const repaired=clone(good);for(const name of NEED)repaired.automation.trigger[name]=true;
  const success=mocked({after:repaired});
  const sr=await bootstrap({...common,apply:true,fetchImpl:success.fetchImpl});
  assert.equal(sr.result,'INSTALLED_AND_VERIFIED');
  const priceCall=success.seen.find(x=>x.action==='getPrices');
  assert.equal(priceCall.codes,' ');
  assert.equal(priceCall.persist,'0');
  assert.equal(success.seen.length,4);
  const noop=mocked({old:repaired});
  assert.equal((await bootstrap({...common,apply:true,fetchImpl:noop.fetchImpl})).result,'ALREADY_INSTALLED');
  assert.equal(noop.seen.some(x=>x.action==='getPrices'),false);
  const unrelated=clone(good);unrelated.automation.trigger.hasBackfill=false;
  await assert.rejects(bootstrap({...common,apply:true,fetchImpl:mocked({old:unrelated}).fetchImpl}),
    /BOOT_UNRELATED_TRIGGER_PROBLEM/);
  await assert.rejects(bootstrap({...common,apply:true,fetchImpl:mocked({deny:false}).fetchImpl}),
    /BOOT_AUTH_NOT_ENFORCED/);
  await assert.rejects(bootstrap({...common,apply:true,fetchImpl:mocked({after:good}).fetchImpl}),
    /BOOT_INSTALL_NOT_CONFIRMED/);
  await assert.rejects(bootstrap({...common,apply:true,fetchImpl:mocked({after:repaired,badPrice:true}).fetchImpl}),
    /BOOT_ZERO_CODE_RESPONSE_INVALID/);
  assert.throws(()=>assertProductionContract('function handleGetPricesCompat() {}'),
    /BOOT_SOURCE_LAYOUT_CHANGED/);
  return{mode:'LOCAL_CONTRACT_TEST',result:'PASS',cases:8};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    const args=process.argv.slice(2);
    const result=args.includes('--self-test')?await selfTest():await bootstrap({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
      apply:args.includes('--apply')});
    console.log(JSON.stringify(result));
  } catch(error){
    const key=String(error?.message||'');
    console.error(/^BOOT_[A-Z_]+$/.test(key)?key:'BOOT_UNKNOWN_FAILURE');
    process.exitCode=1;
  }
}
