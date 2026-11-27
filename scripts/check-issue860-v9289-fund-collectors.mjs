#!/usr/bin/env node
// #860: Exercise the real private KB/Hanwha collectors against a v9.289
// mock GAS response with official class/date sources. Never call production.
import assert from 'node:assert/strict';
import {run as collectKb} from './collect-kb-fund-nav.mjs';
import {run as collectHanwha} from './collect-hanwha-fund-nav.mjs';

const now=new Date('2026-11-11T01:00:00Z');
const url='https://script.google.com/macros/s/TEST_COLLECTOR_VERSION/exec';
const token='TEST_TOKEN_DO_NOT_USE_IN_PRODUCTION';
function fixture(version,code,{sourceNetworkFailure=false,secondaryNetworkFailure=false,secondaryNoOverlap=false}={}){
 const calls=[];
 const fetchImpl=async(destination,options={})=>{
  const endpoint=new URL(destination);
  if(endpoint.hostname==='www.funetf.co.kr'){
   calls.push(code==='F00001'?'FUNETF_CRPE_SECONDARY':'KB_OFFICIAL_SOURCE');
   if(code==='F00001'){
    assert.equal(endpoint.searchParams.get('fundCd'),'K55213C50702');
    if(secondaryNetworkFailure)throw Error('MOCK_SECONDARY_NETWORK_FAILURE');
   }
   return {ok:true,json:async()=>[{gijunYmd:'20261110',gijunGa:1234.56}]};
  }
  if(endpoint.hostname==='www.hanwhafund.co.kr'){
   calls.push('HANWHA_OFFICIAL_SOURCE');
   if(sourceNetworkFailure)throw Error('MOCK_NETWORK_FAILURE');
   return {ok:true,json:async()=>({list:[{wkdate:'20261110',price:'1,234.56'}]})};
  }
  assert.equal(endpoint.origin,'https://script.google.com');
  assert.equal(options.method,'POST');
  const params=options.body;
  const action=params.get('action');
  calls.push(action);
  assert(!['collectKbFundNav','collectHanwhaFundNav','resumeIncompletePortfolioClose'].includes(action),
   'Read-only tests must never invoke a financial writer');
  if(action==='getAutomationStatus'){
   const credential=params.get('accessToken');
   return {ok:true,json:async()=>credential!==token
    ?{status:'error',message:'인증 실패'}
    :{status:'ok',gasVersion:version,automation:{
      gasVersion:version,
      closeRun:{runDate:'2026-11-10',state:'INCOMPLETE'},
      fundAttempt:{state:'DONE',date:'2026-11-09'},
      tradeLedgerWriteUnverified:false,
      pendingTradeSnapshotRebuildFrom:'',
      tradeSnapshotDeferredCount:0
     }}};
  }
  if(action==='previewFundNavImport'){
   return {ok:true,json:async()=>({status:'ok',code,
     candidates:secondaryNoOverlap?[{date:'2026-11-10',nav:1234.56}]:[],updates:[],warnings:[],errors:[],
     duplicates:[],zeroUnits:[],identical:secondaryNoOverlap
      ?[]:[{date:'2026-11-10',existingNav:1234.56,uploadedNav:1234.56}]})};
  }
  if(action==='getFundValuationStatus'){
   return {ok:true,json:async()=>({status:'ok',fundResults:{[code]:{dates:[]}}})};
  }
  throw Error('MOCK_UNEXPECTED_ACTION_'+action);
 };
 return {fetchImpl,calls};
}

