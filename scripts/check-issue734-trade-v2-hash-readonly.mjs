#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {sealTradeEvidence,captureTradeEvidence} from './issue734-trade-readback-capture-readonly.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {inspectPhysicalTradeParity,fetchParityOAuth} from './issue734-trade-source-parity-readonly.mjs';
import {composeGas9295CodeMasterReusePreview} from './compose-gas9295-code-master-reuse-preview.mjs';
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
  assetType:'주식',memo:'',ratio:0,fractionalCash:0},
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
// Actual published GAS canonicalization, including its real digest wrapper.
// The independent physical fixture preserves blank numeric cells exactly.
const published=composeGas9295CodeMasterReusePreview().candidate;
const physical=rows.map(t=>[t.date,t.tradeType,t.acct,t.name,t.code,
 t.qty,t.price,t.assetType,t.memo,'','','','',t.id]);
const preview={status:'ok',sourceRows:physical.length,migrationApplied:false,
 financeWrites:0,sourceDigest:reconstructedRawSourceDigest(rows),proposedRevision:revision};
const parity=inspectPhysicalTradeParity({source:published,physicalRows:physical,
 api:response,preview});
assert.equal(parity.status,'CONSISTENT');
assert.equal(parity.mismatchedRows,0);
const changed=inspectPhysicalTradeParity({source:published,physicalRows:physical,
 api:{...response,trades:[{...rows[0],price:1001},rows[1]]},preview});
assert.equal(changed.status,'EXACT_FIELD_DIVERGENCE');
assert.deepEqual(changed.fieldMismatchCounts,{price:1});
const otherSource=inspectPhysicalTradeParity({source:published,physicalRows:physical,
 api:response,preview:{...preview,sourceDigest:'0'.repeat(64)}});
assert.equal(otherSource.status,'PHYSICAL_SOURCE_NOT_MATCHED');
const digestDrift=inspectPhysicalTradeParity({source:published,physicalRows:physical,
 api:{...response,ledgerRevision:'0'.repeat(64)},preview});
assert.equal(digestDrift.status,'RUNTIME_DIGEST_DIVERGENCE');
for(const output of [parity,changed,otherSource,digestDrift]){
 assert.equal(output.financeWrites,0);
 assert.ok(!JSON.stringify(output).includes(rows[0].name));
 assert.ok(!JSON.stringify(output).includes(rows[0].id));
 assert.ok(!JSON.stringify(output).includes(revision));
}
console.log('PASS issue734 read-only GAS v2 hash comparator and exact source parity');
const mockCredentials=JSON.stringify({client_id:'MOCK_CLIENT',client_secret:'MOCK_SECRET',
 refresh_token:'MOCK_REFRESH'});
await assert.rejects(fetchParityOAuth('',async()=>{throw Error('must not call')}),
 /TRADE_SOURCE_PARITY_OAUTH_CONFIG_INVALID/);
for(const error of ['invalid_grant','invalid_client','unauthorized_client','access_denied']){
 await assert.rejects(fetchParityOAuth(mockCredentials,async()=>
  new Response(JSON.stringify({error,error_description:'PRIVATE_RESPONSE'}),{status:400})),
  e=>e.message==='TRADE_SOURCE_PARITY_OAUTH_'+error.toUpperCase());
}
console.log('PASS safe OAuth failure classification without credential disclosure');
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const sealed=sealTradeEvidence({api:response,preview},keys.publicKey);
assert.ok(!JSON.stringify(sealed).includes(rows[0].name));
assert.ok(!JSON.stringify(sealed).includes(rows[0].id));
const aes=privateDecrypt({key:keys.privateKey,oaepHash:'sha256',
 padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(sealed.key,'base64'));
const decipher=createDecipheriv('aes-256-gcm',aes,Buffer.from(sealed.iv,'base64'));
decipher.setAAD(Buffer.from('ISSUE734_READBACK_V1'));
decipher.setAuthTag(Buffer.from(sealed.tag,'base64'));
assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext,'base64')),
 decipher.final()]).toString('utf8')),{api:response,preview});
let captureCalls=[];
const captured=await captureTradeEvidence({url,token:secret,fetchImpl:async(dest,opt)=>{
 const action=opt.body.get('action');captureCalls.push(action);
 return {ok:true,json:async()=>action==='getTrades'?response:preview};
}});
assert.equal(captured.api.trades.length,2);
assert.deepEqual(captureCalls,['previewTradeLedgerV2Migration','getTrades','previewTradeLedgerV2Migration']);
console.log('PASS sealed financial evidence roundtrip and read-only capture');
