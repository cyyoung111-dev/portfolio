#!/usr/bin/env node
// #860 - production v9.289 has stored PRICE rows but no CLOSE owner summary.
// Status inspection must not touch preview/apply endpoints or replay PRICE/NAV.
import assert from 'node:assert/strict';
import {resumeClose} from './run-incomplete-close-resume.mjs';

const url='https://script.google.com/macros/s/TEST_ISSUE860_READ_ONLY/exec';
const token='TEST_MOCK_CREDENTIAL_NO_NETWORK';
let gasCalls=0, statusCalls=0, events=[];
const fetchImpl=async()=>{gasCalls++;throw Error('UNEXPECTED_REMOTE_REQUEST');};
const read=version=>async()=>{
 statusCalls++;
 return {gasVersion:version,close:{
  state:'INCOMPLETE',stage:'PRICE',runDate:'2026-11-10',
  priceOk:true,fundOk:true,fundAttemptDate:'2026-11-09',
  fundErrorPresent:false,fundWarningPresent:false
 }};
};
const result=await resumeClose({url,token,readOnly:true,fetchImpl,
 statusReader:read('9.289'),emit:value=>events.push(value)});
assert.equal(result.mode,'READ_ONLY');
assert.equal(result.complete,false);
assert.equal(result.preflightState,'BLOCKED_9289_UNSETTLED_CLOSE');
assert.equal(result.continueReady,null);
assert.equal(result.scheduleReady,null);
assert.equal(result.priceReplayAllowed,false);
assert.equal(result.navReplayAllowed,false);
assert.equal(statusCalls,1);
assert.equal(gasCalls,0);
assert(events.some(e=>e.phase==='9289_READ_ONLY_STATUS'
 &&e.financialWrites===0&&e.priceReplayAllowed===false));

await assert.rejects(
 ()=>resumeClose({url,token,readOnly:false,fetchImpl,statusReader:read('9.289')}),
 /RESUME_VERSION/);
assert.equal(gasCalls,0,'v9.289 APPLY must never reach a GAS write or preview');

await assert.rejects(
 ()=>resumeClose({url,token,readOnly:true,fetchImpl,statusReader:read('9.290')}),
 /RESUME_VERSION/);
assert.equal(gasCalls,0,'unknown future version must not reach GAS');

const done=await resumeClose({url,token,readOnly:true,fetchImpl,
 statusReader:async()=>({gasVersion:'9.289',close:{
  state:'COMPLETE',stage:'COMPLETE',runDate:'2026-11-10',
  priceOk:true,fundOk:true,fundAttemptDate:'2026-11-10',
  fundErrorPresent:false,fundWarningPresent:false
 }})});
assert.equal(done.complete,false,'summary alone cannot approve deployment');
assert.equal(done.preflightState,'AWAIT_INDEPENDENT_DEPLOY_GATE');
assert.equal(gasCalls,0);
console.log('PASS v9.289 read-only persisted CLOSE; no PRICE/NAV replay, no preview, no GAS writes; manual deploy gate required');
