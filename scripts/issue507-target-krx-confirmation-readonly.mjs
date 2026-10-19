#!/usr/bin/env node
// #507: authenticated READ ONLY, per-code official KRX existence proof.
// The target identifier exists only in runner memory and is never logged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';

const HISTORIC_DATES=Object.freeze(['2025-09-03','2025-12-30']);
const PROVENANCE=new Set(['KRX_OPENAPI','KRX_OTP','NOT_CONFIRMED']);
export function summarizeTargetEvidence(diagnosis, responses) {
  const missing=firstMissingCodes(diagnosis);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(codes.length!==1||!Array.isArray(responses)||responses.length!==HISTORIC_DATES.length)
    throw Error('ISSUE507_TARGET_MISSING_SCOPE');
  const checks=HISTORIC_DATES.map((date,i)=>{
    const res=responses[i],cov=res?.coverage,t=res?.targetEvidence;
    if(res?.status!=='ok'||cov?.requestedDate!==date||cov.mode!=='READ_ONLY'||
      !t||t.requested!==true||typeof t.eligibleHeldDomestic!=='boolean'||
      typeof t.exactDateConfirmed!=='boolean'||!PROVENANCE.has(t.providerClass)||
      typeof t.usedDate!=='string')
      throw Error('ISSUE507_TARGET_SCHEMA');
    if(t.exactDateConfirmed && (!t.eligibleHeldDomestic || t.usedDate!==date ||
      t.providerClass==='NOT_CONFIRMED'))
      throw Error('ISSUE507_TARGET_BAD_EVIDENCE');
    if(!t.exactDateConfirmed && (t.usedDate||t.providerClass!=='NOT_CONFIRMED'))
      throw Error('ISSUE507_TARGET_BAD_EVIDENCE');
    return {date,eligibleHeldDomestic:t.eligibleHeldDomestic,
      exactOfficialCloseProven:t.exactDateConfirmed,
      confirmedProvider:t.providerClass,
      sourceDate:t.usedDate||'-',
      overallEligibleHeldCount:cov.expectedHeldCodes,
      totalExactOfficialCloses:cov.officialExactDateCodes,
      originalHistoryWritten:false,originalLedgerWritten:false,snapshotWritten:false};
  });
  return {mode:'READ_ONLY',firstMissingCodeCount:codes.length,checks,
    safeToCarryTo2026Jan01:checks.some(x=>
      x.date==='2025-12-30'&&x.exactOfficialCloseProven),
    carryApplied:false,
    note:'Official exact-date existence is NOT evidence of safe Snapshot overwrite or full code history'};
}

