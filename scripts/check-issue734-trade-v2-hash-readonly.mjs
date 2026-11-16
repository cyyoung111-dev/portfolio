#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {inspectTradeV2RevisionResponse,probeTradeHash,reconstructedRawSourceDigest}
 from './issue734-trade-v2-hash-readonly.mjs';

const source=readFileSync('src/web/features/settings/settings_sync.js','utf8');
const extract=name=>{
 const start=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',start);
 assert(start>=0&&end>start,'missing browser '+name);
 return source.slice(start,end+2);
};
const ctx=vm.createContext({Number,String,Math,JSON,Error});
vm.runInContext(extract('_tradeV2NormalizeCode')+'\n'
 +extract('_tradeV2BrowserCanonical')+'\n'
 +'globalThis.canonical=_tradeV2BrowserCanonical;',ctx);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows=[
 {id:'srv_'+'a'.repeat(32),date:'2026-11-12',tradeType:'buy',
  acct:'ISA',name:'테스트 ETF',code:'005930',qty:5,price:1000,
  assetType:'ETF',memo:'',ratio:0,fractionalCash:0},
 {id:'srv_'+'b'.repeat(32),date:'2026-11-13',tradeType:'buy',
  acct:'PENSION',name:'테스트 펀드',code:'F00001',qty:3.5,price:2000,
  assetType:'펀드',memo:''}
];
const canonical=t=>JSON.parse(JSON.stringify(ctx.canonical(t)));
const revision=hash(rows.map(canonical));
const response={status:'ok',tradeLedgerProtocolVersion:2,
 gasVersion:'9.295',ledgerRevision:revision,trades:rows};
const clean=inspectTradeV2RevisionResponse(response);
assert.equal(clean.status,'CONSISTENT');
assert.equal(clean.rows,2);
assert.equal(clean.financeWrites,0);
assert.deepEqual(clean.candidates,{});
assert.equal(JSON.stringify(clean).includes('ISA'),false);
assert.equal(JSON.stringify(clean).includes('005930'),false);
assert.equal(JSON.stringify(clean).includes(revision),false);
const reverse=inspectTradeV2RevisionResponse({...response,
 trades:rows.slice().reverse()});
assert.equal(reverse.status,'CONSISTENT');
assert.equal(reverse.dateOrderInversions,1);
const bad=inspectTradeV2RevisionResponse({...response,
 ledgerRevision:'0'.repeat(64)});
assert.equal(bad.status,'REVISION_DRIFT');
assert.equal(bad.pcCanonicalMatchesGasRevision,false);
assert.equal(bad.financeWrites,0);
// A row with explicit numeric zero (rather than GAS blank) must be
// classified, not silently accepted.
const zeroArray=rows.map(t=>{
 const z=canonical(t);
 z[10]=0;z[11]=0;
 return z;
});
const zeroDiagnostic=inspectTradeV2RevisionResponse({...response,
 ledgerRevision:hash(zeroArray)});
assert.equal(zeroDiagnostic.status,'REVISION_DRIFT');
assert.equal(zeroDiagnostic.candidates.numericZero,true);
assert.throws(()=>inspectTradeV2RevisionResponse({...response,
 trades:[rows[0],rows[0]]}),/READBACK_ID_UNVERIFIED/);
assert.throws(()=>inspectTradeV2RevisionResponse({...response,
 ledgerRevision:'invalid'}),/READBACK_SCHEMA_UNVERIFIED/);
const secret='MOCK_PRIVATE_ACCESS_TOKEN';
const url='https://script.google.com/macros/s/MOCK_DEPLOYMENT/exec';
let calls=0;
const read=await probeTradeHash({url,token:secret,fetchImpl:async(dest,opt)=>{
 calls++;assert.equal(dest,url);assert.equal(opt.method,'POST');
 assert.equal(opt.body.get('action'),'getTrades');
 assert.equal(opt.body.get('accessToken'),secret);
 return {ok:true,json:async()=>response};
}});
assert.equal(calls,1);
assert.equal(read.status,'CONSISTENT');
assert.doesNotMatch(JSON.stringify(read),/MOCK_PRIVATE_ACCESS_TOKEN/);
let previewCalls=0;
const withPreview=await probeTradeHash({
 url,token:secret,includeMigrationPreview:true,
 fetchImpl:async(dest,opt)=>{
  previewCalls++;
  assert.equal(dest,url);
  const action=opt.body.get('action');
  assert.ok(['getTrades','previewTradeLedgerV2Migration'].includes(action));
  if(action==='getTrades')return {ok:true,json:async()=>response};
  return {ok:true,json:async()=>({
   status:'ok',migrationStatus:'READY',tradeLedgerProtocolVersion:2,
   sourceRows:rows.length,assignedIdsNeeded:0,existingIdsPreserved:rows.length,
   sourceDigest:reconstructedRawSourceDigest(rows),
   proposedRevision:revision,migrationApplied:false,financeWrites:0
  })};
 }
});
assert.equal(previewCalls,2);
assert.deepEqual(withPreview.migrationPreview,{
 status:'VERIFIED',sourceRows:2,assignedIdsNeeded:0,existingIdsPreserved:2,
 physicalRevisionMatchesGasGetTrades:true,
 physicalRevisionMatchesPcCanonical:true,rowCountMatchesApi:true,
 rawStringSourceDigestMatches:true,rawStringOptionalZeroMatches:false,
 rawStringStockDefaultMatches:false
});
assert.ok(!JSON.stringify(withPreview).includes(secret));
assert.ok(!JSON.stringify(withPreview).includes(revision));
const badPreview=await probeTradeHash({
 url,token:secret,includeMigrationPreview:true,
 fetchImpl:async(dest,opt)=>({ok:true,json:async()=>opt.body.get('action')==='getTrades'
  ?response:{status:'error',errorCode:'TRADE_MIGRATION_SHEET_WIDTH_INVALID'}})
});
assert.deepEqual(badPreview.migrationPreview,{
 status:'NOT_VERIFIED',errorClass:'TRADE_MIGRATION_SHEET_WIDTH_INVALID'
});
console.log('PASS issue734 read-only GAS v2 hash comparator');
