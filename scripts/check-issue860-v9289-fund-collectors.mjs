#!/usr/bin/env node
// #860: Exercise the real private KB/Hanwha collectors against a v9.289
// mock GAS response with official class/date sources. Never call production.
import assert from 'node:assert/strict';
import {run as collectKb} from './collect-kb-fund-nav.mjs';
import {run as collectHanwha} from './collect-hanwha-fund-nav.mjs';

const now=new Date('2026-11-11T01:00:00Z');
const url='https://script.google.com/macros/s/TEST_COLLECTOR_VERSION/exec';
const token='TEST_TOKEN_DO_NOT_USE_IN_PRODUCTION';
function fixture(version,code,{sourceNetworkFailure=false}={}){
 const calls=[];
 const fetchImpl=async(destination,options={})=>{
  const endpoint=new URL(destination);
  if(endpoint.hostname==='www.funetf.co.kr'){
   calls.push('KB_OFFICIAL_SOURCE');
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
     candidates:[],updates:[],warnings:[],errors:[],
     duplicates:[],zeroUnits:[],identical:[]})};
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
 for(const version of ['9.285','9.289']){
  const f=fixture(version,code);
  const result=await runner({url,token,now,fetchImpl:f.fetchImpl,apply:false});
  assert.equal(result.mode,'DRY_RUN',kind+' '+version);
  assert.equal(result.candidates,0);
  assert(f.calls.includes('previewFundNavImport'));
  assert(f.calls.includes('getFundValuationStatus'));
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
await assert.rejects(
 ()=>collectHanwha({url,token,now,fetchImpl:offline.fetchImpl,apply:false}),
 /HANWHA_SOURCE_NETWORK_UNVERIFIED/);
assert.equal(offline.calls.filter(x=>x==='HANWHA_OFFICIAL_SOURCE').length,2,
 'Transport-only retry stays bounded and cannot fabricate NAV');

console.log('PASS: v9.289 KB/Hanwha class-exact, date-scoped, read-only collector paths; unsupported next version and source outage fail closed; financial writes 0');
