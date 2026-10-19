#!/usr/bin/env node
// Issue #507: read-only exact KRX evidence for a single missing ledger-held code.
// The code, KRX price, trade amounts and access token are never printed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES,} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';

export const TARGET_DATES=Object.freeze(['2025-09-03','2025-12-30','2026-01-02']);
const STATES=new Set(['OFFICIAL_EXACT_CLOSE','OFFICIAL_EXACT_CLOSE_UNAVAILABLE',
  'MASTER_NOT_UNAMBIGUOUS','NOT_KRX_ELIGIBLE','NOT_LEDGER_HELD_AT_DATE']);
const CODE=/^[0-9][0-9A-Z]{5}$/;
const SOURCE=new Set(['','KRX','KRX_OTP']);
function assertResponse(x,date){
  if(x?.status!=='ok'||x.mode!=='READ_ONLY'||x.requestedDate!==date||
      !STATES.has(x.proof)||typeof x.exact!=='boolean'||
      x.historyModified!==false||!SOURCE.has(x.source)||
      typeof x.usedDate!=='string')
    throw Error('ISSUE507_EXACT_BAD_SOURCE_REPORT');
  if(x.exact!==(x.proof==='OFFICIAL_EXACT_CLOSE'))throw Error('ISSUE507_EXACT_CONTRADICTION');
  if(x.exact && (x.usedDate!==date||!(x.source==='KRX'||x.source==='KRX_OTP')))
    throw Error('ISSUE507_EXACT_FALSE_DATE');
  if(!x.exact && (x.usedDate!==''||x.source!==''))throw Error('ISSUE507_EXACT_UNTRUSTED_SOURCE');
  return {date,proof:x.proof,exact:x.exact,
    usedDate:x.exact?x.usedDate:'',source:x.exact?x.source:''};
}
export function summarizeResults(rows){
  if(!Array.isArray(rows)||rows.length!==TARGET_DATES.length)
    throw Error('ISSUE507_EXACT_BAD_DATES');
  const results=rows.map((r,i)=>assertResponse(r,TARGET_DATES[i]));
  return {mode:'READ_ONLY',evaluationDates:TARGET_DATES,results,
    allDatesIndividuallyConfirmed:results.every(r=>r.exact),
    targetWasVerifiedAsLedgerHeld:results.every(r=>r.proof==='OFFICIAL_EXACT_CLOSE'||
      r.proof==='OFFICIAL_EXACT_CLOSE_UNAVAILABLE'),
    rawCodeDisclosed:false,priceDisclosed:false,
    noHistoricalDataModified:true};
}
export async function runLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_EXACT_MISSING_TOKEN');
  async function post(action,params={},accessToken=token){
    let res;
    try{res=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...params,accessToken}),
      signal:AbortSignal.timeout(240000)});}
    catch{throw Error('ISSUE507_EXACT_NETWORK');}
    if(!res?.ok)throw Error('ISSUE507_EXACT_HTTP');
    try{return await res.json();}
    catch{throw Error('ISSUE507_EXACT_JSON');}
  }
  const invalid=token==='ISSUE507_EXACT_INVALID_AUTH'?'ISSUE507_EXACT_INVALID_AUTH_2':'ISSUE507_EXACT_INVALID_AUTH';
  const denied=await post('diagnoseIssue507HistoricKrxCode',
    {date:TARGET_DATES[0],code:'000001'},invalid);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('ISSUE507_EXACT_AUTH_NOT_ENFORCED');
  const version=await post('getAutomationStatus');
  if(version?.status!=='ok'||version.gasVersion!=='9.243')
    throw Error('ISSUE507_EXACT_WRONG_GAS_RELEASE');
  const diag=await post('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const targets=[...new Set(firstMissingCodes(diag).map(r=>r.code).filter(Boolean))];
  if(targets.length!==1||!CODE.test(targets[0]))
    throw Error('ISSUE507_EXACT_MISSING_CODE_AMBIGUOUS');
  const code=targets[0];
  const raw=[];
  for(const date of TARGET_DATES){
    raw.push(await post('diagnoseIssue507HistoricKrxCode',{date,code}));
  }
  return summarizeResults(raw);
}
function getRealHandler(){
  const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
  const m=gas.match(/function handleDiagnoseIssue507HistoricKrxCode\([\s\S]*?\n}/);
  assert.ok(m,'GAS production historical probe missing');
  assert.match(gas,/params\.action === 'diagnoseIssue507HistoricKrxCode'\) return jsonError\('POST_ONLY'\)/);
  assert.match(gas,/return handleDiagnoseIssue507HistoricKrxCode\(params\.date \|\| '', params\.code \|\| ''\)/);
  const calls=[];
  const state={master: [{code:'0046Y0',currency:'KRW',market:'ETF',type:'ETF'}],
    held: true,
    returned:{price:105,source:'KRX',usedDate:'2025-12-30'},failFetch:false};
  const ctx=vm.createContext({
    _cleanCode:(x)=>String(x||'').trim().toUpperCase(),
    _normalizeDate:(x)=>String(x||'').slice(0,10),
    getss:()=>({}),
    getCodeItems:()=>state.master,
    _isKrxDailyCloseTarget_:(x)=>x.currency==='KRW'&&x.market==='ETF',
    _getDailyHeldCodeItems:()=>state.held?state.master:[],
    fetchPricesKrx:(items,date)=>{
      calls.push({length:items.length,date});
      if(state.failFetch)throw Error('PRIVATE_SECURITY_CODE');
      return state.returned?{'0046Y0':state.returned}:{};
    },
    jsonOk:x=>({status:'ok',...x}),
    jsonError:message=>({status:'error',message})
  });
  vm.runInContext(m[0],ctx);
  return {fn:ctx.handleDiagnoseIssue507HistoricKrxCode,state,calls};
}
export async function selfTest(){
  const {fn,state,calls}=getRealHandler();
  const ok=fn('2025-12-30','0046Y0');
  assert.equal(ok.proof,'OFFICIAL_EXACT_CLOSE');
  assert.equal(ok.exact,true);
  assert.equal(ok.usedDate,'2025-12-30');
  assert.equal(ok.historyModified,false);
  assert.ok(!JSON.stringify(ok).includes('0046Y0'));
  assert.ok(!JSON.stringify(ok).includes('105'));
  assert.equal(calls.length,1);
  assert.equal(fn('2025-12-31','0046Y0').status,'error','non-market as-of date is excluded');
  assert.equal(fn('2025-12-30','SECRET_ACCOUNT').status,'error');
  assert.equal(calls.length,1,'invalid dates and code must not trigger official requests');
  state.held=false;
  assert.equal(fn('2025-12-30','0046Y0').proof,'NOT_LEDGER_HELD_AT_DATE');
  assert.equal(calls.length,1);
  state.held=true;
  state.returned={price:105,source:'KRX',usedDate:'2025-12-29'};
  assert.equal(fn('2025-12-30','0046Y0').proof,'OFFICIAL_EXACT_CLOSE_UNAVAILABLE');
  state.returned={price:105,source:'TOSS',usedDate:'2025-12-30'};
  assert.equal(fn('2025-12-30','0046Y0').exact,false);
  state.returned={price:0,source:'KRX',usedDate:'2025-12-30'};
  assert.equal(fn('2025-12-30','0046Y0').exact,false);
  state.returned={price:105,source:'KRX_OTP',usedDate:'2025-12-30'};
  assert.equal(fn('2025-12-30','0046Y0').exact,true);
  state.failFetch=true;
  assert.equal(fn('2025-12-30','0046Y0').message,'ISSUE507_HISTORIC_KRX_SOURCE_FAILED');
  state.failFetch=false;
  state.master=[{code:'0046Y0',currency:'USD',market:'NASDAQ'}];
  assert.equal(fn('2025-12-30','0046Y0').proof,'NOT_KRX_ELIGIBLE');
  state.master=[];
  assert.equal(fn('2025-12-30','0046Y0').proof,'MASTER_NOT_UNAMBIGUOUS');
  state.master=[{code:'0046Y0',currency:'KRW',market:'ETF'}, {code:'0046Y0',currency:'KRW',market:'ETF'}];
  assert.equal(fn('2025-12-30','0046Y0').proof,'MASTER_NOT_UNAMBIGUOUS');
  const positives=TARGET_DATES.map(date=>({status:'ok',mode:'READ_ONLY',requestedDate:date,
    proof:'OFFICIAL_EXACT_CLOSE',exact:true,source:'KRX',usedDate:date,historyModified:false}));
  assert.equal(summarizeResults(positives).allDatesIndividuallyConfirmed,true);
  assert.throws(()=>summarizeResults(positives.map((x,i)=>i===0?{...x,usedDate:'2025-09-02'}:x)),
    /ISSUE507_EXACT_FALSE_DATE/);
  assert.ok(!JSON.stringify(summarizeResults(positives)).includes('0046Y0'));
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(date=>({
    date,status:'SOURCE_INCOMPLETE',sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: 0046Y0']
  }))};
  const callsToApi=[];
  const mock=async(_url,request)=>{
    const action=request.body.get('action');
    callsToApi.push(action);
    const reply=request.body.get('accessToken')!=='SYNTHETIC_TOKEN'
      ?{status:'error',message:'인증 실패'} :
      action==='getAutomationStatus'?{status:'ok',gasVersion:'9.243'} :
      action==='diagnoseSnapshotIntegrityRange'?diag :
      {status:'ok',mode:'READ_ONLY',requestedDate:request.body.get('date'),
        proof:'OFFICIAL_EXACT_CLOSE',exact:true,source:'KRX',usedDate:request.body.get('date'),
        historyModified:false};
    return {ok:true,json:async()=>reply};
  };
  const live=await runLive({url:'https://script.google.com/macros/s/synthetic/exec',
    token:'SYNTHETIC_TOKEN',fetchImpl:mock});
  assert.deepEqual(callsToApi,['diagnoseIssue507HistoricKrxCode','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange',
    'diagnoseIssue507HistoricKrxCode','diagnoseIssue507HistoricKrxCode',
    'diagnoseIssue507HistoricKrxCode']);
  assert.equal(live.allDatesIndividuallyConfirmed,true);
  assert.ok(!JSON.stringify(live).includes('SYNTHETIC_TOKEN'));
  console.log('Issue #507 targeted historical official source contract PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1400));
    else {
      const code=String(e?.message||'');
      console.error(/^ISSUE507_EXACT_[A-Z_]+$/.test(code)?code:'ISSUE507_EXACT_UNKNOWN');
    }
    process.exitCode=1;
  }
}
