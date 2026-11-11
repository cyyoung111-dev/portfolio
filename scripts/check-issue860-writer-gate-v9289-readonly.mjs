#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readIssue860WriterGate} from './issue860-writer-gate-v9289-readonly.mjs';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
const src=composeIssue860Gas9289PerfCandidate().candidate;
assert(src.includes("args[0].parameter.action==='getWriterGateStatus'"));
assert(src.includes('return _issue507GateStatusRequest_(args[0].parameter);'));
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec',token='PRIVATE_TEST_TOKEN_ONLY';
const base={status:'ok',gasVersion:'9.289',
 writerGate:{mode:'OPEN',activeCount:0,repairAuthorized:false}};
async function read(payload=base){
 let count=0;
 const result=await readIssue860WriterGate({url,token,fetchImpl:async(target,opts)=>{
  const t=new URL(target);
  assert.equal(t.origin,'https://script.google.com');
  assert.equal(t.searchParams.get('action'),'getWriterGateStatus');
  assert.equal(t.searchParams.get('accessToken'),token);
  assert.equal(opts.method,'GET');
  count++;
  return{ok:true,json:async()=>payload};
 }});
 assert.equal(count,1);return result;
}
const result=await read();
assert.equal(result.recordedIdle,true);
const live291=await read({...base,gasVersion:'9.291'});
assert.equal(live291.gasVersion,'9.291','Published 9.291 must be accepted');
assert.equal(live291.recordedIdle,true);
assert.equal(live291.financeWrites,0);
assert.equal(result.readyForGAS9290Deploy,false);
assert.equal(result.processTerminalVerified,false);
assert.equal(result.financialWrites,undefined);
assert.equal(result.financeWrites,0);
assert(!JSON.stringify(result).includes(token));
for(const payload of [
 {...base,gasVersion:'9.288'},
 {...base,gasVersion:'9.290'},
 {...base,gasVersion:'9.292'},
 {...base,writerGate:{...base.writerGate,mode:'UNKNOWN'}},
 {...base,writerGate:{...base.writerGate,activeCount:-1}},
 {...base,writerGate:{...base.writerGate,repairAuthorized:true}},
 {status:'error',gasVersion:'9.289'}
])await assert.rejects(()=>read(payload),/ISSUE860_9289_WRITER_GATE_RESPONSE_UNVERIFIED/);
assert.equal((await read({...base,writerGate:{...base.writerGate,activeCount:1}})).recordedIdle,false);
assert.equal((await read({...base,writerGate:{...base.writerGate,mode:'DRAINING'}})).recordedIdle,false);
console.log(JSON.stringify({kind:'ISSUE860_9289_WRITER_GATE_OFFLINE_PASS',
  actualSourceRouteVerified:true,onlyOneAuthenticatedGet:true,
  activeWriterNotTreatedAsIdle:true,scriptWrites:0,
  ledgerChanges:0,telegramSends:0}));