for(const [kind,runner,code,error] of [
 ['KB',collectKb,'F00002',/NAV_VERSION/],
 ['HANWHA',collectHanwha,'F00001',/HANWHA_VERSION_UNVERIFIED/],
]){
 for(const version of ['9.285','9.289','9.291']){
  const f=fixture(version,code);
  const result=await runner({url,token,now,fetchImpl:f.fetchImpl,apply:false});
  assert.equal(result.mode,'DRY_RUN',kind+' '+version);
  assert.equal(result.candidates,0);
  assert(f.calls.includes('previewFundNavImport'));
  // KB DRY_RUN returns after preview; Hanwha also checks derived status.
  assert.equal(f.calls.includes('getFundValuationStatus'),kind==='HANWHA');
  assert(f.calls.includes(kind+'_OFFICIAL_SOURCE'));
  assert(!f.calls.some(x=>/collect.*FundNav|resumeIncompletePortfolioClose/.test(x)));
 }
 const unsupported=fixture('9.290',code);
 await assert.rejects(
  ()=>runner({url,token,now,fetchImpl:unsupported.fetchImpl,apply:false}),
  error,kind+' must refuse unreviewed GAS 9.290');
 assert(!unsupported.calls.some(x=>x.includes('OFFICIAL_SOURCE')));
}
const offline=fixture('9.289','F00001',{sourceNetworkFailure:true});
const fallback=await collectHanwha({url,token,now,fetchImpl:offline.fetchImpl,apply:false});
assert.equal(fallback.mode,'DRY_RUN');
assert.equal(fallback.writerInvoked,false);
assert.equal(offline.calls.filter(x=>x==='HANWHA_OFFICIAL_SOURCE').length,2);
assert.equal(offline.calls.filter(x=>x==='FUNETF_CRPE_SECONDARY').length,1);
assert(!offline.calls.some(x=>x==='collectHanwhaFundNav'));
const noOverlap=fixture('9.289','F00001',{
 sourceNetworkFailure:true,secondaryNoOverlap:true});
await assert.rejects(()=>collectHanwha({
 url,token,now,fetchImpl:noOverlap.fetchImpl,apply:false
}),/HANWHA_SECONDARY_OFFICIAL_OVERLAP_UNVERIFIED/);
const unavailable=fixture('9.289','F00001',{
 sourceNetworkFailure:true,secondaryNetworkFailure:true});
await assert.rejects(()=>collectHanwha({
 url,token,now,fetchImpl:unavailable.fetchImpl,apply:false
}),/HANWHA_FUNETF_NETWORK_UNVERIFIED/);


// The 11/13 delayed GAS initial preview can timeout after public NAV success.
// Reattempt ONLY the same read-only preview, never a financial writer.
for(const [name,runner,code] of [['KB',collectKb,'F00002'],
 ['HANWHA',collectHanwha,'F00001']]){
 const fixtureResult=fixture('9.291',code);
 let attempts=0,delays=0,writerCalls=0;
 const result=await runner({url,token,now,apply:false,
   retryDelay:async()=>{delays++;},
   fetchImpl:async(destination,options={})=>{
     if(new URL(destination).hostname==='script.google.com'){
       const action=options.body.get('action');
       if(/^(?:collectKbFundNav|collectHanwhaFundNav)$/.test(action))writerCalls++;
       if(action==='previewFundNavImport'&&++attempts===1)
         throw Object.assign(new Error('TRANSIENT_PREVIEW_TIMEOUT'),{name:'TimeoutError'});
     }
     return fixtureResult.fetchImpl(destination,options);
   }});
 assert.equal(result.mode,'DRY_RUN');
 assert.deepEqual([attempts,delays,writerCalls],[2,1,0],name+' preview retry');
 const denied=fixture('9.291',code);let rejected=0,deniedDelays=0;
 await assert.rejects(()=>runner({url,token,now,apply:false,
   retryDelay:async()=>{deniedDelays++;},
   fetchImpl:async(destination,options={})=>{
     if(new URL(destination).hostname==='script.google.com'
       &&options.body.get('action')==='previewFundNavImport'){
         rejected++;
         return {ok:false,status:401};
     }
     return denied.fetchImpl(destination,options);
   }}),name==='KB'?/NAV_PREVIEW_HTTP_UNVERIFIED/:/HANWHA_PREVIEW_HTTP_UNVERIFIED/);
 assert.deepEqual([rejected,deniedDelays],[1,0],name+' auth/HTTP fail closed');
}

