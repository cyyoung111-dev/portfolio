#!/usr/bin/env node
import assert from 'node:assert/strict';
import {verifyHanwhaSecondaryOverlap} from './issue860-hanwha-secondary-nav-crosscheck.mjs';
const url='https://script.google.com/macros/s/TEST_SECONDARY_PREVIEW/exec';
const token='MOCK_LONG_TOKEN_NOT_LIVE';
const now=new Date('2026-11-11T03:00:00Z');
const sourced={today:'2026-11-11',eligible:[
 {date:'2026-11-08',nav:1001.23},{date:'2026-11-10',nav:1002.34}]};
const sourceReader=async()=>sourced;
let called=[];
const fetchImpl=async(_url,opts)=>{
 const params=opts.body,action=params.get('action');
 assert.equal(opts.method,'POST');called.push(action);
 assert.equal(params.get('accessToken'),token);
 if(action==='getAutomationStatus')return{ok:true,json:async()=>({
  status:'ok',gasVersion:'9.289',automation:{gasVersion:'9.289'}})};
 if(action==='previewFundNavImport'){
  const input=JSON.parse(params.get('data'));
  assert.equal(input.code,'F00001');
  assert.equal(input.classCode,'C-RPe');
  assert.equal(input.appendOnly,true);
  assert.equal(input.ackWarnings,false);
  assert.equal(input.rows.length,2);
  return {ok:true,json:async()=>({status:'ok',code:'F00001',
   identical:[{date:'2026-11-08',existingNav:1001.23,uploadedNav:1001.23}],
   candidates:[{date:'2026-11-10',nav:1002.34}],
   errors:[],warnings:[],updates:[],duplicates:[],zeroUnits:[]})};
 }
 throw Error('WRITE_OR_UNEXPECTED_GAS_ACTION');
};
const matched=await verifyHanwhaSecondaryOverlap({url,token,now,fetchImpl,sourceReader});
assert.equal(matched.status,'OVERLAP_MATCHED');
assert.equal(matched.confirmedExactOverlaps,1);
assert.equal(matched.sourceNewCandidates,1);
assert.equal(matched.financialWrites,0);
assert.equal(matched.importAuthorized,false);
assert(!JSON.stringify(matched).includes('1001.23'));
assert.deepEqual(called,['getAutomationStatus','previewFundNavImport']);
let invalidReads=0;
await assert.rejects(
 ()=>verifyHanwhaSecondaryOverlap({url,token,now,sourceReader:async()=>sourced,
  fetchImpl:async(_url,opts)=>{
   invalidReads++;
   return {ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
    ?{status:'ok',gasVersion:'9.289',automation:{gasVersion:'9.289'}}
    :{status:'ok',code:'F00001',identical:[
     {date:'2026-11-08',existingNav:1001.25,uploadedNav:1001.23}],
      candidates:[{date:'2026-11-10',nav:1002.34}],
      errors:[],warnings:[],updates:[],duplicates:[],zeroUnits:[]}};
  }}),/HANWHA_CROSSCHECK_SAVED_NAV_MISMATCH/);
assert.equal(invalidReads,2);
await assert.rejects(
 ()=>verifyHanwhaSecondaryOverlap({url,token,now,
 sourceReader:async()=>sourced,
 fetchImpl:async(_url,opts)=>({ok:true,json:async()=>opts.body.get('action')==='getAutomationStatus'
  ?{status:'ok',gasVersion:'9.290',automation:{gasVersion:'9.290'}}:{status:'ok'}})}),
 /HANWHA_CROSSCHECK_PUBLISHED_VERSION_UNVERIFIED/);
console.log('PASS: exact class source-to-persisted GAS preview proof, stale/mismatch/future rejected, writer calls 0');