export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_TARGET_AUTH_REQUIRED');
  async function get(action,args={},credential=token){
    let res;
    try{res=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:credential}),
      signal:AbortSignal.timeout(240000)});}
    catch{throw Error('ISSUE507_TARGET_NETWORK');}
    if(!res?.ok)throw Error('ISSUE507_TARGET_HTTP');
    try{return await res.json();}
    catch{throw Error('ISSUE507_TARGET_JSON');}
  }
  const bad=token==='ISSUE507_TARGET_DENIED'?'ISSUE507_TARGET_DENIED2':'ISSUE507_TARGET_DENIED';
  const refused=await get('getKrxHeldCloseCoverage',{date:HISTORIC_DATES[0]},bad);
  if(refused?.status!=='error'||refused.message!=='인증 실패')
    throw Error('ISSUE507_TARGET_AUTH_GUARD');
  const diagnostic=await get('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  const missing=firstMissingCodes(diagnostic);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(codes.length!==1)throw Error('ISSUE507_TARGET_MISSING_SCOPE');
  const replies=[];
  for(const date of HISTORIC_DATES)
    replies.push(await get('getKrxHeldCloseCoverage',{date,code:codes[0]}));
  return summarizeTargetEvidence(diagnostic,replies);
}
export function testProductionGAS(){
  const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
  const names=['_krxHeldTargetCloseEvidence_','handleGetKrxHeldCloseCoverage'];
  const source=names.map(n=>{
    const m=gas.match(new RegExp('function '+n+'\\([\\s\\S]*?\\n}','m'));
    assert.ok(m,'production GAS helper missing: '+n);return m[0];
  }).join('\n');
  let official={price:250,usedDate:'2025-12-30',source:'KRX'};
  let eligible=true,fetchCalls=0,writeCount=0;
  const catalog=[{code:'000001',name:'PRIVATE_FUND_NAME',currency:'KRW',market:'ETF',type:'ETF'}];
  const sheet={
    getLastRow:()=>2,getLastColumn:()=>11,
    getRange:()=>({getValues:()=>[['2025-09-03','buy','PRIVATE_ACCT',
      'PRIVATE_FUND_NAME','000001',2,100,'ETF']]})
  };
  const ctx=vm.createContext({
    CONFIG:{SHEET_TRADES:'거래이력'},
    _cleanCode:c=>String(c||'').trim().toUpperCase(),
    _normalizeDate:c=>String(c||'').slice(0,10),
    today:()=> '2026-10-20',
    getss:()=>({getSheetByName:name=>name==='거래이력'?sheet:null}),
    getCodeItems:()=>catalog,
    _getDailyHeldCodeItems:()=>eligible?catalog:[],
    _isKrxDailyCloseTarget_:()=>true,
    _calcCodeHoldingsAtDate:()=>({A:{code:'000001',qty:2}}),
    fetchPricesKrx:()=>{fetchCalls++;return official?{'000001':official}:{};},
    jsonOk:o=>({status:'ok',...o}),
    jsonError:message=>({status:'error',message}),
  });
  vm.runInContext(source,ctx);
  const run=(date='2025-12-30',target='000001')=>
    ctx.handleGetKrxHeldCloseCoverage(date,target);
  let x=run();
  assert.equal(x.status,'ok',String(x.message||''));
  assert.equal(x.targetEvidence.eligibleHeldDomestic,true);
  assert.equal(x.targetEvidence.exactDateConfirmed,true);
  assert.equal(x.targetEvidence.providerClass,'KRX_OPENAPI');
  assert.equal(x.coverage.missingCodes,0);
  assert.ok(!JSON.stringify(x).includes('000001'));
  assert.ok(!JSON.stringify(x).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(x).includes('250'));
  assert.equal(run('2025-12-30','').targetEvidence,null);
  official={price:250,usedDate:'2025-12-30',source:'KRX_OTP'};
  assert.equal(run().targetEvidence.providerClass,'KRX_OTP');
  official={price:250,usedDate:'2025-12-29',source:'KRX'};
  assert.equal(run().targetEvidence.exactDateConfirmed,false);
  official={price:250,usedDate:'2025-12-30',source:'KRX_CARRY'};
  assert.equal(run().targetEvidence.exactDateConfirmed,false);
  official={price:0,usedDate:'2025-12-30',source:'KRX'};
  assert.equal(run().targetEvidence.exactDateConfirmed,false);
  official={price:250,usedDate:'2025-12-30',source:'KRX'};
  assert.equal(run('2025-12-30','000002').targetEvidence.eligibleHeldDomestic,false);
  eligible=false;
  assert.equal(run().targetEvidence.eligibleHeldDomestic,false);
  assert.equal(run().targetEvidence.exactDateConfirmed,false);
  assert.equal(writeCount,0);
  assert.ok(fetchCalls>=6);
  return true;
}
export async function selfTest(){
  assert.equal(testProductionGAS(),true);
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(date=>({
    date,status:'SOURCE_INCOMPLETE',sourceDataErrors:[
      '확정 원자료 부족으로 기존 Snapshot 보존: 000001']}))};
  const out=(date,confirmed)=>({status:'ok',coverage:{
    mode:'READ_ONLY',requestedDate:date,expectedHeldCodes:30,
    officialExactDateCodes:30},targetEvidence:{requested:true,eligibleHeldDomestic:true,
    exactDateConfirmed:confirmed,usedDate:confirmed?date:'',
    providerClass:confirmed?'KRX_OPENAPI':'NOT_CONFIRMED'}});
  const proof=summarizeTargetEvidence(diag,HISTORIC_DATES.map(x=>out(x,true)));
  assert.equal(proof.safeToCarryTo2026Jan01,true);
  assert.equal(proof.carryApplied,false);
  assert.ok(!JSON.stringify(proof).includes('000001'));
  assert.throws(()=>summarizeTargetEvidence(diag,
    [out('2025-09-03',true),{...out('2025-12-30',true),
      targetEvidence:{requested:true,eligibleHeldDomestic:true,
        exactDateConfirmed:true,usedDate:'2026-01-06',providerClass:'KRX_OPENAPI'}}]),
    /ISSUE507_TARGET_BAD_EVIDENCE/);
  const actions=[];
  const mock=async(_url,opts)=>{
    const action=opts.body.get('action'),date=opts.body.get('date');
    actions.push(action);
    const response=opts.body.get('accessToken')!=='SYNTH_TOKEN'
      ? {status:'error',message:'인증 실패'}:
      action==='diagnoseSnapshotIntegrityRange'?diag:
      out(date,true);
    return {ok:true,json:async()=>response};
  };
  const live=await readLive({url:'https://script.google.com/macros/s/TEST/exec',
    token:'SYNTH_TOKEN',fetchImpl:mock});
  assert.equal(live.safeToCarryTo2026Jan01,true);
  assert.deepEqual(actions,['getKrxHeldCloseCoverage','diagnoseSnapshotIntegrityRange',
    'getKrxHeldCloseCoverage','getKrxHeldCloseCoverage']);
  assert.ok(!JSON.stringify(live).includes('SYNTH_TOKEN'));
  console.log('Issue #507 production targeted historical KRX proof: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else {
      const error=String(e?.message||'');
      console.error(/^ISSUE507_TARGET_[A-Z_]+$/.test(error)?error:'ISSUE507_TARGET_UNKNOWN');
    }
    process.exitCode=1;
  }
}