// 11/16 production: both GAS previews returned HTTP 200 but JSON parsing
// failed. A single fresh READ-ONLY preview is safe; never retry an import.
for(const [name,runner,code] of [['KB',collectKb,'F00002'],
 ['HANWHA',collectHanwha,'F00001']]){
 const normal=fixture('9.291',code);
 let previews=0,delays=0,writers=0;
 const transient=await runner({url,token,now,apply:false,
  retryDelay:async()=>{delays++;},
  fetchImpl:async(destination,options={})=>{
   if(new URL(destination).hostname==='script.google.com'){
    const action=options.body.get('action');
    if(/^(?:collectKbFundNav|collectHanwhaFundNav)$/.test(action))writers++;
    if(action==='previewFundNavImport'&&++previews===1)
     return {ok:true,status:200,headers:{get:()=> 'text/html; charset=UTF-8'},
      json:async()=>{throw new SyntaxError('not JSON')}};
   }
   return normal.fetchImpl(destination,options);
  }});
 assert.equal(transient.mode,'DRY_RUN',name+' single non-JSON preview recovered');
 assert.deepEqual([previews,delays,writers],[2,1,0],
  name+' read-only JSON retry; financial writer not retried');
 const broken=fixture('9.291',code);
 let failed=0,failedDelays=0,failedWrites=0;
 await assert.rejects(()=>runner({url,token,now,apply:false,
  retryDelay:async()=>{failedDelays++;},
  fetchImpl:async(destination,options={})=>{
   if(new URL(destination).hostname==='script.google.com'){
    const action=options.body.get('action');
    if(/^(?:collectKbFundNav|collectHanwhaFundNav)$/.test(action))failedWrites++;
    if(action==='previewFundNavImport'){
     failed++;
     return {ok:true,status:200,headers:{get:()=> 'text/html'},
      json:async()=>{throw new SyntaxError('invalid HTML body')}};
    }
   }
   return broken.fetchImpl(destination,options);
  }}),name==='KB'?/NAV_PREVIEW_JSON_UNVERIFIED/:/HANWHA_PREVIEW_JSON_UNVERIFIED/);
 assert.deepEqual([failed,failedDelays,failedWrites],[2,1,0],
  name+' persistent non-JSON remains blocked, never writes');
}

// An upstream 429/502/503/504 can be transient, but only for the initial
// read-only NAV preview; import/refresh and authentication errors never retry.
for(const [kind,runner,code] of [['KB',collectKb,'F00002'],
 ['HANWHA',collectHanwha,'F00001']]){
 for(const status of [429,502,503,504]){
  const good=fixture('9.291',code);
  let previewCalls=0,delays=0,writerCalls=0;
  const result=await runner({url,token,now,apply:false,
   retryDelay:async()=>{delays++;},
   fetchImpl:async(destination,options={})=>{
    if(new URL(destination).hostname==='script.google.com'){
     const action=options.body.get('action');
     if(/^(?:collectKbFundNav|collectHanwhaFundNav)$/.test(action))writerCalls++;
     if(action==='previewFundNavImport'&&++previewCalls===1)
      return {ok:false,status};
    }
    return good.fetchImpl(destination,options);
   }});
  assert.equal(result.mode,'DRY_RUN',kind+' '+status);
  assert.deepEqual([previewCalls,delays,writerCalls],[2,1,0],
   kind+' '+status+' initial preview transient retry only');
 }
 for(const status of [400,401,403,404,500]){
  const denied=fixture('9.291',code);let previewCalls=0,delays=0;
  await assert.rejects(()=>runner({url,token,now,apply:false,
   retryDelay:async()=>{delays++;},
   fetchImpl:async(destination,options={})=>{
    if(new URL(destination).hostname==='script.google.com'
      &&options.body.get('action')==='previewFundNavImport'){
      previewCalls++;return {ok:false,status};
    }
    return denied.fetchImpl(destination,options);
   }}),kind==='KB'?/NAV_PREVIEW_HTTP_UNVERIFIED/:/HANWHA_PREVIEW_HTTP_UNVERIFIED/);
  assert.deepEqual([previewCalls,delays],[1,0],
   kind+' '+status+' permanent/auth rejection never retries');
 }
}

