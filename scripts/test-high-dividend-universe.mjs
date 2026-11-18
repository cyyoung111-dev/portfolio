import assert from 'node:assert/strict';
import {auditHistoricalUniverse,auditFromGas} from './audit-high-dividend-universe.mjs';
const candidates={classification:'CANDIDATE_ONLY',matched:[
 {listedCode:'005930',issuerName:'삼성전자',market:'KOSPI',identityState:'EXACT_LISTED_ISSUER',taxEligibility:'UNVERIFIED',businessYear:2025},
 {listedCode:'034730',issuerName:'SK',market:'KOSPI',identityState:'EXACT_LISTED_ISSUER',taxEligibility:'UNVERIFIED',businessYear:2025},
 {listedCode:'1234A0',issuerName:'신규',market:'KOSDAQ',identityState:'EXACT_LISTED_ISSUER',taxEligibility:'UNVERIFIED',businessYear:2025}
],unresolved:[{issuerName:'누락'}]};
const master=[
 {code:'005930',name:'삼성전자',market:'KOSPI',type:'주식',currency:'KRW'},
 {code:'005935',name:'삼성전자우',market:'KOSPI',type:'주식',currency:'KRW'},
 {code:'034730',name:'SK',market:'KOSDAQ',type:'주식',currency:'KRW'},
 {code:'1234A0',name:'신규',market:'KOSDAQ',type:'주식',currency:'KRW'},
 {code:'069500',name:'ETF',market:'KOSPI',type:'ETF',currency:'KRW'},
 {code:'AAPL',name:'Apple',market:'US',type:'주식',currency:'USD'}];
const trades=[
 {code:'5930',name:'삼성전자',tradeType:'buy',qty:1,acct:'PRIVATE_ACCOUNT'},
 {code:'005930',name:'삼성전자',tradeType:'sell',qty:1},
 {code:'005935',name:'삼성전자우'},{code:'034730',name:'SK'},
 {name:'신규'},{code:'069500'},{code:'AAPL'},{code:'000001',name:'missing master'},{name:'ambiguous'}
];
const result=auditHistoricalUniverse(candidates,master,trades);
assert.equal(result.mappedHistoricalSymbols,6);
assert.equal(result.domesticStockSymbols,4);
assert.equal(result.candidateSymbols,2);
assert.equal(result.noExactCandidateCode,1);
assert.equal(result.marketConflicts,1);
assert.equal(result.otherSymbols,2);
assert.equal(result.unresolvedTradeRows,2);
assert.equal(result.taxEligibilityVerified,false);
assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ACCOUNT|삼성전자|005930|034730|1234A0|AAPL/);
assert.throws(()=>auditHistoricalUniverse({...candidates,matched:[...candidates.matched,candidates.matched[0]]},master,trades),/CANDIDATE_IDENTITY/);
assert.throws(()=>auditHistoricalUniverse(candidates,[...master,master[0]],trades),/MASTER_DUPLICATE/);
const actions=[],token='PRIVATE_AUTH_EXAMPLE';
const fetchImpl=async(_url,opt)=>{
 const p=opt.body;const action=p.get('action');actions.push(action);
 if(p.get('accessToken')!==token)return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
 return {ok:true,json:async()=>action==='getCodeListReadOnly'?{status:'ok',readOnly:true,gasVersion:'9.297',codes:master}:{status:'ok',trades}};
};
const actual=await auditFromGas({url:'https://script.google.com/macros/s/TEST/exec',token,candidateIndex:candidates,fetchImpl});
assert.deepEqual(actions,['getCodeListReadOnly','getCodeListReadOnly','getTrades']);
assert.equal(actual.candidateSymbols,result.candidateSymbols);
assert.equal(actual.financialOriginalWritten,false);
assert.equal(actual.atomicSnapshot,false);
console.log('PASS: read-only historical portfolio identity coverage; no private detail or tax eligibility inferred');

const base={url:'https://script.google.com/macros/s/TEST/exec',token,candidateIndex:candidates,delay:async()=>{}};
let attempts=0;const reports=[];
const recovered=await auditFromGas({...base,report:r=>reports.push(r),fetchImpl:async(...args)=>{
 if(++attempts===1)throw TypeError('PRIVATE_UPSTREAM_FAILURE');
 return fetchImpl(...args);
}});
assert.equal(attempts,4);assert.equal(recovered.candidateSymbols,2);
assert.deepEqual(reports,[{kind:'HIGH_DIVIDEND_AUDIT_READ_RETRY',stage:'AUTH_PROBE',reason:'NETWORK',financeWrites:0}]);
assert.doesNotMatch(JSON.stringify(reports),/PRIVATE_UPSTREAM_FAILURE|PRIVATE_AUTH_EXAMPLE/);
for(const status of [401,403,429]){
 let calls=0;
 await assert.rejects(()=>auditFromGas({...base,fetchImpl:async()=>{calls++;return {ok:false,status}}}),
  new RegExp('HIGH_DIVIDEND_AUDIT_AUTH_PROBE_HTTP_'+status));
 assert.equal(calls,1);
}
let gatewayCalls=0;
await assert.rejects(()=>auditFromGas({...base,fetchImpl:async()=>{gatewayCalls++;return {ok:false,status:503}}}),
 /HIGH_DIVIDEND_AUDIT_AUTH_PROBE_HTTP_503/);
assert.equal(gatewayCalls,2);
let partialCalls=0;
await assert.rejects(()=>auditFromGas({...base,fetchImpl:async(...args)=>{
 partialCalls++;if(partialCalls===1||partialCalls===3)throw Error('PRIVATE_NETWORK_FAILURE');
 return fetchImpl(...args);
}}),/HIGH_DIVIDEND_AUDIT_MASTER_NETWORK/);
assert.equal(partialCalls,3,'one retry for entire run');
let jsonCalls=0;
await assert.rejects(()=>auditFromGas({...base,fetchImpl:async(...args)=>{
 jsonCalls++;if(jsonCalls===3)return {ok:true,json:async()=>{throw Error('PRIVATE_HTML')}};
 return fetchImpl(...args);
}}),/HIGH_DIVIDEND_AUDIT_LEDGER_JSON_UNVERIFIED/);
assert.equal(jsonCalls,3);
console.log('PASS: bounded read-only transport recovery and safe stage-level diagnostics');