// Already-committed writer ACKs are never retried regardless of response code.
// Regression for 2026-11-11: the GAS import may commit before HTTP ACK times out.
// Only transient read-only preview errors may be retried. Never import twice.
const exactDate='2026-11-10',exactNav=1234.56;
function lostAckFixture({readbackFailures=0,explicitPartial=false,readbackRejected=false,partialWithoutCommit=false,partialMissingHoldings=false,missingDerived=false}={}){
 const calls={source:0,preview:0,import:0,valuation:0,delay:0};
 const fetchImpl=async(destination,options={})=>{
  const host=new URL(destination).hostname;
  if(host==='www.funetf.co.kr'){
   calls.source++;
   return {ok:true,json:async()=>[{gijunYmd:'20261110',gijunGa:exactNav}]};
  }
  assert.equal(host,'script.google.com');
  const action=options.body.get('action');
  if(action==='getAutomationStatus'){
   return {ok:true,json:async()=>options.body.get('accessToken')!==token
    ?{status:'error',message:'인증 실패'}
    :{status:'ok',gasVersion:'9.291',automation:{
      gasVersion:'9.291',closeRun:{runDate:exactDate,state:'INCOMPLETE'},
      tradeLedgerWriteUnverified:false,pendingTradeSnapshotRebuildFrom:'',
      tradeSnapshotDeferredCount:0, fundAttempt:{state:'DONE'}
    }}};
  }
  if(action==='previewFundNavImport'){
   calls.preview++;
   if(calls.preview===1)
    return {ok:true,json:async()=>({status:'ok',code:'F00002',
      candidates:[{date:exactDate,nav:exactNav}],updates:[],errors:[],warnings:[],duplicates:[],zeroUnits:[],identical:[]})};
   if(readbackRejected)return {ok:false,status:401};
   if(calls.preview<=1+readbackFailures)
    throw Object.assign(Error('PRIVATE_TIMEOUT'),{name:'TimeoutError'});
   if(partialWithoutCommit)return {ok:true,json:async()=>({status:'ok',code:'F00002',
     candidates:[{date:exactDate,nav:exactNav}],updates:[],errors:[],warnings:[],duplicates:[],zeroUnits:[],identical:[]})};
   return {ok:true,json:async()=>({status:'ok',code:'F00002',
     candidates:[],updates:[],errors:[],warnings:[],duplicates:[],zeroUnits:[],
     identical:[{date:exactDate,existingNav:exactNav,uploadedNav:exactNav}]})};
  }
  if(action==='collectKbFundNav'){
   assert.equal(options.body.get('mode'),'import','no refresh/write on this fixture');
   calls.import++;
   if(explicitPartial)
    return {ok:true,json:async()=>({status:'error',saveState:'partial',
      ...(partialMissingHoldings?{evaluation:{missingHoldings:['F00002']}}:{})})};
   throw Object.assign(Error('PRIVATE_ACK_LOST'),{name:'TimeoutError'});
  }
  if(action==='getFundValuationStatus'){
   calls.valuation++;
   return {ok:true,json:async()=>({status:'ok',fundResults:{F00002:{dates:missingDerived?[]:[{code:'F00002',date:exactDate,navState:'EXISTING_CONFIRMED',valuationRequired:true,unitsApplied:true,reconciled:true,evaluationState:'EXISTING_VALID',snapshotState:'EXISTING_VALID'}]}}})};
  }
  throw Error('UNEXPECTED_GAS_ACTION');
 };
 return {calls,fetchImpl,retryDelay:async()=>{calls.delay++}};
}
const recovered=lostAckFixture({readbackFailures:1});
const recoveredResult=await collectKb({url,token,now,
 fetchImpl:recovered.fetchImpl,retryDelay:recovered.retryDelay,apply:true});
assert.equal(recoveredResult.importAckRecovered,true);
assert.equal(recoveredResult.imported,1);
assert.deepEqual([recovered.calls.import,recovered.calls.preview,
 recovered.calls.delay,recovered.calls.valuation],[1,3,1,2],
 'one import, initial preview, transient lost-ACK readback then exact success');
const stillUnverified=lostAckFixture({readbackFailures:3});
await assert.rejects(()=>collectKb({url,token,now,
 fetchImpl:stillUnverified.fetchImpl,retryDelay:stillUnverified.retryDelay,apply:true}),
 /NAV_IMPORT_UNVERIFIED/);
assert.deepEqual([stillUnverified.calls.import,stillUnverified.calls.preview,
 stillUnverified.calls.delay],[1,4,2],
 'bounded read-only retries must never duplicate the financial import');
const partial=lostAckFixture({explicitPartial:true});
const partialResult=await collectKb({url,token,now,
 fetchImpl:partial.fetchImpl,retryDelay:partial.retryDelay,apply:true});
assert.equal(partialResult.importAckRecovered,true,
 'structured partial requires exact NAV date and price proof');
assert.equal(partialResult.imported,1);
assert.deepEqual([partial.calls.import,partial.calls.preview,partial.calls.delay],
 [1,2,0],'structured partial cannot trigger another import');
const notCommitted=lostAckFixture({explicitPartial:true,partialWithoutCommit:true});
await assert.rejects(()=>collectKb({url,token,now,
 fetchImpl:notCommitted.fetchImpl,retryDelay:notCommitted.retryDelay,apply:true}),
 /NAV_READBACK_FAILED/);
assert.deepEqual([notCommitted.calls.import,notCommitted.calls.preview,notCommitted.calls.delay],
 [1,2,0],'uncommitted partial must fail after one exact readback');
const missingUnits=lostAckFixture({explicitPartial:true,partialMissingHoldings:true});
await assert.rejects(()=>collectKb({url,token,now,
 fetchImpl:missingUnits.fetchImpl,retryDelay:missingUnits.retryDelay,apply:true}),
 /NAV_IMPORT_UNVERIFIED/);
assert.deepEqual([missingUnits.calls.import,missingUnits.calls.preview,missingUnits.calls.delay],
 [1,1,0],'missing holding data cannot be certified by partial NAV readback');
const omitted=lostAckFixture({missingDerived:true});
await assert.rejects(()=>collectKb({url,token,now,
 fetchImpl:omitted.fetchImpl,retryDelay:omitted.retryDelay,apply:true}),
 /NAV_DERIVED_READBACK_UNVERIFIED/);
assert.deepEqual([omitted.calls.import,omitted.calls.valuation],[1,1],
 'missing candidate-date valuation must never turn an exact NAV readback into false success');
const denied=lostAckFixture({readbackRejected:true});
await assert.rejects(()=>collectKb({url,token,now,
 fetchImpl:denied.fetchImpl,retryDelay:denied.retryDelay,apply:true}),
 /NAV_IMPORT_UNVERIFIED/);
assert.deepEqual([denied.calls.import,denied.calls.preview,denied.calls.delay],
 [1,2,0],'HTTP/auth rejection must not be retried after lost import ACK');

console.log('PASS: 9.291 KB/Hanwha private NAV preview/versions, official fallback 7/7 guard, unknown 9.290 refused, lost-ACK/partial exact readback 7 cases, no duplicate import');

// Real collector admission: wrong class, missing/duplicate classifications,
// omitted rows and mismatched stored NAV must never reach a writer.
for(const [runner,code,prefix] of [[collectKb,'F00002','NAV'],[collectHanwha,'F00001','HANWHA']]){
 for(const mutate of [
   p=>{delete p.identical;},
   p=>{p.code=code==='F00002'?'F00001':'F00002';},
   p=>{p.identical=[];},
   p=>{p.identical[0].existingNav+=0.01;},
   p=>{p.candidates=[{date:exactDate,nav:exactNav}];},
   p=>{p.duplicates=[{date:exactDate,nav:exactNav}];}
 ]){
  const normal=fixture('9.291',code);let writers=0;
  await assert.rejects(()=>runner({url,token,now,apply:true,fetchImpl:async(dest,opts)=>{
    if(opts?.body?.get('action')?.startsWith('collect')){writers++;assert.fail('unverified preview must not write');}
    const response=await normal.fetchImpl(dest,opts);
    if(opts?.body?.get('action')!=='previewFundNavImport')return response;
    const payload=await response.json();mutate(payload);
    return {ok:true,json:async()=>payload};
  }}),new RegExp(prefix+'_PREVIEW_(?:BLOCKED|MISMATCH)'));
  assert.equal(writers,0);
 }
}
const {validateAppendOnlyNavPreview}=await import('./nav-append-only-preview-contract.mjs');
const rows=[{date:exactDate,nav:exactNav}];
const zero={status:'ok',code:'F00002',candidates:[],identical:[],updates:[],warnings:[],errors:[],duplicates:[],zeroUnits:rows};
assert.equal(validateAppendOnlyNavPreview(zero,'F00002',rows,{allowZeroUnits:true}).ok,true);
assert.equal(validateAppendOnlyNavPreview(zero,'F00002',rows,{readback:true}).ok,false);
assert.equal(validateAppendOnlyNavPreview({...zero,zeroUnits:[{...rows[0],nav:1}]},'F00002',rows,{allowZeroUnits:true}).ok,false);
console.log('NAV_APPEND_ONLY_EXACT_COVERAGE_PASS both collectors, omitted or conflicting classifications blocked before writes');
